# 阿里云部署指南

## 适用环境

- 阿里云 ECS：Ubuntu 22.04 / Debian 12
- 最低配置：1 vCPU、1 GB 内存（建议 2 GB）
- 安全组（防火墙）：**只开放 80 和 443 端口**

---

## 一、准备服务器

```bash
# 更新系统
sudo apt update && sudo apt upgrade -y

# 安装依赖
sudo apt install -y python3 python3-pip python3-venv nginx certbot python3-certbot-nginx

# 安装 Node.js 18+（使用 NodeSource）
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
```

---

## 二、上传项目（排除敏感文件）

以下文件/目录 **不上传**：`.env`、`node_modules/`、`.venv/`、`.git/`、`__pycache__/`、`dist/`、`.npm-cache/`。

### 方式一：rsync（推荐）

```powershell
# 在本地 Windows 执行（PowerShell）
rsync -avz --exclude='.env' --exclude='backend/.env' --exclude='node_modules/' --exclude='.venv/' --exclude='.git/' --exclude='__pycache__/' --exclude='dist/' --exclude='.npm-cache/' --exclude='data/personal_vault.db' --exclude='data/attachments/*' --exclude='backups/*' --exclude='logs/*' . user@your-server:/opt/chu-ji/
```

> 注意：首次部署需要手动在服务器 `backend/` 下创建 `.env` 文件，参考 `.env.example` 填入真实 Key。

### 方式二：scp（先打包）

```powershell
# 本地打包
tar --exclude='.env' --exclude='backend/.env' --exclude='node_modules' --exclude='.venv' --exclude='.git' --exclude='__pycache__' --exclude='dist' -czf chu-ji.tar.gz .

# 上传并解压
scp chu-ji.tar.gz user@your-server:/opt/
ssh user@your-server "cd /opt && tar -xzf chu-ji.tar.gz -C chu-ji && rm chu-ji.tar.gz"
```

---

## 三、部署后端

```bash
# 进入后端目录
cd /opt/chu-ji/backend

# 创建虚拟环境
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# ☢ 关键：创建 backend/.env（从 .env.example 复制并填入真实 Key）
cp ../.env.example .env
vim .env   # 填入真实 Key，详见下方说明

# .env 配置说明：
#   APP_ENV=production
#   APP_HOST=127.0.0.1          ← 只监听本地，绝不暴露公网
#   APP_PORT=8788
#   SESSION_SECRET=<随机字符串>  ← 务必修改
#   SESSION_COOKIE_SECURE=true   ← 开启 HTTPS 后改为 true
#   INITIAL_ADMIN_USERNAME=<你的用户名>
#   INITIAL_ADMIN_PASSWORD=<强密码>  ← 务必修改
#   AI_BASE_URL=https://api.deepseek.com
#   AI_API_KEY=sk-xxx            ← 只在后端配置
#   AI_MODEL=deepseek-chat
#   WEATHER_API_KEY=xxx          ← 和风天气 Key
#   INITIAL_DELETE_PASSWORD=<独立的强删除确认密码>
#   WEATHER_LOCATION=<经度,纬度；可留空并在应用中选择地区>
```

### systemd 守护

```bash
sudo tee /etc/systemd/system/chu-ji.service << 'EOF'
[Unit]
Description=初记 Backend
After=network.target

[Service]
Type=simple
User=www-data
WorkingDirectory=/opt/chu-ji/backend
ExecStart=/opt/chu-ji/backend/.venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 8788
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now chu-ji
sudo systemctl status chu-ji   # 确认 running
```

### 验证后端

```bash
curl http://127.0.0.1:8788/health
# 应返回 {"status":"ok","environment":"production",...}
```

---

## 四、部署前端

```bash
cd /opt/chu-ji/frontend
npm install
npm run build
# 产物在 dist/ 目录
```

---

## 五、配置 Nginx

