Write-Host "🚀 Starting Secure File Sharing Platform..." -ForegroundColor Cyan

# Start backend
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$PSScriptRoot\backend'; npm start" -WindowStyle Normal

# Brief pause so backend can initialize
Start-Sleep -Seconds 2

# Start frontend
Start-Process powershell -ArgumentList "-NoExit", "-Command", "cd '$PSScriptRoot\frontend'; npm run dev" -WindowStyle Normal

Write-Host "✅ Both servers launched!" -ForegroundColor Green
Write-Host "   Backend  →  http://localhost:3001" -ForegroundColor DarkGray
Write-Host "   Frontend →  http://localhost:3000" -ForegroundColor DarkGray
