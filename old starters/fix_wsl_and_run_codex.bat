@echo off
REM This is a troubleshooting batch file to fix WSL issues and run Codex with a direct API key

echo === WSL and Codex Troubleshooter ===
echo.
echo This script will attempt to fix common WSL issues and launch Codex.
echo.

REM Get the directory where this BAT file is located
set "WIN_DIR=%~dp0"
REM Convert the Windows directory to a Linux path using wslpath
for /f "delims=" %%i in ('wsl.exe wslpath "%WIN_DIR%" 2^>nul') do set "LINUX_DIR=%%i"

REM Ask for the OpenAI API key
set /p "OPENAI_API_KEY=Enter your OpenAI API key (starts with sk-): "
echo.

echo === Step 1: Checking WSL status ===
wsl.exe --status
echo.

echo === Step 2: Attempting to fix WSL permission issues ===
REM Try to create a test file to verify write access
wsl.exe --distribution Ubuntu --user root -e bash -c "echo 'test' > /tmp/test.txt && echo 'WSL file creation: SUCCESS' || echo 'WSL file creation: FAILED'"
echo.

echo === Step 3: Setting API key for this session ===
echo Using API key directly for this session...
echo.

echo === Step 4: Launching Codex with direct API key ===
wsl.exe --distribution Ubuntu -e bash -c "export OPENAI_API_KEY='%OPENAI_API_KEY%' && cd '%LINUX_DIR%' && codex"

echo.
echo If Codex still failed to start, you may need to repair your WSL installation.
echo Try running: wsl --shutdown
echo Then try again.
echo.
pause 