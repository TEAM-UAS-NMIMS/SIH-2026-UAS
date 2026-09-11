Write-Host "Starting gridZERO..." -ForegroundColor Cyan
Write-Host "Backend API:  http://localhost:8000" -ForegroundColor Green
Write-Host "Frontend App: http://localhost:5173" -ForegroundColor Green
Write-Host "Press Ctrl+C to stop both services." -ForegroundColor Yellow
Write-Host "--------------------------------------------------------"

# Determine npm command name based on OS (Windows requires npm.cmd for Start-Process)
$npmCmd = if ($IsWindows) { "npm.cmd" } else { "npm" }

# Start both processes in the background, keeping them in the current console (-NoNewWindow)
$backend = Start-Process -FilePath "python" -ArgumentList "-m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload" -WorkingDirectory ".\backend" -PassThru -NoNewWindow
$frontend = Start-Process -FilePath $npmCmd -ArgumentList "run dev" -WorkingDirectory ".\frontend" -PassThru -NoNewWindow

try {
    # Wait for either process to exit (or wait indefinitely until Ctrl+C)
    Wait-Process -Id $backend.Id, $frontend.Id
} finally {
    Write-Host "`nStopping services..." -ForegroundColor Red
    Stop-Process -Id $backend.Id, $frontend.Id -Force -ErrorAction SilentlyContinue
}
