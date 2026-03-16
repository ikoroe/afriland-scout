import asyncio
import json

import websockets


async def main() -> None:
    uri = "ws://localhost:8000/live"
    async with websockets.connect(uri) as ws:
        message = {"type": "control", "text": "Introduce yourself briefly as Afriland Scout."}
        await ws.send(json.dumps(message))

        try:
            for _ in range(10):
                raw = await ws.recv()
                print("EVENT:", raw)
        except Exception as exc:
            print("WebSocket closed or error:", exc)


if __name__ == "__main__":
    asyncio.run(main())

