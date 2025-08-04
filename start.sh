#!/bin/bash

# 设置颜色
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}           MoonTV 一键启动脚本${NC}"
echo -e "${BLUE}========================================${NC}"
echo

echo -e "${YELLOW}[1/4] 检查 Docker 环境...${NC}"
if ! command -v docker &> /dev/null; then
    echo -e "${RED}❌ Docker 未安装，请先安装 Docker${NC}"
    exit 1
fi

if ! command -v docker-compose &> /dev/null; then
    echo -e "${RED}❌ Docker Compose 未安装，请先安装 Docker Compose${NC}"
    exit 1
fi

echo -e "${GREEN}✅ Docker 环境正常${NC}"

echo
echo -e "${YELLOW}[2/4] 停止旧容器（如果存在）...${NC}"
docker-compose down > /dev/null 2>&1
echo -e "${GREEN}✅ 清理完成${NC}"

echo
echo -e "${YELLOW}[3/4] 拉取最新镜像...${NC}"
if ! docker-compose pull; then
    echo -e "${RED}❌ 镜像拉取失败，请检查网络连接${NC}"
    exit 1
fi
echo -e "${GREEN}✅ 镜像拉取完成${NC}"

echo
echo -e "${YELLOW}[4/4] 启动 MoonTV 服务...${NC}"
if ! docker-compose up -d; then
    echo -e "${RED}❌ 服务启动失败${NC}"
    exit 1
fi

echo
echo -e "${BLUE}========================================${NC}"
echo -e "${GREEN}✅ MoonTV 启动成功！${NC}"
echo
echo -e "${BLUE}🌐 访问地址: http://localhost:3000${NC}"
echo -e "${BLUE}👤 默认账号: admin${NC}"
echo -e "${BLUE}🔑 默认密码: admin123456${NC}"
echo
echo -e "${YELLOW}💡 提示：${NC}"
echo -e "   - 首次启动可能需要等待1-2分钟"
echo -e "   - 可以修改 docker-compose.yml 中的密码"
echo -e "   - 使用 ./stop.sh 停止服务"
echo -e "${BLUE}========================================${NC}"
echo