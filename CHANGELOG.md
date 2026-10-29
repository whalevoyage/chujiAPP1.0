# Changelog

本项目的可见变更按 [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) 记录，并遵循语义化版本。

## [Unreleased]

### Security

- 系统级服务器备份与全局设置要求管理员权限。
- 服务器恢复增加独立删除密码二次验证和审计记录。
- 修复非管理员活动触发全局自动备份的路径。
- Android 本机附件改为应用私有文件存储；旧 Base64 附件按需迁移。
- 本机 ZIP 导入增加路径、目录、文件数、展开大小、压缩比与 SHA-256 校验。

### Engineering

- 新增 Android 正式签名 APK 构建命令和按版本标签自动发布工作流。
- Android versionCode 从共享 VERSION 文件生成。
- 修复 Android APK 构建脚本在 Windows 与 Linux 上调用 Gradle Wrapper 的差异。
- 重写项目 README，加入应用图标、成长闭环与运行模式示意图。
- 移除前端目录中的 Vite 模板说明，并修正本地 PowerShell 启动命令。
- 扩展环境文件与 Android 发布产物的忽略规则。
- CI 继续报告依赖审计结果，并仅因中危及以上问题失败；记录当前无上游修复版本的低危构建依赖告警。

- 增加后端权限与 IDOR 回归测试、前端 ZIP 安全测试和 GitHub Actions CI。
- 增加版本一致性检查、生产健康检查最小化与安全响应头。
- 为页面路由启用按需加载。
- 将本机计划、任务、日记、复盘和成绩路由拆入 feature route 模块。
- 为计划进度、任务打卡、弱点改进、成绩卡和荣誉附件导入导出增加共享 Local/Remote 契约场景。
- 拆出 Today、Review、Profile 页面展示组件，并补充组件交互测试。
- 升级 Tailwind CSS 4.3.3 与 Sharp 0.35.5，清除 npm 审计告警；CI 增加完整依赖审计。
- Tailwind CSS v4 的浏览器最低版本要求已补充到 README。


