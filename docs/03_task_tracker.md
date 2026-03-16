# MISSION: Afriland Scout (TerraVision)
**Goal:** Build a real-time, multimodal land surveying agent for the Gemini Live Agent Challenge.
**Tech Stack:** - Frontend: Next.js (React), TailwindCSS, WebRTC (Mic/Camera).
- Backend: Python FastAPI, WebSockets, `google-genai` SDK (Gemini Live API).
- AI Model: `gemini-2.5-flash-native-audio-preview-12-2025`
- Tools: Google Maps Static API, Google Earth Engine API (stub), Vertex AI Imagen 3 (stub).
- Deployment: Google Cloud Run via Docker.

## PHASE 1: Backend Plumbing & Live API Proxy [x]
- [x] Initialize standard Python virtual environment (`python -m venv venv`).
- [x] Create `requirements.txt`: `fastapi uvicorn websockets google-genai python-dotenv pyproj shapely google-cloud-aiplatform`.
- [x] Build `backend/main.py`: Set up a FastAPI app with a `/live` WebSocket endpoint.
- [x] Build the Gemini Live API connection: The WebSocket proxies audio (base64 PCM) and video frames from the frontend to Gemini 2.5 Flash and streams the audio response back.

## PHASE 2: Agent Brain & Tools (The "ADK" Logic) [x]
- [x] Create `backend/agent_config.py`: Define the system instructions ("You are Afriland Scout, a professional Nigerian land surveyor...").
- [x] Create `backend/tools_spatial.py`: 
    - Tool 1: `record_gps_coordinate(lat, lng)` -> stores points.
    - Tool 2: `calculate_precise_area()` -> uses pyproj/WGS84 to calculate square meters and "Plots" (600sqm).
    - Tool 3: `get_terrain_risk(lat, lng)` -> stub for Google Earth Engine elevation/slope/flood risk.
    - Tool 4: `generate_architectural_render(prompt)` -> stub for Vertex AI Imagen 3.
    - Tool 5: `get_map_url()` -> Google Maps Static API polygon overlay.
- [x] Register tools (1-4) with the Gemini Live session so the model can trigger them via function calling.

## PHASE 3: Frontend WebRTC Dashboard [x]
- [x] Initialize Next.js in the `/frontend` folder (`npx create-next-app@latest .`).
- [x] Build `page.tsx`: A dark-mode surveyor dashboard.
- [x] Add a `<video>` element for the local camera feed.
- [x] Build the WebRTC logic: Capture mic audio and camera frames (1 FPS), encode to Base64, and send to the FastAPI `ws://localhost:8000/live` endpoint.
- [x] Play back the binary audio chunks received from Gemini.
- [x] Add text chat input for typed messages.
- [x] Add "Show map" button to display polygon on satellite imagery.

## PHASE 4: Cloud Run Deployment [x]
- [x] Write a `Dockerfile` in the root directory that serves both the Next.js static build and the FastAPI Python server.
- [x] Write `start.sh` entrypoint to run both servers.
- [x] Create `.dockerignore` for clean builds.
- [x] Create `.env.example` documenting required environment variables.
- [x] Create `README.md` with local dev and `gcloud run deploy` commands.
- [x] Configure Next.js standalone output for Docker.
