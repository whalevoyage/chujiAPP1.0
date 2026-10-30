<div align="center">
  <img src="frontend/public/icon-512.png" alt="初记应用图标" width="112">
  <h1>初记 · Student Growth OS</h1>
  <p><strong>从今天的计划，到大学几年的成长档案。</strong></p>
  <p>
    <a href="https://github.com/whalevoyage/chujiAPP1.0/releases/latest">Android 稳定版下载</a>
    · <a href="DEPLOY.md">自托管部署</a>
    · <a href="CONTRIBUTING.md">参与贡献</a>
  </p>
  <p>
    <a href="https://github.com/whalevoyage/chujiAPP1.0/actions/workflows/ci.yml"><img alt="CI" src="https://github.com/whalevoyage/chujiAPP1.0/actions/workflows/ci.yml/badge.svg"></a>
    <img alt="License: MIT" src="https://img.shields.io/badge/License-MIT-green.svg">
    <a href="https://github.com/whalevoyage/chujiAPP1.0/releases/latest"><img alt="Latest release" src="https://img.shields.io/github/v/release/whalevoyage/chujiAPP1.0"></a>
  </p>
</div>

初记把目标、计划、任务、记录、复盘和成果连接成个人成长轨迹。项目提供可离线使用的 Android 本机版，也支持 Web/PWA 自托管。

## 快速导航

[安装 Android 版](#android-本机版) · [功能概览](#功能概览) · [本地运行 WebPWA](#本地运行-webpwa) · [构建 Android](#构建-android) · [参与贡献](#参与贡献)

## 功能概览

| 场景 | 可以做什么 |
| --- | --- |
| 计划与执行 | 制定计划、安排任务、打卡并记录专注时间 |
| 记录与复盘 | 写日记、保存回忆图片、记录问题并进行周期复盘 |
| 学业与成果 | 管理课表、成绩、项目、荣誉和附件 |
| 数据备份 | 导入或导出 JSON / ZIP；ZIP 可包含附件 |

## Android 本机版

1. 在 Android 手机上打开 [最新版本下载页面](https://github.com/whalevoyage/chujiAPP1.0/releases/latest)，下载 `app-release.apk`。
2. 打开下载的 APK，按系统提示允许从当前来源安装，然后完成安装。
3. 首次打开后创建本机档案，即可开始使用。

常规记录和附件可离线使用，不需要电脑、远程服务器或账号注册。发布页面还提供 SHA-256 校验文件。

AI 复盘和课表照片 OCR 是可选联网功能。启用时，相关内容由手机直接发送到你配置的模型服务商，不经过初记服务器。未启用模型服务不影响其它本机功能。

卸载应用会清除本机数据。更换手机或卸载前，请在“我的 → 数据备份”导出 JSON/ZIP。早期预览版与稳定版签名不同；从预览版迁移时，先备份、卸载预览版，再安装稳定版并导入备份。

Tailwind CSS v4 要求 Chrome/Chromium 111+、Firefox 128+ 或 Safari 16.4+。Android 本机版使用系统 WebView；较旧设备请先更新 Android System WebView。

## 本地运行 Web/PWA

环境要求：Python 3.11+、Node.js 20.19+ 或 22.12+、npm。

```powershell
Copy-Item .env.example .env
```

在 `.env` 中设置 `INITIAL_ADMIN_PASSWORD` 和独立的 `INITIAL_DELETE_PASSWORD`，再启动后端：

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.lock
uvicorn app.main:app --host 127.0.0.1 --port 8788
```

另开终端启动前端：

```powershell
cd frontend
npm ci
npm run dev
```

浏览器打开 <http://127.0.0.1:8787>。本地数据库、附件和备份保存在运行应用的机器上；公网访问需要自行配置 HTTPS 反向代理。

## 构建 Android

```powershell
cd frontend
npm ci
npm run build:apk
```

调试 APK 输出到 `frontend/android/app/build/outputs/apk/debug/app-debug.apk`。构建 Android 需要 JDK 21 和 Android SDK。

正式签名构建使用长期保管的密钥。首次创建密钥：

```powershell
New-Item -ItemType Directory -Force "$env:USERPROFILE\.android" | Out-Null
keytool -genkeypair -v -keystore "$env:USERPROFILE\.android\chuji-release.p12" -storetype PKCS12 -alias chuji-release -keyalg RSA -keysize 3072 -validity 10000
```

随后在 `$env:USERPROFILE\.android\chuji-release.properties` 保存签名配置：

```properties
CHUJI_RELEASE_STORE_FILE=C:/Users/<用户名>/.android/chuji-release.p12
CHUJI_RELEASE_STORE_PASSWORD=<创建密钥时设置的密码>
CHUJI_RELEASE_KEY_ALIAS=chuji-release
CHUJI_RELEASE_KEY_PASSWORD=<密钥密码>
```

配置完成后运行 `npm run build:release`。密钥文件和 properties 文件必须保存在仓库外并另做安全备份。正式 APK 输出到 `frontend/android/app/build/outputs/apk/release/app-release.apk`。GitHub Release 工作流使用 Actions Secrets `ANDROID_RELEASE_KEYSTORE_B64`、`CHUJI_RELEASE_STORE_PASSWORD`、`CHUJI_RELEASE_KEY_ALIAS` 和 `CHUJI_RELEASE_KEY_PASSWORD` 签名，并发布 APK 与 SHA-256 校验文件。后续升级请递增根目录 `VERSION`，Android `versionCode` 会按该版本自动生成。

## 自托管部署

后端默认绑定 `127.0.0.1`，不提供公开注册或社交功能。部署、HTTPS 和备份说明见 [DEPLOY.md](DEPLOY.md)。本地数据与模型服务的隐私边界见 [SECURITY.md](SECURITY.md)。

## 项目结构

```text
frontend/   React / TypeScript 界面、PWA 与 Capacitor Android 工程
backend/    FastAPI 服务、数据库模型与迁移
contracts/  本地版与服务端共用的核心业务场景
```

## 参与贡献

欢迎通过 [Issue](https://github.com/whalevoyage/chujiAPP1.0/issues) 报告问题或提出建议，并通过 Pull Request 参与改进。开发环境、检查命令和贡献规范见 [CONTRIBUTING.md](CONTRIBUTING.md)；安全问题的私密报告方式见 [SECURITY.md](SECURITY.md)。版本变化见 [CHANGELOG.md](CHANGELOG.md)。

技术栈包括 React、TypeScript、Vite、Tailwind CSS、Capacitor、FastAPI、SQLModel 和 SQLite。

## 许可证

本项目采用 [MIT License](LICENSE)。

