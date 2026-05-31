# VideoX — 极速视频播放器

跨平台视频播放器，基于 Capacitor + ExoPlayer 构建，支持全格式解码与 NAS 文件读取。

## 功能特性

- **全格式支持** — MP4、MKV、AVI、MOV、WebM、FLV、TS、3GP 等 WebView 兼容格式；RMVB、RM、WMV、VOB、DIVX、XVID、OGV 通过原生 ExoPlayer + Jellyfin FFmpeg 解码
- **隐藏文件夹扫描** — 一键切换显示/隐藏以 `.` 开头的文件夹
- **倍速播放** — 0.5× ~ 6×，单击速度按钮切换
- **快进快退** — 左右两侧手势区 ±10s，横向滑动精准拖拽进度
- **适应模式** — 循环切换 适应（黑边）→ 填充（裁剪）→ 旋转（竖屏视频转横屏）
- **投屏** — 支持 AirPlay、Chromecast、DLNA、Miracast
- **NAS 读取** — 通过 HTTP 接口读取 NAS 上的视频文件列表并流式播放
- **播放列表** — 自动连播，支持全局播放列表
- **键盘快捷键** — 空格暂停、方向键快进/音量、F 全屏（平板模式）

## 技术架构

```
VideoX
├── www/                          # Web 前端（原生 HTML/CSS/JS）
│   ├── index.html                # 单页应用（浏览页 + 播放页）
│   ├── app.js                    # 播放器逻辑、手势、NAS、投屏
│   └── style.css                 # 暗色主题 UI
├── android/                      # Android 原生层
│   └── app/src/main/java/com/givemesix/videox/player/
│       ├── VideoXPlayerPlugin.java   # Capacitor 插件（桥接 Web ↔ 原生）
│       └── VideoXPlayerActivity.java # ExoPlayer 全屏播放 Activity
├── package.json                  # Capacitor 项目配置
└── README.md
```

## 构建

### 环境要求

| 工具 | 版本 |
|------|------|
| JDK | 21+ |
| Android SDK | Platform 36, Build-tools 34.0.0 |
| Node.js | 18+ |
| Gradle | 8.14.3 |

### 构建步骤

```bash
# 1. 安装依赖
npm install

# 2. 同步 Web 资源到 Android
npx cap sync

# 3. 构建 APK
cd android
./gradlew assembleDebug

# APK 输出路径
# android/app/build/outputs/apk/debug/app-debug.apk
```

### 国内镜像配置

项目已预配置阿里云 + 腾讯云镜像源，无需手动修改：

- `~/.gradle/init.gradle` — 全局 Maven 仓库镜像
- `android/build.gradle` — 项目级仓库镜像
- `android/gradle/wrapper/gradle-wrapper.properties` — Gradle 本体腾讯镜像下载
- `android/app/build.gradle` — Jellyfin Maven 仓库（FFmpeg 解码器）

## 格式支持详情

| 格式 | 播放方式 | 说明 |
|------|---------|------|
| MP4, MKV, WebM, FLV, TS, M4V, 3GP, MOV, AVI | WebView | 浏览器原生支持 |
| RMVB, RM, WMV, ASF, VOB, DIVX, XVID, OGV, OGM | ExoPlayer + FFmpeg | 需要 APK 安装 |

## NAS 连接

在 NAS 上运行 VideoX 服务端，通过 HTTP 提供文件列表 API：

```
GET  /list         → { files: [{ name, size, path }] }
GET  /file?path=   → 视频文件流
```

APP 中点击顶部 NAS 按钮，输入 NAS 地址即可连接。

## 许可证

MIT

---

**作者**: [givemesix](https://github.com/SotoLish)
