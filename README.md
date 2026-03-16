# Afriland Scout (TerraVision)

Real-time, multimodal AI land surveying agent built for the **Gemini Live Agent Challenge**.

A user walks the perimeter of a plot with their phone, streaming live camera + microphone input to Gemini 2.5 Flash via the Live API. The AI guides the survey, records GPS boundary points, computes precise geodesic area, assesses terrain risk, and can generate architectural renders of what could be built on the land.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16, React 19, TailwindCSS 4, WebRTC |
| Backend | Python 3.12, FastAPI, WebSockets |
| AI | Gemini 2.5 Flash (Live API / bidiGenerateContent) |
| Tools | Google Maps Static API, Earth Engine (stub), Vertex AI Imagen 3 (stub) |
| Deployment | Docker, Google Cloud Run |

## Local Development

### Prerequisites
- Python 3.11+
- Node.js 20+
- A [Gemini API key](https://aistudio.google.com/apikey)

### Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate
pip install -r ../requirements.txt
export GOOGLE_API_KEY=your-key-here
uvicorn main:app --reload --port 8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:3000, click **Connect**, and start talking or type a message.

## Deploy to Cloud Run

### 1. Build the Docker image

```bash
gcloud builds submit --tag gcr.io/YOUR_PROJECT_ID/afriland-scout
```

### 2. Deploy

```bash
gcloud run deploy afriland-scout \
  --image gcr.io/YOUR_PROJECT_ID/afriland-scout \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated \
  --set-env-vars "GOOGLE_API_KEY=your-key,GOOGLE_MAPS_API_KEY=your-maps-key" \
  --memory 1Gi \
  --cpu 1 \
  --port 8080 \
  --session-affinity
```

The `--session-affinity` flag is important for WebSocket connections.

### 3. Access

Cloud Run will give you a URL like `https://afriland-scout-XXXXX-uc.a.run.app`. The frontend runs on port 3000 inside the container and the backend on port 8080 (the externally exposed port).

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `GOOGLE_API_KEY` | Yes | Gemini API key from AI Studio |
| `GOOGLE_MAPS_API_KEY` | No | For satellite map polygon overlay |
| `GEMINI_LIVE_MODEL` | No | Override model (default: `gemini-2.5-flash-native-audio-preview-12-2025`) |

## License

Built for the Gemini Live Agent Challenge 2026.
