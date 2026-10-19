# Blazing TV（Android TV 客户端）

把局域网里的 MoonTV（BLAZING-TV）包装成电视 APP：全屏 WebView + 遥控器导航，适配 Sony BRAVIA Google TV。

## 功能

- 全屏加载 MoonTV，默认地址 `http://192.168.0.200:3000`（`app/build.gradle` 的 `DEFAULT_SERVER`）
- 遥控器空间导航：方向键在可点击元素间移动，画面跟随焦点滚动（MoonTV 是 `<body>` 滚动）
- 播放器：确认键全屏 / 暂停，全屏时左右键快退 / 快进 10 秒，媒体键可用
- 返回键：退出全屏 → 返回上一页（跳过播放页切集产生的历史）→ 首页连按两次退出
- 长按返回键打开菜单：刷新、回首页、界面大小、修改服务器地址
- 界面大小（100% / 90% / 80% / 70%）：调大网页 viewport 宽度让 WebView 整体缩小，一屏显示更多海报；设置会保存
- 连不上服务器时显示提示页，可重试或改地址
- 遥控器改键（无障碍服务「Blazing TV · 遥控器改键」，需在 设置 → 系统 → 无障碍 里手动开启）
  - Hulu 键 → Blazing TV
  - U-NEXT 键 → Moonlight
  - 其他键保持原功能（Sony 应用键共用 keyCode 196，按扫描码区分：Hulu `0x1e6`、U-NEXT `0x1e8`、YouTube `0x1e5`）

## 构建

需要 Android SDK（compileSdk 34）和 JDK 17+（Android Studio 自带的 JBR 即可）。

```bash
cd blazing-tv-app
./gradlew assembleRelease        # Windows: gradlew.bat assembleRelease
```

产物：`app/build/outputs/apk/release/app-release.apk`。release 使用 debug 证书签名，便于直接 adb 安装（仅供自用）。

## 安装到电视

电视需打开 开发者选项 → ADB 调试。

```bash
adb connect <电视IP>:5555
adb install -r app/build/outputs/apk/release/app-release.apk
```

## 目录

| 路径                                                   | 说明                                         |
| ------------------------------------------------------ | -------------------------------------------- |
| `app/src/main/java/com/blazing/tv/MainActivity.java`   | WebView 外壳、按键处理、全屏、返回逻辑、菜单 |
| `app/src/main/java/com/blazing/tv/HuluKeyService.java` | 遥控器改键（无障碍服务）                     |
| `app/src/main/assets/tv-nav.js`                        | 注入网页的遥控器导航脚本                     |
| `app/src/main/assets/error.html`                       | 离线提示页                                   |
| `design/`                                              | 图标与横幅源文件、绘制脚本                   |
