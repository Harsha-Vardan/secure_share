# ╔══════════════════════════════════════════════════════════════╗
# ║   SecureShare — Docker Startup Script                       ║
# ║   Starts: MongoDB 7 + Backend (Node.js) + Frontend (Next.js)║
# ╚══════════════════════════════════════════════════════════════╝

param(
    [switch]$Build,      # Force rebuild images
    [switch]$Down,       # Stop and remove containers
    [switch]$Logs,       # Follow logs after start
    [switch]$DevMode     # Run backend/frontend locally (MongoDB only in Docker)
)

Set-Location $PSScriptRoot

# ── Stop & remove ─────────────────────────────────────────────────────────────
if ($Down) {
    Write-Host "`n🛑 Stopping SecureShare..." -ForegroundColor Red
    docker compose down
    Write-Host "✅ All containers stopped." -ForegroundColor Green
    exit 0
}

# ── Dev mode: only MongoDB in Docker ──────────────────────────────────────────
if ($DevMode) {
    Write-Host "`n⚡ Dev Mode — Starting MongoDB only..." -ForegroundColor Cyan
    docker compose up -d mongodb
    Write-Host "`n✅ MongoDB is up: mongodb://localhost:27017" -ForegroundColor Green
    Write-Host "   Now run in separate terminals:" -ForegroundColor Yellow
    Write-Host "   Backend:  cd backend  && node index.js" -ForegroundColor White
    Write-Host "   Frontend: cd frontend && npm run dev`n" -ForegroundColor White
    exit 0
}

# ── Full Docker start ─────────────────────────────────────────────────────────
Write-Host @"

╔══════════════════════════════════════════════════╗
║   🔐 Secure File Transfer Platform               ║
║   Starting all services with Docker...           ║
╚══════════════════════════════════════════════════╝
"@ -ForegroundColor Cyan

# Check Docker is running
try {
    docker info 2>&1 | Out-Null
} catch {
    Write-Host "❌ Docker is not running. Please start Docker Desktop first." -ForegroundColor Red
    exit 1
}

$composeArgs = @("compose", "up", "-d")
if ($Build) { $composeArgs += "--build" }

Write-Host "`n🔧 Building & starting containers..." -ForegroundColor Yellow
docker @composeArgs

if ($LASTEXITCODE -ne 0) {
    Write-Host "`n❌ Docker Compose failed. Check the errors above." -ForegroundColor Red
    exit 1
}

Write-Host @"

✅ SecureShare is running!

   🌐 Frontend   → http://localhost:3000
   🔌 Backend    → http://localhost:3001
   🍃 MongoDB    → mongodb://localhost:27017/secureshare
   📊 API Health → http://localhost:3001/health
   📋 Activity   → http://localhost:3001/admin/logs

"@ -ForegroundColor Green

if ($Logs) {
    Write-Host "📜 Following logs (Ctrl+C to stop)..." -ForegroundColor Yellow
    docker compose logs -f
}
