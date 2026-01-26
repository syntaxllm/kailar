Write-Host "🚀 Starting Skarya.AI Meeting Bot Ecosystem..." -ForegroundColor Cyan

# 1. STT Service (Python)
Write-Host "1️⃣  Launching STT Service (Port 4545)..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit", "-Command", "& {cd services\stt-service; Write-Host 'Installing Python deps...'; pip install -r requirements.txt; python main.py}"

# 2. Bot Service (Node.js)
Write-Host "2️⃣  Launching Bot Service (Port 6767)..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit", "-Command", "& {cd services\bot-service; Write-Host 'Installing Bot deps...'; npm install; node index.js}"

# 3. Main Application (Next.js)
Write-Host "3️⃣  Launching Main Web App (Port 5656)..." -ForegroundColor Yellow
Start-Process powershell -ArgumentList "-NoExit", "-Command", "& {npm install; npm run dev}"

Write-Host "✅ All services initiated in background windows!" -ForegroundColor Green
Write-Host "   - Web App: http://localhost:5656"
Write-Host "   - Bot Service: http://localhost:6767"
Write-Host "   - STT Service: http://localhost:4545"
