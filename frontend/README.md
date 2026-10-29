# 前端与 Android

本目录包含初记的 React/TypeScript 前端、PWA 配置和 Capacitor Android 工程。产品功能、数据边界、部署方式和 Android 安装说明见仓库根目录 [README](../README.md)。

## 常用命令

```powershell
npm ci
npm run dev           # 本地 Web/PWA 开发服务
npm run build         # 构建 Web/PWA
npm run build:apk     # 构建 Android 调试 APK
npm run build:release # 构建正式签名 APK
```

`npm run build:release` 从用户目录 `.android/chuji-release.properties` 读取签名信息。签名文件和密码不得提交到仓库。Gradle Wrapper 通过 `scripts/run-gradle.mjs` 在 Windows 与 Linux 上调用对应入口。
