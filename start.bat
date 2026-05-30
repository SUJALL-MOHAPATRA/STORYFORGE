@echo off
title StoryForge — AI Story Generator

echo.
echo  ✦ StoryForge — Starting up...
echo  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo.

:: Check Python
python --version >nul 2>&1
if errorlevel 1 (
    echo  [ERROR] Python not found. Install from https://python.org
    pause
    exit /b 1
)

:: Install dependencies if needed
echo  Installing / checking dependencies...
pip install -r requirements.txt -q

echo.
echo  ✦ Starting server at http://localhost:8000
echo  ✦ Press Ctrl+C to stop
echo  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
echo.

:: Open browser after 2 seconds (background)
start /b cmd /c "timeout /t 2 >nul && start http://localhost:8000"

:: Run the app
cd backend
python -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload

pause
