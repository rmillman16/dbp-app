@echo off
rem Starts the DBP app on http://localhost:5173 (development copy, always shows the latest code).
rem Leave this window open while you use the app. The "ping" keeps the server from closing itself.
cd /d "%~dp0"
ping -t 127.0.0.1 | npm run dev
