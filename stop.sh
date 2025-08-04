#!/bin/bash

# 设置颜色
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}           MoonTV 停止服务脚本${NC}"
echo -e "${BLUE}========================================${NC}"
echo

echo -e "${YELLOW}[1/2] 停止 MoonTV 服务...${NC}"
if ! docker-compose down; then
    echo -e "${RED}❌ 服务停止失败${NC}"
    exit 1
fi
echo -e "${GREEN}✅ 服务已停止${NC}"

echo
echo -e "${YELLOW}[2/2] 清理未使用的镜像（可选）...${NC}"
read -p "是否清理未使用的 Docker 镜像？(y/N): " cleanup
if [[ $cleanup =~ ^[Yy]$ ]]; then
    docker image prune -f
    echo -e "${GREEN}✅ 镜像清理完成${NC}"
else
    echo -e "${YELLOW}⏭️ 跳过镜像清理${NC}"
fi

echo
echo -e "${BLUE}========================================${NC}"
echo -e "${GREEN}✅ MoonTV 已完全停止！${NC}"
echo -e "${BLUE}========================================${NC}"
echo