"use client";

import { useCallback, useEffect, useRef, useState } from "react";

function getBackendUrls() {
  if (typeof window === "undefined") return { ws: "", api: "" };
  const isLocal = window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1";
  if (isLocal) {
    return { ws: "ws://localhost:8000/live", api: "http://localhost:8000" };
  }
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  const host = window.location.hostname;
  const port = window.location.port ? `:${window.location.port}` : "";
  return { ws: `${proto}://${host}${port}/live`, api: `${window.location.protocol}//${host}${port}` };
}

const TARGET_SAMPLE_RATE = 16000;

type ConversationEntry = { role: "user" | "model"; content: string };

function parseServerEvent(data: string): { text: string; audioBase64: string[] } {
  const out = { text: "", audioBase64: [] as string[] };
  try {
    const ev = JSON.parse(data) as Record<string, unknown>;
    const serverContent = ev?.server_content as Record<string, unknown> | undefined;
    const modelTurn = serverContent?.model_turn as Record<string, unknown> | undefined;
    const parts = modelTurn?.parts as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(parts)) return out;
    for (const part of parts) {
      if (typeof part.text === "string" && part.text) out.text += part.text;
      const inline = part.inline_data as Record<string, unknown> | undefined;
      if (inline && typeof inline.data === "string" && String(inline.mime_type || "").startsWith("audio/")) {
        out.audioBase64.push(inline.data as string);
      }
    }
  } catch {
    // ignore
  }
  return out;
}

function float32ToPcm16(float32: Float32Array): ArrayBuffer {
  const pcm = new Int16Array(float32.length);
  for (let i = 0; i < float32.length; i++) {
    const s = Math.max(-1, Math.min(1, float32[i]));
    pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return pcm.buffer;
}

function resampleTo16k(input: Float32Array, inputRate: number): Float32Array {
  if (inputRate === TARGET_SAMPLE_RATE) return input;
  const ratio = inputRate / TARGET_SAMPLE_RATE;
  const outLen = Math.round(input.length / ratio);
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const srcIdx = i * ratio;
    const j = Math.floor(srcIdx);
    const f = srcIdx - j;
    out[i] = j + 1 < input.length ? input[j] * (1 - f) + input[j + 1] * f : input[j] ?? 0;
  }
  return out;
}

