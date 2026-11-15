@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
where node.exe >nul 2>nul
if errorlevel 1 (
  echo Node.js bulunamadi. README.md dosyasindaki kurulum adimlarina bakin.
  pause
  exit /b 1
)
node -e "const [major,minor]=process.versions.node.split('.').map(Number); process.exit(major < 22 || (major === 22 && minor < 12) ? 1 : 0)"
if errorlevel 1 (
  echo ViralCut icin Node.js 22.12 veya daha yeni bir surum gerekli.
  goto failed
)
where npm.cmd >nul 2>nul
if errorlevel 1 (
  echo npm bulunamadi. Node.js kurulumunu kontrol edin.
  goto failed
)
call npm.cmd ls --all >nul 2>nul
if errorlevel 1 (
  call npm.cmd ci --no-audit --no-fund
  if errorlevel 1 goto failed
)
node scripts\start-local.mjs
if errorlevel 1 goto failed
exit /b 0

:failed
echo.
echo ViralCut başlatılamadı. Yukarıdaki hata mesajını kontrol edin.
pause
exit /b 1
