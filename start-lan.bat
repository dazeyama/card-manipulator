@echo off
rem LAN mode (ONLINE.md O109): the site and the local room server for every machine on your network.
rem Others open http://<this PC's address>:5173/#/room/CODE. The first run, let Windows Firewall allow Node on private networks.
cd /d "%~dp0"
if not exist node_modules call npm install
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4 Address"') do (
  for /f "tokens=*" %%b in ("%%a") do echo On this network, others open http://%%b:5173
)
start "" http://localhost:5173
npm run dev:lan
