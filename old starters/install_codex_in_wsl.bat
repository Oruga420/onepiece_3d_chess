@echo off
echo Installing Codex in WSL Ubuntu...
echo This may take a minute...

wsl.exe -d Ubuntu -e bash -c "npm install -g @openai/codex"

echo.
echo Installation complete. You can now use the 'codex starter.bat' file to launch Codex.
pause 