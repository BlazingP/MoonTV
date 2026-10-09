# Kazumi 规则接入 MoonTV

独立的 Python 适配服务读取 Kazumi XPath 规则，输出 MoonTV 支持的苹果 CMS V10 格式。MoonTV 原有来源继续使用原来的接口。新增的媒体入口 `/api/kazumi/media/…` 转发到 Docker 内网的适配服务，电视不需要访问 Docker 容器名称或内部端口。

## 本次支持范围

- XPath GET / POST 搜索、相对选择器、剧集和多条线路。
- 默认包含官方 KazumiRules 的 **MXdm 2.4** 快照，来源提交见 `rules-source.json`，MIT 许可保留在 `rules/LICENSE`。
- 搜索最多展开前 8 个作品、每个作品前 4 条线路；线路作为独立结果返回。
- 直接 HLS、常见内嵌播放器数据、iframe，以及可选 Chromium 嗅探。
- HLS 多码率、音轨、字幕、密钥和初始化片段中的 URI 重写；分片流式转发、Range / HEAD、原始链接查询参数保留。
- 本服务不转码，不需要 GPU。转发视频会消耗执行主机带宽。

**不支持** API/JSONPath 规则、登录、验证码交互、DRM、纯 MP4 来源、需要专用客户端的私有解析协议。弹幕、Anime4K、Kazumi 收藏同步不在本次范围。规则解析支持不代表每个来源都能播放；网站、CDN、IP 地区限制变化时仍需实测。Chromium 模式用于执行播放页脚本，不处理人机验证。

## 执行主机部署

需要 Docker Compose v2。以下命令在此仓库根目录执行，使用包含本次改动的代码。现有 `Brunch-1` 的镜像发布流程仅监听 `main`，因此不要认为拉取原 `latest` 镜像就包含本次修改；下面明确使用本地源码构建。

1. 备份执行主机实际使用的 Compose、`config.json` 和 Redis 数据。若现有 Compose 与仓库版本不同，以执行主机版本为准，把新增服务和环境变量合并进去，保留原有账号、密码、域名、端口及存储配置。
2. 生成独立配置，将示例 URL 换成**电视实际访问 MoonTV 的地址**（局域网地址也可以）：

   ```bash
   node scripts/setup-kazumi.mjs https://tv.example.com
   # 如执行主机配置不在仓库根目录，可传入实际配置文件：
   # node scripts/setup-kazumi.mjs https://tv.example.com /path/to/existing-config.json
   ```

   会生成 `.env.kazumi`（随机签名密钥）和 `config.kazumi.json`（保留原来源并添加 Kazumi），不覆盖原 `config.json`，也不覆盖已有生成配置。只有这两个文件在本地生成，它们已加入 `.gitignore`。

   **妥善保留 `.env.kazumi` 的密钥。** 它签名作品 ID 和媒体链接，重建容器不应更换；主动更换会使旧的 Kazumi 收藏 ID 和播放链接失效，需重新搜索。

   如果执行主机已用 `.env` 提供原服务的密码等变量，启动时同时传入两份文件，例如 `--env-file .env --env-file .env.kazumi`，不要遗漏原有配置。也可把生成的三项 `KAZUMI_*` 合入现有环境管理方式。

3. 先检查合并配置，再构建和启动：

   ```bash
   docker compose --env-file .env.kazumi -f docker-compose.yml -f docker-compose.kazumi.yml config --quiet
   docker compose --env-file .env.kazumi -f docker-compose.yml -f docker-compose.kazumi.yml up -d --build
   ```

   适配服务没有对主机发布端口；只有 MoonTV 能通过容器网络使用 `/vod/mxdm`。Compose 为它设置了 1 GB 内存、1.5 CPU 和 256 MB 共享内存上限；执行主机需有相应余量。若不需要 Chromium，在 `.env.kazumi` 设 `KAZUMI_BROWSER=false`。

4. 检查适配服务，然后在 MoonTV 搜索并选择 `Kazumi · MXdm`：

   ```bash
   docker compose --env-file .env.kazumi -f docker-compose.yml -f docker-compose.kazumi.yml exec kazumi-bridge python -c "import urllib.request; print(urllib.request.urlopen('http://127.0.0.1:8787/health').read().decode())"
   docker compose --env-file .env.kazumi -f docker-compose.yml -f docker-compose.kazumi.yml logs --tail=60 kazumi-bridge
   ```

   需要实测：搜索、选集、播放声音、拖动、下一集和电视端播放。若使用反向代理，请允许 `/api/kazumi/media/` 流式响应、Range 请求以及至少 45 秒的上游响应等待，不要缓存错误响应。公开地址必须与客户端可访问的协议、主机和端口一致。

## 数据与访问边界

- 媒体地址使用 HMAC 签名，作品 ID 不依赖内存缓存，服务重启后保持有效。
- 剧集入口有效期 24 小时，播放列表里的分片地址有效期 4 小时；过期后重新打开详情即可取得新链接。
- 媒体路由不要求 MoonTV Cookie，以兼容 OrionTV / 原生播放器，但适配服务验证每个签名。不能将它当作任意 URL 代理使用。
- MoonTV 不向适配服务转发账号 Cookie 或 Authorization。HTTP 请求及重定向只允许公网 HTTP(S) 80/443 端口，DNS 返回私网地址会被拒绝。
- Chromium 的 HTTP 请求也通过同一网络校验器，关闭 Service Worker 和 WebSocket；未向它提供用户浏览器资料或登录会话。
- 媒体签名地址是临时访问凭据。适配服务不记访问日志；请在外层代理中避免记录完整签名路径。规则自定义 UA / Referer 会编码进签名地址，不要把密码或私密凭据放入规则字段。

## 更新规则

把兼容的 XPath JSON 放入 `services/kazumi-bridge/rules/`，文件名使用小写字母、数字、下划线或短横线。不自动拉取或执行远程规则脚本。

新增规则需要在 `config.kazumi.json` 的 `api_site` 增加来源，例如：

```json
"kazumi_example": {
  "name": "Kazumi · Example",
  "api": "http://kazumi-bridge:8787/vod/example"
}
```

不要设置此来源的 `detail` 字段，否则 MoonTV 会改走原来的特殊网页详情解析器。修改规则后重启适配服务；修改文件来源配置后重启 MoonTV。已有管理员禁用的来源保持禁用，可在后台重新启用。

## 回滚

恢复原来的 Compose 启动方式及原 `config.json` 挂载，移除 `KAZUMI_BRIDGE_URL` 环境变量。在 MoonTV 后台禁用添加的 `kazumi_*` 来源（数据库可能保留它们），再停止 `kazumi-bridge` 服务。保留 Redis 数据和签名文件，勿使用 `down -v`。

## 代码检查

```bash
python -m pip install -r services/kazumi-bridge/requirements.txt
python -m unittest discover -s services/kazumi-bridge/tests -v
node --test scripts/test-kazumi-proxy.cjs
pnpm gen:runtime
pnpm typecheck
```

可选的实际来源检查只搜索和读取播放列表，不下载整集：

```bash
python services/kazumi-bridge/smoke.py
python services/kazumi-bridge/smoke.py --browser
```

容器构建、执行主机网络及电视实际播放需要在执行主机验收。Windows 下 Next.js standalone 打包可能因为系统符号链接权限失败，应在目标 Linux / Docker 环境执行生产构建。
