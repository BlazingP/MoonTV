@echo off
chcp 65001 >nul
echo ========================================
echo           MoonTV 一键启动脚本
echo ========================================
echo.

echo [1/4] 检查 Docker 环境...
docker --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ Docker 未安装或未启动，请先安装 Docker Desktop
    pause
    exit /b 1
)
echo ✅ Docker 环境正常

echo.
echo [2/4] 停止旧容器（如果存在）...
docker-compose down >nul 2>&1
echo ✅ 清理完成

echo.
echo [3/4] 拉取最新镜像...
docker-compose pull
if %errorlevel% neq 0 (
    echo ❌ 镜像拉取失败，请检查网络连接
    pause
    exit /b 1
)
echo ✅ 镜像拉取完成

echo.
echo [4/4] 启动 MoonTV 服务...
docker-compose up -d
if %errorlevel% neq 0 (
    echo ❌ 服务启动失败
    pause
    exit /b 1
)

echo.
echo ========================================
echo ✅ MoonTV 启动成功！
echo.
echo 🌐 访问地址: http://localhost:3000
echo 👤 默认账号: admin
echo 🔑 默认密码: admin123456
echo.
echo 💡 提示：
echo    - 首次启动可能需要等待1-2分钟
echo    - 可以修改 docker-compose.yml 中的密码
echo    - 使用 stop.bat 停止服务
echo ========================================
echo.
pause