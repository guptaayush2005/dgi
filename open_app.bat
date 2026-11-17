@echo off
cd /d "%~dp0"
echo ========================================================
echo   DGI Library Management System (DGI LMS)
echo   Dronacharya Group of Institutions, Greater Noida
echo ========================================================
echo.
echo Default Admin Credentials:
echo   Username: admin
echo   Password: admin123
echo.

where node >nul 2>nul
if %ERRORLEVEL% equ 0 (
  echo Starting server and opening browser at http://localhost:3000 ...
  start http://localhost:3000
  node server.js
) else (
  echo Node.js not detected on PATH. Opening LMS directly in browser...
  start login.html
)
pause
