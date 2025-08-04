@echo off
chcp 65001 >nul
echo ========================================
echo         MoonTV 部署包创建工具
echo ========================================
echo.

set PACKAGE_NAME=MoonTV-Deploy-Package
set TIMESTAMP=%date:~0,4%%date:~5,2%%date:~8,2%-%time:~0,2%%time:~3,2%%time:~6,2%
set TIMESTAMP=%TIMESTAMP: =0%
set FULL_NAME=%PACKAGE_NAME%-%TIMESTAMP%

echo [1/4] 创建部署包目录...
if exist "%FULL_NAME%" rmdir /s /q "%FULL_NAME%"
mkdir "%FULL_NAME%"
echo ✅ 目录创建完成

echo.
echo [2/4] 复制必要文件...
copy "docker-compose.yml" "%FULL_NAME%\" >nul
copy "config.json" "%FULL_NAME%\" >nul
copy "start.bat" "%FULL_NAME%\" >nul
copy "stop.bat" "%FULL_NAME%\" >nul
copy "start.sh" "%FULL_NAME%\" >nul
copy "stop.sh" "%FULL_NAME%\" >nul
copy "部署说明.md" "%FULL_NAME%\" >nul
echo ✅ 文件复制完成

echo.
echo [3/4] 创建快速启动说明...
echo # MoonTV 快速启动 > "%FULL_NAME%\README.txt"
echo. >> "%FULL_NAME%\README.txt"
echo Windows 用户: >> "%FULL_NAME%\README.txt"
echo   双击运行 start.bat >> "%FULL_NAME%\README.txt"
echo. >> "%FULL_NAME%\README.txt"
echo Linux/macOS 用户: >> "%FULL_NAME%\README.txt"
echo   chmod +x start.sh stop.sh >> "%FULL_NAME%\README.txt"
echo   ./start.sh >> "%FULL_NAME%\README.txt"
echo. >> "%FULL_NAME%\README.txt"
echo 访问地址: http://localhost:3000 >> "%FULL_NAME%\README.txt"
echo 默认账号: admin >> "%FULL_NAME%\README.txt"
echo 默认密码: admin123456 >> "%FULL_NAME%\README.txt"
echo. >> "%FULL_NAME%\README.txt"
echo 详细说明请查看: 部署说明.md >> "%FULL_NAME%\README.txt"
echo ✅ 说明文件创建完成

echo.
echo [4/4] 创建压缩包...
if exist "%FULL_NAME%.zip" del "%FULL_NAME%.zip"
powershell -command "Compress-Archive -Path '%FULL_NAME%' -DestinationPath '%FULL_NAME%.zip'"
if exist "%FULL_NAME%.zip" (
    echo ✅ 压缩包创建完成
    rmdir /s /q "%FULL_NAME%"
) else (
    echo ❌ 压缩包创建失败，保留文件夹
)

echo.
echo ========================================
echo ✅ 部署包创建完成！
echo.
echo 📦 包名称: %FULL_NAME%.zip
echo 📁 包含文件:
echo    - docker-compose.yml (Docker 编排文件)
echo    - config.json (MoonTV 配置)
echo    - start.bat/start.sh (启动脚本)
echo    - stop.bat/stop.sh (停止脚本)
echo    - 部署说明.md (详细文档)
echo    - README.txt (快速说明)
echo.
echo 💡 使用方法:
echo    1. 将压缩包发送到目标服务器
echo    2. 解压缩
echo    3. 运行对应的启动脚本
echo ========================================
echo.
pause