"""WebSocket broadcast manager."""

import asyncio
from typing import List
from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from app.state import app_state

router = APIRouter()


class ConnectionManager:
    """Manages active WebSocket client connections and broadcasting."""

    def __init__(self) -> None:
        self.active_connections: List[WebSocket] = []

    async def connect(self, websocket: WebSocket) -> None:
        await websocket.accept()
        self.active_connections.append(websocket)

    def disconnect(self, websocket: WebSocket) -> None:
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def broadcast(self, message: dict) -> None:
        for connection in list(self.active_connections):
            try:
                await connection.send_json(message)
            except Exception:
                self.disconnect(connection)


manager = ConnectionManager()


async def broadcast_loop() -> None:
    """Background task to broadcast the full shared state every 500ms."""
    while True:
        try:
            state = app_state.get_state()
            await manager.broadcast(state)
            await asyncio.sleep(0.5)
        except asyncio.CancelledError:
            break
        except Exception as e:
            print(f"Broadcast loop error: {e}")
            await asyncio.sleep(0.5)


@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """WebSocket endpoint to connect and receive state broadcasts."""
    await manager.connect(websocket)
    try:
        while True:
            # Maintain connection, handle client disconnects
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)
    except Exception:
        manager.disconnect(websocket)
