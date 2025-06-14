@echo off
echo Starting Node.js application and Cloudflare Tunnel...

cd /D "e:\𓄀\wildcherry\Wormhole eE7XL0"

echo Starting Node.js application in the background...
start /B "NodeApp" "C:\Program Files\nodejs\node.exe" server.js

echo Waiting for Node.js app to start (5 seconds)...
timeout /t 5 /nobreak >nul

echo Starting Cloudflare Tunnel in the background...
start /B "CloudflareTunnel" .\cloudflared.exe tunnel --url http://localhost:3001

echo Both processes have been started in the background.
