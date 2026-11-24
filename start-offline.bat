@echo off
rem Builds the app and serves the finished copy on http://localhost:4173. Unlike start-dev this one installs the offline cache
rem (service worker): once opened online, the app and the pages you have visited open again with no signal.
cd /d "%~dp0"
call npm run build
ping -t 127.0.0.1 | npx vite preview --port 4173
