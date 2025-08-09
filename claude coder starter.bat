@echo off
REM ───────────────────────────────────────────────
REM  Claude Code launcher for Windows (WSL Ubuntu)
REM  • Put this .bat in your project folder
REM  • Double-click or run from CMD/PowerShell
REM  • Requires: Ubuntu in WSL + Claude Code installed there
REM ───────────────────────────────────────────────

REM 1) Get the Windows dir where this BAT lives
set "WIN_DIR=%~dp0"

REM 2) Convert that path to Linux for WSL
for /f "delims=" %%i in ('wsl wslpath "%WIN_DIR%"') do set "LINUX_DIR=%%i"

REM 3) Hop into Ubuntu, cd to the repo, and launch Claude
REM    -ic  ➜ interactive shell (reads ~/.bashrc so your API key loads)
wsl -d Ubuntu bash -ic "cd \"$LINUX_DIR\" && claude"

pause
