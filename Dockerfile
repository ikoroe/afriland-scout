# ============================================================
# Stage 1: Build the Next.js frontend (static export)
# ============================================================
FROM node:20-alpine AS frontend-build

WORKDIR /app/frontend
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci --prefer-offline
COPY frontend/ .
RUN npm run build

# ============================================================
# Stage 2: Python backend + static frontend
# ============================================================
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

# Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend source
COPY backend/ ./backend/

# Copy Next.js static export (output: "export" produces an "out" folder)
COPY --from=frontend-build /app/frontend/out ./static

EXPOSE 8080

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8080"]
WORKDIR /app/backend
