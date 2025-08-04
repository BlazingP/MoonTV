@echo off
echo ========================================
echo           MoonTV Stop Script
echo ========================================
echo.

echo [1/2] Stopping MoonTV service...
docker-compose down
if %errorlevel% neq 0 (
    echo Failed to stop service
    pause
    exit /b 1
)
echo Service stopped successfully

echo.
echo [2/2] Cleaning up unused images (optional)...
set /p cleanup="Do you want to clean up unused Docker images? (y/N): "
if /i "%cleanup%"=="y" (
    echo Cleaning up unused images...
    docker image prune -f
    echo Cleanup completed
) else (
    echo Skipping cleanup
)

echo.
echo ========================================
echo MoonTV stopped successfully!
echo.
echo To restart: run start-en.bat or start.bat
echo To view logs: docker-compose logs
echo ========================================
echo.
pause