from pathlib import Path

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, APIRouter
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
import asyncio
import base64
import logging
import os
from typing import Any, Dict

from dotenv import load_dotenv
from google import genai
from google.genai import types as genai_types

import tools_spatial
from agent_config import SURVEYOR_SYSTEM_PROMPT

load_dotenv()
logger = logging.getLogger(__name__)

app = FastAPI(title="Afriland Scout Backend", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


api_router = APIRouter()


@api_router.get("/health")
async def health() -> Dict[str, str]:
    return {"status": "ok"}


@api_router.post("/debug/record-point")
async def debug_record_point(payload: Dict[str, Any]) -> Dict[str, Any]:
    lat = float(payload["lat"])
    lng = float(payload["lng"])
    return tools_spatial.record_gps_coordinate(lat, lng)


@api_router.post("/debug/calculate-area")
async def debug_calculate_area() -> Dict[str, Any]:
    return tools_spatial.calculate_precise_area()


@api_router.get("/debug/terrain-risk")
async def debug_terrain_risk(lat: float = 5.524, lng: float = 7.494) -> Dict[str, Any]:
    return tools_spatial.get_terrain_risk(lat, lng)


@api_router.get("/debug/map")
async def debug_map() -> Dict[str, Any]:
    return tools_spatial.get_map_url()


@api_router.post("/debug/reset-points")
async def debug_reset_points() -> Dict[str, Any]:
    tools_spatial.state.gps_points.clear()
    return {"status": "ok", "point_count": 0}


app.include_router(api_router)


def _serialize_event(msg: Any) -> Dict[str, Any]:
    """Convert a LiveServerMessage (or any response) to a JSON-serializable dict."""
    if hasattr(msg, "model_dump"):
        return msg.model_dump(mode="json", exclude_none=True)
    if hasattr(msg, "to_dict"):
        return msg.to_dict()
    return {"raw": str(msg)}


async def _forward_client_to_gemini(websocket: WebSocket, live_session: Any) -> None:
    """Read JSON from client and send to Gemini Live via send_client_content or send_realtime_input."""
    try:
        while True:
            message = await websocket.receive_json()
            if not isinstance(message, dict):
                continue
            msg_type = message.get("type")
            if msg_type == "control":
                text = message.get("text")
                if isinstance(text, str) and text.strip():
                    await live_session.send_client_content(
                        turns=genai_types.Content(
                            role="user",
                            parts=[genai_types.Part(text=text.strip())],
                        ),
                        turn_complete=True,
                    )
                continue
            if msg_type == "audio":
                data_b64 = message.get("data")
                if isinstance(data_b64, str):
                    try:
                        audio_bytes = base64.b64decode(data_b64, validate=True)
                        await live_session.send_realtime_input(
                            audio=genai_types.Blob(
                                data=audio_bytes,
                                mime_type="audio/pcm;rate=16000",
                            )
                        )
                    except Exception:
                        pass
                continue
            if msg_type == "video":
                data_b64 = message.get("data")
                if isinstance(data_b64, str):
                    try:
                        image_bytes = base64.b64decode(data_b64, validate=True)
                        await live_session.send_realtime_input(
                            video=genai_types.Blob(
                                data=image_bytes,
                                mime_type="image/jpeg",
                            )
                        )
                    except Exception:
                        pass
                continue
    except WebSocketDisconnect:
        return
    except Exception as e:
        logger.exception("Forward client->gemini: %s", e)
        raise


async def _forward_gemini_to_client(websocket: WebSocket, live_session: Any) -> None:
    """Stream Gemini Live responses to the client as JSON."""
    try:
        async for msg in live_session.receive():
            payload = _serialize_event(msg)
            await websocket.send_json(payload)
    except WebSocketDisconnect:
        return
    except Exception as e:
        logger.exception("Forward gemini->client: %s", e)
        raise


@app.websocket("/live")
async def live_endpoint(websocket: WebSocket) -> None:
    await websocket.accept()
    api_key = os.getenv("GOOGLE_API_KEY")
    if not api_key:
        await websocket.close(code=1011, reason="GOOGLE_API_KEY not set")
        return

    client = genai.Client(api_key=api_key)
    # Only 2.5 native-audio is available for Live on Google AI Studio (v1beta). 2.0 models are not found.
    # It requires audio; we send a tiny silent chunk on connect so the session stays open for text too.
    model = os.getenv("GEMINI_LIVE_MODEL", "gemini-2.5-flash-native-audio-preview-12-2025")
    config = {
        "system_instruction": SURVEYOR_SYSTEM_PROMPT,
        "response_modalities": ["AUDIO"],
        "tools": [
            tools_spatial.record_gps_coordinate,
            tools_spatial.calculate_precise_area,
            tools_spatial.get_terrain_risk,
            tools_spatial.generate_architectural_render,
        ],
    }

    try:
        async with client.aio.live.connect(model=model, config=config) as live_session:
            # Send a minimal silent audio chunk so the API sees an audio request and doesn't close with
            # "Cannot extract voices from a non-audio request". 320 bytes = 10ms at 16kHz 16-bit PCM.
            _silent = b"\x00" * 320
            await live_session.send_realtime_input(
                audio=genai_types.Blob(data=_silent, mime_type="audio/pcm;rate=16000"),
            )
            send_task = asyncio.create_task(_forward_client_to_gemini(websocket, live_session))
            recv_task = asyncio.create_task(_forward_gemini_to_client(websocket, live_session))
            done, pending = await asyncio.wait(
                {send_task, recv_task},
                return_when=asyncio.FIRST_EXCEPTION,
            )
            for t in pending:
                t.cancel()
                try:
                    await t
                except asyncio.CancelledError:
                    pass
    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.exception("Live WebSocket: %s", e)
        try:
            await websocket.close(code=1011, reason=str(e)[:120])
        except Exception:
            pass


STATIC_DIR = Path(__file__).resolve().parent.parent / "static"

if STATIC_DIR.is_dir():
    @app.get("/")
    async def serve_index():
        return FileResponse(STATIC_DIR / "index.html")

    app.mount("/", StaticFiles(directory=str(STATIC_DIR), html=True), name="static")

