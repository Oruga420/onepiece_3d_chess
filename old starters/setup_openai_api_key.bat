@echo off
REM This script adds your OpenAI API key permanently to your WSL Ubuntu bash profile

echo This will permanently store your OpenAI API key in your WSL Ubuntu environment.
echo.
set /p "OPENAI_API_KEY=Enter your OpenAI API key (sk-...): "

REM Escape any special characters in the API key
set "ESCAPED_KEY=%OPENAI_API_KEY:"=\"%"

REM Add the API key to ~/.bashrc in WSL
wsl.exe -d Ubuntu -e bash -c "echo \"export OPENAI_API_KEY='%ESCAPED_KEY%'\" >> ~/.bashrc"
wsl.exe -d Ubuntu -e bash -c "echo \"API key added to ~/.bashrc. It will be available in all new WSL Ubuntu terminals.\""
wsl.exe -d Ubuntu -e bash -c "echo \"To load it in the current session, run: source ~/.bashrc\""

echo.
echo Your OpenAI API key has been saved to your WSL Ubuntu environment.
echo You won't need to enter it again for future codex sessions.
pause 