@echo off
echo ========================================
echo           MoonTV Startup Script
echo ========================================
echo.

echo [1/4] Checking Docker environment...
docker --version >nul 2>&1
if %errorlevel% neq 0 (
    echo Docker is not installed or not running, please install Docker Desktop first
    pause
    exit /b 1
)
echo Docker environment is ready

echo.
echo [2/4] Stopping old containers (if exists)...
docker-compose down >nul 2>&1
echo Cleanup completed

echo.
echo [3/4] Pulling MoonTV image...
docker pull ghcr.io/senshinya/moontv:latest
if %errorlevel% neq 0 (
    echo MoonTV image pull failed, please check network connection
    echo Continuing with startup...
)
echo Image pull completed

echo.
echo [4/4] Starting MoonTV service...
docker-compose up -d
if %errorlevel% neq 0 (
    echo Service startup failed
    pause
    exit /b 1
)

echo.
echo ========================================
echo MoonTV service started successfully!
echo.
echo Access URL: http://localhost:3000
echo To stop service: run stop-en.bat or stop.bat
echo To view logs: docker-compose logs
echo ========================================
echo.
pause