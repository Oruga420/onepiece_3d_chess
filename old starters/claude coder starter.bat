@echo off
REM Get the directory where this BAT file is located
set "WIN_DIR=%~dp0"
REM Convert the Windows directory to a Linux path using wslpath
for /f "delims=" %%i in ('wsl.exe wslpath "%WIN_DIR%"') do set "LINUX_DIR=%%i"
REM Launch Ubuntu WSL, change to the dynamic directory, and run claude
wsl.exe -d Ubuntu -e bash -c "cd '%LINUX_DIR%' && claude"
pause
