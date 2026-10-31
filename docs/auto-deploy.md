# 自动部署（NUC 轮询 origin/app）

在另一台电脑 `git push` 到 `origin/app` 后，NUC 会在几分钟内自动 `git pull` 并重新构建、重启容器。仅限局域网：NUC 主动轮询 GitHub，不开放任何入站端口，也不使用 webhook。

```
另一台 PC ──push──▶ GitHub origin/app ◀──每 5 分钟 git fetch── NUC 计划任务
                                                              │ 有新提交
                                                              ▼
                              git pull --ff-only → docker compose up -d --build
```

## 它做了什么

`scripts/auto-deploy.ps1` 每次运行：

1. `git fetch origin app`。本地 HEAD 与 `origin/app` 相同，并且这个版本已经部署成功（记录在 `logs/deployed-sha`）或已确认构建失败（记录在 `logs/failed-sha`），则静默退出。
2. 需要部署时先做安全检查，任何一项不满足就**拒绝部署**并写日志（退出码 1），**不会** reset / stash / 丢弃任何东西：
   - 当前分支必须是 `app`；
   - 已跟踪文件不能有未提交修改（未跟踪文件如 `.env.kazumi` 不受影响，脚本也不会读取或修改它）；
   - 本地不能领先于 `origin/app`（有未推送的提交）。
3. 有新提交时 `git pull --ff-only origin app`，不是快进则停止。
4. 用 `docker info` 确认 Docker 引擎可用。刚开机时 Docker Desktop 可能还没启动，此时只写一行日志，**下一轮自动重试**。
5. 执行与手动部署等价的命令，成功后把版本写入 `logs/deployed-sha`：

   ```powershell
   docker compose --env-file .env.kazumi -f docker-compose.yml -f docker-compose.kazumi.yml up -d --build
   ```

6. 单实例锁（`logs/auto-deploy.lock`）：构建需要 5-10 分钟，可能超过轮询间隔，后一次运行发现锁存在会直接跳过。锁所属进程已不存在，或锁超过 2 小时，视为陈旧锁并自动清除。

日志写入 `logs/auto-deploy.log`（已加入 `.gitignore`），超过 1 MB 时轮转为 `auto-deploy.log.1`（只保留上一份）。

## 一次性安装（在 NUC 上）

1. 确认 Docker Desktop 已启动，NUC 保持登录状态（见下方说明）。
2. 在 `C:\python\MoonTV` 打开 PowerShell，先手动拉取一次，确保 `app` 分支已是最新且工作区干净：

   ```powershell
   cd C:\python\MoonTV
   git status
   git pull
   ```

3. 安装计划任务：

   ```powershell
   Set-ExecutionPolicy -Scope Process Bypass
   .\scripts\install-auto-deploy.ps1
   ```

   默认每 5 分钟运行一次，可用 `-IntervalMinutes 10` 修改。重复运行会更新已有任务，不会产生重复任务。

   第一次运行时还没有 `logs/deployed-sha`，脚本会把当前版本完整构建部署一次（5-10 分钟），之后只在有新提交时构建。

4. 立即试跑一次（可选）：

   ```powershell
   powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\auto-deploy.ps1
   ```

为什么用「仅在用户登录时运行」：Docker Desktop 的引擎和 `docker` 命令都运行在登录用户的会话里，以 SYSTEM 或「无论是否登录都运行」的方式启动任务可能连不上 Docker，还需要保存账户密码。因此建议 NUC 开启自动登录，并让 Docker Desktop 随登录启动。

## 查看日志

```powershell
Get-Content C:\python\MoonTV\logs\auto-deploy.log -Tail 50
Get-ScheduledTaskInfo -TaskName 'MoonTV Auto Deploy'      # 上次运行时间与结果
docker compose ps                                          # 构建期间看容器状态
```

没有新提交时不会写日志，所以日志为空或很久没更新是正常的。构建输出在 `docker compose` 结束后才一次性写入日志，构建进行中日志不会实时更新；构建输出里的中文可能显示为乱码，不影响判断成功与否。

## 暂停、恢复与卸载

```powershell
Disable-ScheduledTask -TaskName 'MoonTV Auto Deploy'   # 暂停（比如要在 NUC 上手动改代码时）
Enable-ScheduledTask  -TaskName 'MoonTV Auto Deploy'   # 恢复
.\scripts\install-auto-deploy.ps1 -Uninstall            # 卸载
```

## 构建失败会怎样

`docker compose up -d --build` 会先构建全部镜像，构建成功之后才创建/重启容器。因此**镜像构建失败时旧容器不会被停止，旧版本继续对外服务**。日志会记录 `DEPLOY FAILED` 及构建输出。

失败的版本会记入 `logs/failed-sha`，**同一版本不会每轮反复重新构建**。修复后向 `app` 推一个新提交即可自动部署；如果失败原因在 NUC 本地（比如磁盘满了），处理后删除 `logs/failed-sha`，下一轮会重新构建该版本。

Docker 引擎不可用（未启动、正在重启）不算构建失败：脚本在构建前用 `docker info` 检查，连不上时不记失败，下一轮自动重试。

另外，如果镜像构建成功但新容器启动失败（例如配置错误），旧容器此时已被替换，不再保证旧版本可用，需要根据日志排查。

## Git 认证必须能非交互运行

计划任务没有终端，不能弹出账号密码提示（脚本设置了 `GIT_TERMINAL_PROMPT=0`，需要凭据时会直接失败并写日志）。`origin` 是公开仓库 `https://github.com/BlazingP/MoonTV.git`，通过 https 只读 fetch 不需要任何凭据。验证方法：

```powershell
cd C:\python\MoonTV
$env:GIT_TERMINAL_PROMPT = '0'
git fetch origin app
```

能直接成功、没有任何提示即可。如果将来仓库改为私有，需要先配置 Git Credential Manager 或 SSH key，并确认上面命令在计划任务的运行账户下不弹提示。

## 常见问题

- 日志出现 `REFUSED: tracked files have local modifications`：NUC 上改过已跟踪文件。用 `git diff` 查看后，提交、还原或 stash，下一轮会自动继续。
- 日志出现 `git pull --ff-only failed`：本地和远程分叉了，需要手动处理，脚本不会强行覆盖。
- 日志出现 `Another auto-deploy run is active`：上一次构建还没结束，属于正常现象。
- 日志反复出现 `Docker engine not reachable yet`：Docker Desktop 没有启动，打开它即可，下一轮会自动部署。
- 想强制重新部署当前版本：删除 `logs/deployed-sha` 和 `logs/failed-sha`，下一轮会重新构建。