```bash
sudo tee /etc/nginx/sites-available/chu-ji << 'EOF'
server {
    listen 80;
    server_name your-domain.com;  # 替换为你的域名

    root /opt/chu-ji/frontend/dist;
    index index.html;

    # 安全头
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-Frame-Options "DENY" always;

    # 客户端请求大小限制（上传附件）
    client_max_body_size 25m;

    # API 反向代理到后端（后端不暴露公网，仅通过 Nginx 访问）
    location /api/ {
        proxy_pass http://127.0.0.1:8788;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 90s;
        proxy_buffering off;
    }

    # /health 端点
    location /health {
        proxy_pass http://127.0.0.1:8788;
        proxy_set_header Host $host;
    }

    # PWA SPA 路由：所有非 API 请求回退到 index.html
    location / {
        try_files $uri $uri/ /index.html;
    }

    # 静态资源长缓存
    location /assets/ {
        expires 1y;
        add_header Cache-Control "public, immutable";
    }
}
EOF

# 启用站点
sudo ln -sf /etc/nginx/sites-available/chu-ji /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default

# 测试配置并重载
sudo nginx -t && sudo systemctl reload nginx
```

---

## 六、启用 HTTPS

```bash
sudo certbot --nginx -d your-domain.com

# 自动续期（已自动配置 systemd timer）
sudo systemctl status certbot.timer
```

---

## 七、目录权限

```bash
sudo chown -R www-data:www-data /opt/chu-ji/data
sudo chown -R www-data:www-data /opt/chu-ji/backups
sudo chown -R www-data:www-data /opt/chu-ji/logs
sudo chmod 750 /opt/chu-ji/data
sudo chmod 750 /opt/chu-ji/backups
```

---

## 八、阿里云安全组配置

在阿里云控制台 → ECS → 安全组，确保规则：

| 方向 | 端口 | 协议 | 来源 | 说明 |
|------|------|------|------|------|
| 入方向 | 80 | TCP | 0.0.0.0/0 | HTTP（Let's Encrypt 验证需要） |
| 入方向 | 443 | TCP | 0.0.0.0/0 | HTTPS |
| 出方向 | 全部 | 全部 | 0.0.0.0/0 | 后端调用 AI/OCR/天气 API 需要 |

**不要开放 8788 端口** — 后端只监听 127.0.0.1，公网无法直接访问。

---

## 九、验证部署

1. 浏览器打开 `https://your-domain.com`
2. 使用 `.env` 中配置的用户名密码登录
3. 确认各功能正常：日程、任务、日记、荣誉、回忆、项目、课表、天气
4. 测试附件上传/预览/删除
5. 测试备份/导出
6. 手机浏览器打开 → 添加到主屏幕，确认 PWA 可用

---

## 十、更新部署

```bash
# 本地打包上传（排除敏感文件）
tar --exclude='.env' --exclude='backend/.env' --exclude='node_modules' --exclude='.venv' --exclude='.git' --exclude='__pycache__' -czf update.tar.gz .
scp update.tar.gz user@your-server:/tmp/

# 服务端更新
ssh user@your-server << 'EOF'
cd /opt/chu-ji
tar -xzf /tmp/update.tar.gz
rm /tmp/update.tar.gz

# 后端
cd backend
source .venv/bin/activate
pip install -r requirements.txt
sudo systemctl restart chu-ji

# 前端
cd ../frontend
npm install
npm run build
sudo systemctl reload nginx
EOF
```

---

## 安全检查清单

- [ ] 后端 `.env` 中 `APP_HOST=127.0.0.1`
- [ ] 安全组（防火墙）未开放 8788 端口
- [ ] `backend/.env` 未上传到 git
- [ ] `SESSION_SECRET` 已改为随机字符串
- [ ] `INITIAL_ADMIN_PASSWORD` 已改为强密码
- [ ] HTTPS 已启用
- [ ] 手机端 PWA 可正常安装使用
