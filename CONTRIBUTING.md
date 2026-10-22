# 参与贡献

感谢你关注初记。项目优先维护计划、执行、记录、复盘与成果沉淀这条主线，欢迎提交问题报告、文档修正和小步实现。

## 开发环境

- Python 3.11 或更新版本
- Node.js 20.19+ 或 22.12+
- Android 构建需要 JDK 21 与 Android SDK

首次运行请按 README 配置本地 `.env`。不要把 `.env`、数据库、附件、导出文件、备份或真实 API Key 提交到 Git。

## 本地检查

```powershell
cd backend
python -m pip install -r requirements-dev.lock
python -m compileall -q app
python -m pytest -q

cd ../frontend
npm ci
npm run check-version
npm run lint
npm test
npm run build
```

修改 Android 相关代码时，另外运行 `npx cap sync android`，并在 `frontend/android` 下执行 `gradlew assembleDebug`。

## 数据库迁移

- 新数据库从 `backend/alembic/versions/` 中的当前基线开始创建。
- 旧版 SQLite 首次升级时，应用会先写入 `backups/pre-alembic-baseline-*.sqlite` 一致性副本，再运行现有的加法式兼容迁移并标记基线。
- 后续结构变更通过 Alembic revision 提交。自动生成的迁移必须人工检查；SQLite 表约束变更需要设计可回滚的数据迁移。
- 新增外键前先运行 `python -m app.integrity_audit`；如发现孤儿记录，应先给出保留或修复方案，不要自动删除数据。
- 不要删除 `ensure_*_schema()` 旧版兼容函数，直到确认所有支持的旧数据库都能由 Alembic 安全升级。

## Pull Request

1. 一个 PR 聚焦一个阶段或一类问题，避免把不相关改动混在一起。
2. 新行为应附带测试；权限、导入、恢复和数据迁移需要覆盖失败路径。
3. 描述数据兼容性、对 Web/PWA 和 Android 本机版的影响，以及已运行的检查。
4. 不提交真实用户数据、密钥、密码、Token、数据库、附件或构建产物。
5. 提交信息使用简洁动词描述，例如 `fix: restrict system backup access`。

添加或升级 Python 依赖时，先更新 `requirements.txt` 或 `requirements-dev.txt`，再重建 `requirements.lock` 和 `requirements-dev.lock`，并运行完整测试。
