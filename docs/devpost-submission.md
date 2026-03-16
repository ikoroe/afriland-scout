# Afriland Scout — Devpost Submission


---

## Project Name

Afriland Scout (TerraVision)

## Category

Live Agents

## Tagline

Walk your land, talk to your surveyor — an AI agent that sees, hears, and measures in real time.

---

## Inspiration

In Nigeria and across West Africa, buying land is one of the biggest financial decisions a family will make — yet the process is opaque, manual, and riddled with fraud. Surveys are expensive, boundaries are disputed, and first-time buyers have no way to verify what they're getting. We asked: what if your phone could become your surveyor?

## What it does

Afriland Scout is a real-time, multimodal AI land surveying agent. A user walks the perimeter of a plot with their phone, and the agent:

- **Sees** the terrain through the phone camera (1 FPS video stream)
- **Hears** the user through the microphone (live voice conversation)
- **Records** GPS boundary points as the user walks the perimeter
- **Calculates** precise geodesic area using WGS84 ellipsoid math (in square meters and Nigerian "plots" of 600 sqm)
- **Assesses** terrain and flood risk via elevation data
- **Generates** architectural renders of what could be built on the land
- **Shows** the surveyed polygon on a satellite map

The entire interaction happens in natural voice — no typing required. The agent has the persona of a calm, professional Nigerian surveyor who explains every step in plain language.

## How we built it

**Backend:** A Python FastAPI server acts as a real-time WebSocket bridge between the browser and Google's Gemini Live API (`bidiGenerateContent`). The server uses the `google-genai` SDK to maintain a persistent bidirectional session with Gemini 2.5 Flash. Four Python tools are registered as callable functions:

1. `record_gps_coordinate(lat, lng)` — stores boundary points in session state
2. `calculate_precise_area()` — uses `pyproj.Geod` (WGS84) for geodesic area computation
3. `get_terrain_risk(lat, lng)` — elevation, slope, and flood risk lookup
4. `generate_architectural_render(prompt)` — produces building visualizations

**Frontend:** A Next.js React dashboard with WebRTC integration captures microphone audio (resampled to 16kHz PCM) and camera frames (JPEG at 1 FPS), encodes them to base64, and streams them over WebSocket. Audio responses from Gemini (24kHz PCM) are decoded and played back through the Web Audio API. The UI includes a text chat input, camera preview, conversation log, and a "Show Map" button that renders the plot polygon on Google Maps satellite imagery.

**Infrastructure:** The entire stack is containerized in a single Docker image and deployed to Google Cloud Run. FastAPI serves both the API/WebSocket endpoints and the static frontend on a single port.

## Challenges we ran into

- **Gemini Live API model availability:** The `gemini-2.0-flash-live` models listed in documentation were not available on Google AI Studio's v1beta endpoint. We discovered that `gemini-2.5-flash-native-audio-preview` was the correct model, and it requires audio input — sending a silent PCM chunk on connection was the key to keeping text-only sessions alive.
- **Audio pipeline complexity:** Resampling browser audio (typically 48kHz) down to 16kHz, converting Float32 to 16-bit PCM, and base64 encoding — all in real-time JavaScript — required careful buffer management.
- **Single-port Cloud Run deployment:** Cloud Run exposes one port, but we needed both a WebSocket API and a static frontend. Switching from Next.js standalone (requiring Node.js) to static export served by FastAPI simplified the architecture significantly.

## Accomplishments that we're proud of

- True real-time voice + vision interaction — you can walk around a plot and have a natural conversation with the AI while it watches through your camera
- Geodesic area calculation that's accurate to surveyor-grade precision using the WGS84 ellipsoid
- The entire app — from mic to Gemini to speaker — runs in a browser with no native app installation
- Deployed and publicly accessible in under 48 hours from first line of code

## What we learned

- The Gemini Live API is genuinely powerful for building real-time multimodal agents, but the documentation gap between "what models exist" and "what models are actually available on which endpoint" is real
- WebRTC audio processing in the browser is harder than it looks — sample rate conversion and PCM encoding are non-trivial
- For hackathon deployments, static exports beat server-side rendering every time

## What's next for Afriland Scout

- **Continuous GPS tracking:** Auto-record boundary points as the user walks without manual tapping
- **Earth Engine elevation data:** Connect terrain risk assessment to Google Earth Engine's SRTM dataset for precise elevation, slope, and flood risk data
- **Imagen 3 renders:** Wire up architectural render to Vertex AI Imagen 3 for photorealistic building visualization on the actual plot
- **Offline-first mobile app:** Build a React Native version that works in areas with intermittent connectivity (common in rural Nigeria)
- **Land title verification:** Integrate with Nigeria's land registry APIs for ownership verification

## Built With

- Gemini 2.5 Flash (Live API)
- Google GenAI SDK (Python)
- Google Cloud Run
- Google Maps Static API
- FastAPI
- Next.js / React
- TailwindCSS
- WebRTC / Web Audio API
- Docker
- Python (pyproj, shapely)

---

## Links

- **Live App:** https://afriland-scout-881321169316.us-central1.run.app
- **GitHub:** https://github.com/ikoroe/afriland-scout
- **Architecture Diagram:** Included in `docs/architecture-diagram.png` and uploaded to Devpost image carousel
