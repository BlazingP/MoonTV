@echo off
chcp 65001 >nul
echo ========================================
echo           MoonTV 停止服务脚本
echo ========================================
echo.

echo [1/2] 停止 MoonTV 服务...
docker-compose down
if %errorlevel% neq 0 (
    echo ❌ 服务停止失败
    pause
    exit /b 1
)
echo ✅ 服务已停止

echo.
echo [2/2] 清理未使用的镜像（可选）...
set /p cleanup="是否清理未使用的 Docker 镜像？(y/N): "
if /i "%cleanup%"=="y" (
    docker image prune -f
    echo ✅ 镜像清理完成
) else (
    echo ⏭️ 跳过镜像清理
)

echo.
echo ========================================
echo ✅ MoonTV 已完全停止！
echo ========================================
echo.
pause