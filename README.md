# gridZERO

Real-time telemetry, detection, and mission command dashboard.

## Project Structure

```text
gridZERO/
  backend/
    app/
      __init__.py
      main.py          # FastAPI app entrypoint
      telemetry.py     # MAVLink connection + telemetry state
      detection.py     # YOLO inference pipeline
      ws.py            # WebSocket broadcast manager
      state.py         # Shared in-memory mission/telemetry/detection state
    requirements.txt
  frontend/            # Frontend application (to be scaffolded in Phase 3)
  README.md
```

## Backend Quickstart

1. Navigate to the `backend` directory:
   ```bash
   cd backend
   ```

2. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

3. Run the development server:
   ```bash
   uvicorn app.main:app --reload
   ```

4. Verify health endpoint:
   ```bash
   curl http://127.0.0.1:8000/health
   ```
