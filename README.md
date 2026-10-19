# 家乡记事 · 个人朋友圈

仿微信朋友圈的个人说说应用：发文字 + 最多 9 张图（自动压到体积边界）、浏览大图、按年份快速定位。
纯静态三件套前端（HTML/CSS/JS，无框架、无构建）+ 一个零依赖 Node 小后端，数据存单文件 SQLite。

## 功能

- **浏览端 `index.html`**：卡片流（按年份分组吸顶）、右侧拖动年份刻度条快速定位、点图看大图（左右滑翻页 / Esc 关闭）
- **管理端 `editor.html`**：口令门（口令 `hizqh`，仅保护发布/删除）、发说说、📷 拍照 / 🖼 相册选图（调用手机相机与相册）、删除已发布内容
- **图片压缩**：选图后前端立即逼近式压缩——最长边 1600px 起步、质量 0.55~0.9 二分上调，压到 **单张 ≤120KB** 即停；到质量下限仍超则尺寸 ×0.8 再循环，保证"不糊 + 最小"；输出 WebP（不支持时回退 JPEG）
- **多端共享**：手机、电脑访问同一服务，读写同一个 SQLite 库

## 架构

```
手机/电脑浏览器
   │  静态页 + JS（压缩、渲染都在浏览器完成）
   ▼
server.js  ── node:http（零 npm 依赖，监听 0.0.0.0:3000）
   ├─ GET    /api/posts            说说列表（含图片元数据）
   ├─ GET    /api/verify           校验口令（头 x-pass）
   ├─ POST   /api/posts            发布 {text, images:[{data:base64,w,h}]}  🔒
   ├─ DELETE /api/posts/:id        删除说说 + 联动删图片文件            🔒
   ├─ GET    /uploads/:file        图片文件（immutable 长缓存）
   └─ GET    /、*.html、*.css、*.js 静态文件
   ▼
data/
   ├─ moments.db      SQLite（node:sqlite 内置模块，WAL 模式）
   └─ uploads/        压缩后的图片（webp/jpg/png），删除说说时一并删除
```

**数据表**

```sql
posts  (id INTEGER PK, text TEXT, created_at INTEGER)          -- 一条说说
images (id INTEGER PK, post_id FK→posts ON DELETE CASCADE,
        seq INTEGER, file TEXT, w INTEGER, h INTEGER)          -- 说说的图，按 seq 排序
```

**发布流程**：选图 → 浏览器 canvas 压缩（≤120KB）→ base64 随 JSON POST → 服务端验口令、嗅探图片格式、落盘 `data/uploads/`、事务写库 → 浏览端下次加载即可见。

## 本地启动

前置要求：**Node.js ≥ 24**（用了内置 `node:sqlite`，23.4+ 也可，22.x 需加实验 flag）。无需 `npm install`。

```bash
node server.js          # 或 npm start
```

启动后控制台输出：

```
朋友圈已启动:
  本机   http://localhost:3000
  手机   http://10.204.70.40:3000   (同一 Wi-Fi)
```

- 电脑访问 `http://localhost:3000`（浏览端），管理端 `http://localhost:3000/editor.html`
- 手机与电脑连**同一 Wi-Fi**，用控制台打印的局域网 IP 访问
- 端口被占用时：`PORT=8080 node server.js`
- `data/` 目录首次启动自动创建；备份 = 拷走 `data/` 整个目录

## 服务器部署

**要点：端口由 `PORT` 环境变量控制（默认 3000），服务监听 `0.0.0.0`，无构建步骤、无依赖安装。**

### 1. 上传文件（共 8 个）

```
server.js  package.json  common.js  browse.js  editor.js
index.html  editor.html   style.css
```

```bash
scp server.js package.json common.js browse.js editor.js \
    index.html editor.html style.css user@your-server:/opt/hometown/
```

### 2. 启动

```bash
cd /opt/hometown
PORT=3000 node server.js          # 前台测试
```

后台常驻（任选其一）：

```bash
# a) nohup 最简
nohup node server.js > moments.log 2>&1 &

# b) systemd（推荐，重启自动拉起）
cat > /etc/systemd/system/hometown.service <<'EOF'
[Unit]
Description=Hometown Moments
After=network.target
[Service]
WorkingDirectory=/opt/hometown
ExecStart=/usr/bin/node server.js
Environment=PORT=3000
Restart=always
User=www-data
[Install]
WantedBy=multi-user.target
EOF
systemctl enable --now hometown
```

### 3. 端口与防火墙

```bash
# 云服务器安全组 / 防火墙放行所用端口，例如 3000
sudo ufw allow 3000/tcp
```

验证：

```bash
curl http://localhost:3000/api/posts          # 应返回 {"posts":[...]}
curl -X DELETE http://localhost:3000/api/posts/1 -H 'x-pass: hizqh'
```

### 4. 注意

- **口令只挡写操作（发布/删除），浏览端是开放的**——部署到公网意味着任何人都能看到内容。只在内网/私人网络使用，或在前面套一层 HTTPS + Basic Auth（nginx/Caddy）再公开
- 公网访问建议配 HTTPS：手机相机/相册功能在部分浏览器的非安全上下文下会受限
- 反向代理示例（nginx）：`location / { proxy_pass http://127.0.0.1:3000; }`
- 换端口只需改 `Environment=PORT=xxxx` 或启动命令前缀

## 给 AI 的部署说明（可直接粘贴）

> 项目是一个零依赖的 Node 朋友圈应用，位于本仓库根目录，共 8 个文件（server.js、package.json、common.js、browse.js、editor.js、index.html、editor.html、style.css）。
>
> 1. 确认 Node ≥ 23.4（`node -v`），**不需要 npm install，没有依赖**
> 2. 将 8 个文件原样放到服务器目录（如 `/opt/hometown`），保持同级
> 3. 用 `PORT=<目标端口> node server.js` 启动，必须保证能监听 `0.0.0.0`（代码已写死监听所有网卡）；`data/` 目录会自动创建
> 4. 若目标端口不是 3000，只能通过 `PORT` 环境变量传入，改代码无效以外的方式都行
> 5. 用 `curl http://localhost:<端口>/api/posts` 验证返回 `{"posts":[...]}`
> 6. 数据在 `data/moments.db` + `data/uploads/`，迁移/备份直接拷贝该目录
> 7. 写操作口令为 `hizqh`（请求头 `x-pass`），浏览接口无需口令
> 8. 若需开机自启，提供 systemd unit（WorkingDirectory 指向项目目录，ExecStart 带 PORT）
