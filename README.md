# 初记 · 个人管理系统

初记是一套可自托管的生活与成长管理系统，将计划、任务、日记、复盘、课表、资料和个人数据集中管理。应用默认仅监听本机地址，不提供公开注册或社交功能；如需远程访问，请自行部署并配置 HTTPS。

## 功能

- 今日视图、每日计划、任务与打卡
- 日记、回忆图片墙、荣誉墙和问题记录
- 周/月复盘、成长评分与成绩分析
- 项目库、课表、专注计时和天气卡片
- 附件上传、数据导出、备份与恢复
- 管理员账户、删除确认和审计记录
- PWA 与 Capacitor Android 工程

## 技术栈

- 前端：React、TypeScript、Vite、Tailwind CSS、PWA
- 后端：Python、FastAPI、SQLModel
- 数据：SQLite，默认保存在 `data/personal_vault.db`
- 默认本地端口：前端 `127.0.0.1:8787`，后端 `127.0.0.1:8788`

## 本地运行

环境要求：Python 3.11+、Node.js 20.19+（或 22.12+）和 npm。

复制配置模板并设置自己的密码：

```powershell
Copy-Item .env.example .env
```

首次启动前，请在 `.env` 中设置 `INITIAL_ADMIN_PASSWORD` 和独立的 `INITIAL_DELETE_PASSWORD`。`SESSION_SECRET` 留空时会在本地生成。不要提交 `.env`、数据库、附件、导出或备份文件。

启动后端：

```powershell
cd backend
python -m venv .venv
.\.venv\Scriptsctivate
pip install -r requirements.txt
uvicorn app.main:app --host 127.0.0.1 --port 8788
```

启动前端：

```powershell
cd frontend
npm ci
npm run dev
```

浏览器打开 <http://127.0.0.1:8787>。

## 构建

构建 PWA：

```powershell
cd frontend
npm ci
npm run build
```

构建 Android 调试包时，先将 API 地址设为你自己的 HTTPS 服务：

```powershell
$env:VITE_SERVER_URL = 'https://your-domain.example'
npm run build:apk
```

`build:apk` 当前生成 Android 调试包，不是应用商店发布包。正式发布还需要配置自己的 Android 发布签名。若前后端同域部署，可将 `VITE_SERVER_URL` 留空。

## 部署与隐私

- 数据库、附件、导出和备份保存在运行应用的机器上。
- 后端默认绑定 `127.0.0.1`；公网访问应通过配置了 HTTPS 的反向代理。
- 需要使用 AI、天气或 OCR 时，在自己的 `.env` 中配置服务密钥。AI 功能会将相应记录发送给你配置的服务提供方，请先确认其隐私政策。
- 上传和备份内容可能包含个人资料；请妥善保管数据目录与备份文件。

详细部署说明见 [DEPLOY.md](DEPLOY.md)。

## 许可证

本项目以 MIT License 发布，详见 [LICENSE](LICENSE)。第三方依赖仍适用各自的许可证，见 `frontend/package.json`、`frontend/package-lock.json` 和 `backend/requirements.txt`。

