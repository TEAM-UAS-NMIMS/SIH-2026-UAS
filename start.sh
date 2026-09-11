#!/bin/bash

echo -e "\033[1;36mStarting gridZERO...\033[0m"
echo -e "\033[1;32mBackend API:  http://localhost:8000\033[0m"
echo -e "\033[1;32mFrontend App: http://localhost:5173\033[0m"
echo -e "\033[1;33mPress Ctrl+C to stop both services.\033[0m"
echo "--------------------------------------------------------"

# Start Backend
cd backend || exit
python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload &
BACKEND_PID=$!
cd ..

# Start Frontend
cd frontend || exit
npm run dev &
FRONTEND_PID=$!
cd ..

# Trap SIGINT (Ctrl+C) and SIGTERM to kill both background processes
trap "echo -e '\n\033[1;31mStopping services...\033[0m'; kill $BACKEND_PID $FRONTEND_PID; exit" INT TERM

# Wait indefinitely so the script doesn't exit until interrupted
wait
