@echo off
cd /d "%~dp0"
set PATH=C:\Program Files\nodejs;%PATH%
echo Iniciando servidor de desenvolvimento...
echo.
echo Acesse: http://localhost:8080
echo.
echo Pressione Ctrl+C para parar o servidor
echo.
npm run dev
pause