function useAudioPlayer() {
  const ctxRef = useRef<AudioContext | null>(null);
  const queueRef = useRef<ArrayBuffer[]>([]);
  const playingRef = useRef(false);

  const playPcm24k = useCallback(async (base64: string) => {
    const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
    const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    queueRef.current.push(buffer);
    if (playingRef.current) return;
    playingRef.current = true;
    if (!ctxRef.current)
      ctxRef.current = new (window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    const ctx = ctxRef.current;
    while (queueRef.current.length > 0) {
      const buf = queueRef.current.shift()!;
      const source = ctx.createBufferSource();
      source.buffer = await ctx.createBuffer(1, buf.byteLength / 2, 24000);
      const channel = source.buffer.getChannelData(0);
      const view = new DataView(buf);
      for (let i = 0; i < channel.length; i++) channel[i] = view.getInt16(i * 2, true) / 32768;
      source.connect(ctx.destination);
      source.start();
      await new Promise<void>((r) => (source.onended = () => r()));
    }
    playingRef.current = false;
  }, []);

  return playPcm24k;
}

export default function SurveyorDashboard() {
  const [status, setStatus] = useState<"disconnected" | "connecting" | "connected">("disconnected");
  const [conversation, setConversation] = useState<ConversationEntry[]>([]);
  const [events, setEvents] = useState<string[]>([]);
  const [showRawLog, setShowRawLog] = useState(false);
  const [micActive, setMicActive] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [mapUrl, setMapUrl] = useState<string | null>(null);
  const [chatInput, setChatInput] = useState("");
  const [gpsPoints, setGpsPoints] = useState<{ lat: number; lng: number }[]>([]);
  const [gpsStatus, setGpsStatus] = useState<string>("");
  const wsRef = useRef<WebSocket | null>(null);
  const micCleanupRef = useRef<(() => void) | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const cameraIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cameraStreamRef = useRef<MediaStream | null>(null);
  const playPcm24k = useAudioPlayer();

  const appendEvent = useCallback((raw: string) => {
    setEvents((prev) => [...prev.slice(-99), raw]);
  }, []);

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return;
    setStatus("connecting");
    setConversation([]);
    const { ws: wsUrl } = getBackendUrls();
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => setStatus("connected");
    ws.onclose = () => {
      setStatus("disconnected");
      wsRef.current = null;
    };
    ws.onerror = () => setStatus("disconnected");
    ws.onmessage = (e) => {
      const raw = typeof e.data === "string" ? e.data : "[binary]";
      appendEvent(raw);
      const { text, audioBase64 } = parseServerEvent(raw);
      if (text) setConversation((prev) => [...prev, { role: "model", content: text }]);
      for (const b64 of audioBase64) playPcm24k(b64);
    };
  }, [appendEvent, playPcm24k]);

  const disconnect = useCallback(() => {
    if (micCleanupRef.current) {
      micCleanupRef.current();
      micCleanupRef.current = null;
      setMicActive(false);
    }
    if (cameraIntervalRef.current) {
      clearInterval(cameraIntervalRef.current);
      cameraIntervalRef.current = null;
    }
    cameraStreamRef.current?.getTracks().forEach((t) => t.stop());
    cameraStreamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraActive(false);
    wsRef.current?.close();
    wsRef.current = null;
    setStatus("disconnected");
  }, []);

  const sendTest = useCallback(() => {
    const ws = wsRef.current;
    if (ws?.readyState !== WebSocket.OPEN) return;
    const text = "Introduce yourself briefly as Afriland Scout.";
    ws.send(JSON.stringify({ type: "control", text }));
    setConversation((prev) => [...prev, { role: "user", content: text }]);
    appendEvent("[sent] " + text);
  }, [appendEvent]);

  const sendChat = useCallback(
    (text: string) => {
      const ws = wsRef.current;
      if (ws?.readyState !== WebSocket.OPEN || !text.trim()) return;
      ws.send(JSON.stringify({ type: "control", text: text.trim() }));
      setConversation((prev) => [...prev, { role: "user", content: text.trim() }]);
      appendEvent("[sent] " + text.trim());
      setChatInput("");
    },
    [appendEvent],
  );

  const fetchMap = useCallback(async () => {
    try {
      const { api } = getBackendUrls();
      const res = await fetch(`${api}/debug/map`);
      const data = await res.json();
      if (data.status === "ok" && data.map_url) {
        setMapUrl(data.map_url);
      } else {
        alert(data.message || "No map available yet — record at least 2 GPS points first.");
      }
    } catch (err) {
      console.error("Map fetch error:", err);
    }
  }, []);

  const recordGps = useCallback(() => {
    if (!navigator.geolocation) {
      setGpsStatus("Geolocation not supported");
      return;
    }
    setGpsStatus("Getting location…");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = parseFloat(pos.coords.latitude.toFixed(6));
        const lng = parseFloat(pos.coords.longitude.toFixed(6));
        const accuracy = pos.coords.accuracy.toFixed(1);
        setGpsPoints((prev) => [...prev, { lat, lng }]);
        setGpsStatus(`Point recorded (±${accuracy}m)`);

        const { api } = getBackendUrls();
        fetch(`${api}/debug/record-point`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ lat, lng }),
        }).catch(() => {});

        const ws = wsRef.current;
        if (ws?.readyState === WebSocket.OPEN) {
          const text = `I just recorded boundary point #${gpsPoints.length + 1} at GPS coordinates ${lat}, ${lng} (accuracy ±${accuracy}m). Please acknowledge this point.`;
          ws.send(JSON.stringify({ type: "control", text }));
          setConversation((prev) => [...prev, { role: "user", content: `📍 GPS Point #${gpsPoints.length + 1}: ${lat}, ${lng} (±${accuracy}m)` }]);
          appendEvent("[gps] " + text);
        }
      },
      (err) => {
        setGpsStatus(`GPS error: ${err.message}`);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 },
    );
  }, [gpsPoints, appendEvent]);

  const calculateArea = useCallback(async () => {
    const { api } = getBackendUrls();
    try {
      const res = await fetch(`${api}/debug/calculate-area`, { method: "POST" });
      const data = await res.json();
      if (data.status === "ok") {
        const msg = `Area: ${data.area_sqm.toFixed(1)} sqm (${data.plots_600sqm.toFixed(2)} plots of 600sqm) from ${data.point_count} points`;
        setConversation((prev) => [...prev, { role: "model", content: `📐 ${msg}` }]);
        const ws = wsRef.current;
        if (ws?.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "control", text: `The area calculation result is: ${msg}. Please explain this to the user.` }));
        }
      } else {
        alert(data.message || "Need at least 3 points to calculate area.");
      }
    } catch (err) {
      console.error("Area calc error:", err);
    }
  }, []);

  const resetPoints = useCallback(async () => {
    const { api } = getBackendUrls();
    try {
      await fetch(`${api}/debug/reset-points`, { method: "POST" });
      setGpsPoints([]);
      setGpsStatus("Points cleared");
      setMapUrl(null);
    } catch (err) {
      console.error("Reset error:", err);
    }
  }, []);

  const startMic = useCallback(() => {
    const ws = wsRef.current;
    if (ws?.readyState !== WebSocket.OPEN || micCleanupRef.current) return;
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    let source: MediaStreamAudioSourceNode | null = null;
    let processor: ScriptProcessorNode | null = null;
    let gain: GainNode | null = null;

    const cleanup = () => {
      try {
        processor?.disconnect();
        gain?.disconnect();
        source?.disconnect();
        stream?.getTracks().forEach((t) => t.stop());
        ctx?.close();
      } catch {
        // ignore
      }
      micCleanupRef.current = null;
      setMicActive(false);
    };

    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((s) => {
        stream = s;
        ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
        source = ctx.createMediaStreamSource(stream);
        const bufferSize = 4096;
        processor = ctx.createScriptProcessor(bufferSize, 1, 1);
        gain = ctx.createGain();
        gain.gain.value = 0;
        processor.connect(gain);
        gain.connect(ctx.destination);
        processor.onaudioprocess = (e) => {
          if (wsRef.current?.readyState !== WebSocket.OPEN || !ctx) return;
          const input = e.inputBuffer.getChannelData(0);
          const inputRate = ctx.sampleRate;
          const resampled = resampleTo16k(input, inputRate);
          const pcm = float32ToPcm16(resampled);
          const bytes = new Uint8Array(pcm);
          let binary = "";
          for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
          const b64 = btoa(binary);
          wsRef.current?.send(JSON.stringify({ type: "audio", data: b64 }));
        };
        source.connect(processor);
        processor.connect(ctx.destination);
        micCleanupRef.current = cleanup;
        setMicActive(true);
      })
      .catch((err) => {
        console.error("Mic access:", err);
        setMicActive(false);
      });
  }, []);

  const stopMic = useCallback(() => {
    if (micCleanupRef.current) {
      micCleanupRef.current();
      micCleanupRef.current = null;
      setMicActive(false);
    }
  }, []);

  const startCamera = useCallback(() => {
    if (wsRef.current?.readyState !== WebSocket.OPEN || cameraIntervalRef.current || !videoRef.current) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!canvas) return;
    navigator.mediaDevices
      .getUserMedia({ video: true })
      .then((stream) => {
        cameraStreamRef.current = stream;
        video.srcObject = stream;
        video.play().then(() => {
          setCameraActive(true);
          cameraIntervalRef.current = setInterval(() => {
            if (wsRef.current?.readyState !== WebSocket.OPEN || video.readyState < 2) return;
            const w = video.videoWidth;
            const h = video.videoHeight;
            if (w === 0 || h === 0) return;
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext("2d");
            if (!ctx) return;
            ctx.drawImage(video, 0, 0);
            const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
            const b64 = dataUrl.slice(dataUrl.indexOf(",") + 1);
            wsRef.current?.send(JSON.stringify({ type: "video", data: b64 }));
          }, 1000);
        });
      })
      .catch((err) => {
        console.error("Camera access:", err);
        setCameraActive(false);
      });
  }, []);

  const stopCamera = useCallback(() => {
    if (cameraIntervalRef.current) {
      clearInterval(cameraIntervalRef.current);
      cameraIntervalRef.current = null;
    }
    cameraStreamRef.current?.getTracks().forEach((t) => t.stop());
    cameraStreamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraActive(false);
  }, []);

  useEffect(() => {
    return () => {
      if (micCleanupRef.current) micCleanupRef.current();
      if (cameraIntervalRef.current) clearInterval(cameraIntervalRef.current);
      cameraStreamRef.current?.getTracks().forEach((t) => t.stop());
      wsRef.current?.close();
    };
  }, []);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 font-sans">
      <div className="mx-auto max-w-2xl px-4 py-8">
        <h1 className="text-2xl font-semibold tracking-tight text-amber-400">
          Afriland Scout — Surveyor Dashboard
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          Connect, then send text, use the mic, or turn on the camera (1 FPS). Response audio plays automatically.
        </p>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={connect}
            disabled={status === "connecting" || status === "connected"}
            className="rounded-lg bg-emerald-600 px-4 py-2 text-sm font-medium text-white hover:bg-emerald-500 disabled:opacity-50"
          >
            Connect
          </button>
          <button
            type="button"
            onClick={disconnect}
            disabled={status !== "connected"}
            className="rounded-lg bg-zinc-700 px-4 py-2 text-sm font-medium hover:bg-zinc-600 disabled:opacity-50"
          >
            Disconnect
          </button>
          <button
            type="button"
            onClick={sendTest}
            disabled={status !== "connected"}
            className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-black hover:bg-amber-500 disabled:opacity-50"
          >
            Send test message
          </button>
          <button
            type="button"
            onClick={micActive ? stopMic : startMic}
            disabled={status !== "connected"}
            className={`rounded-lg px-4 py-2 text-sm font-medium ${
              micActive ? "bg-red-600 hover:bg-red-500" : "bg-violet-600 hover:bg-violet-500"
            } text-white disabled:opacity-50`}
          >
            {micActive ? "Stop mic" : "Start mic"}
          </button>
          <button
            type="button"
            onClick={cameraActive ? stopCamera : startCamera}
            disabled={status !== "connected"}
            className={`rounded-lg px-4 py-2 text-sm font-medium ${
              cameraActive ? "bg-red-600 hover:bg-red-500" : "bg-sky-600 hover:bg-sky-500"
            } text-white disabled:opacity-50`}
          >
            {cameraActive ? "Stop camera" : "Start camera"}
          </button>
          <span
            className={`inline-flex h-2 w-2 rounded-full ${
              status === "connected" ? "bg-emerald-500" : status === "connecting" ? "bg-amber-500 animate-pulse" : "bg-zinc-600"
            }`}
            aria-hidden
          />
          <span className="text-sm text-zinc-400 capitalize">{status}</span>
          {micActive && <span className="text-sm text-red-400">Mic on</span>}
          {cameraActive && <span className="text-sm text-sky-400">Camera on (1 FPS)</span>}
        </div>

        <div className={`mt-4 ${cameraActive ? "" : "hidden"}`}>
          <h2 className="text-sm font-medium text-zinc-400">Camera preview</h2>
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className="mt-2 max-h-48 w-full rounded-lg border border-zinc-800 bg-black object-contain"
          />
        </div>
        <canvas ref={canvasRef} className="hidden" width={640} height={480} aria-hidden />

        {/* GPS controls */}
        <div className="mt-4 rounded-lg border border-zinc-800 bg-zinc-900 p-4">
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={recordGps}
              disabled={status !== "connected"}
              className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-500 disabled:opacity-50"
            >
              📍 Record GPS Point
            </button>
            <button
              type="button"
              onClick={calculateArea}
              disabled={gpsPoints.length < 3}
              className="rounded-lg bg-orange-600 px-4 py-2 text-sm font-medium text-white hover:bg-orange-500 disabled:opacity-50"
            >
              📐 Calculate Area
            </button>
            <button
              type="button"
              onClick={fetchMap}
              disabled={gpsPoints.length < 2}
              className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-500 disabled:opacity-50"
            >
              🗺️ Show Map
            </button>
            <button
              type="button"
              onClick={resetPoints}
              disabled={gpsPoints.length === 0}
              className="rounded-lg bg-zinc-700 px-3 py-2 text-sm font-medium text-zinc-300 hover:bg-zinc-600 disabled:opacity-50"
            >
              Reset
            </button>
            <span className="text-sm text-zinc-400">
              {gpsPoints.length} point{gpsPoints.length !== 1 ? "s" : ""} recorded
            </span>
            {gpsStatus && <span className="text-xs text-zinc-500">{gpsStatus}</span>}
          </div>
          {gpsPoints.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {gpsPoints.map((p, i) => (
                <span key={i} className="rounded bg-zinc-800 px-2 py-0.5 text-xs text-zinc-400">
                  #{i + 1}: {p.lat}, {p.lng}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Chat input */}
        <form
          className="mt-4 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            sendChat(chatInput);
          }}
        >
          <input
            type="text"
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            placeholder="Type a message…"
            disabled={status !== "connected"}
            className="flex-1 rounded-lg border border-zinc-700 bg-zinc-900 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-amber-500 focus:outline-none disabled:opacity-50"
          />
          <button
            type="submit"
            disabled={status !== "connected" || !chatInput.trim()}
            className="rounded-lg bg-amber-600 px-4 py-2 text-sm font-medium text-black hover:bg-amber-500 disabled:opacity-50"
          >
            Send
          </button>
        </form>

        {/* Map overlay */}
        {mapUrl && (
          <div className="mt-4">
            <h2 className="text-sm font-medium text-zinc-400">Plot Map</h2>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={mapUrl}
              alt="Plot polygon on satellite map"
              className="mt-2 w-full rounded-lg border border-zinc-800"
            />
          </div>
        )}

        <div className="mt-6">
          <h2 className="text-sm font-medium text-zinc-400">Conversation</h2>
          <div className="mt-2 min-h-[120px] rounded-lg border border-zinc-800 bg-zinc-900 p-4">
            {conversation.length === 0 ? (
              <p className="text-sm text-zinc-500">No messages yet. Connect and send a message or use the mic.</p>
            ) : (
              <ul className="space-y-3">
                {conversation.map((entry, i) => (
                  <li key={i} className={entry.role === "user" ? "text-right" : "text-left"}>
                    <span className="text-xs font-medium text-zinc-500">{entry.role === "user" ? "You" : "Scout"}</span>
                    <p className="mt-0.5 text-sm text-zinc-200 whitespace-pre-wrap">{entry.content}</p>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="mt-4">
          <button
            type="button"
            onClick={() => setShowRawLog((v) => !v)}
            className="text-sm font-medium text-zinc-500 hover:text-zinc-400"
          >
            {showRawLog ? "Hide" : "Show"} raw event log
          </button>
          {showRawLog && (
            <pre className="mt-2 max-h-64 overflow-y-auto rounded-lg border border-zinc-800 bg-zinc-900 p-4 text-xs text-zinc-400 whitespace-pre-wrap break-all">
              {events.length === 0 ? "No events." : events.join("\n\n")}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}
