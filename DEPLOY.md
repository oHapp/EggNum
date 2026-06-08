# 鸡蛋库存登记助手 — 部署说明

> 版本: 1.2.0 | 技术栈: Python Flask + SQLite + Docker

---

## 前置条件

- 服务器已安装 Docker、Docker Compose、Git
- 开放端口 `5080`（可在 `docker-compose.yml` 中修改）

---

## 首次部署 (本地 → 服务器)

### 1. 本地：初始化 Git 并推送到仓库

```bash
# 在项目目录执行（需要先安装 Git: https://git-scm.com）
cd EggNum
git init
git add -A
git commit -m "v1.2.0 — 鸡蛋库存登记助手"

# 推送到你的 Git 仓库（GitHub / Gitee / 自建 Git）
git remote add origin <你的仓库地址>
git branch -M main
git push -u origin main
```

### 2. 服务器：克隆并启动

```bash
# SSH 到服务器
ssh user@your-server

# 克隆项目
git clone <你的仓库地址> eggnum
cd eggnum

# 创建 .env 配置文件（docker-compose 自动读取）
cp .env.example .env
# 编辑 .env，把 SECRET_KEY 改为随机字符串
nano .env

# 启动（首次构建）
docker compose up -d --build
```

### 2.1 服务器已有旧版（迁移到 .env）

```bash
cd ~/eggnum

# 如果之前改过 docker-compose.yml 里的 SECRET_KEY，先记下来
grep SECRET_KEY docker-compose.yml

# 创建 .env 文件
echo "SECRET_KEY=你的密钥" > .env
echo "EGGS_PORT=5080" >> .env

# 丢弃对 docker-compose.yml 的本地修改，拉取新版
git stash
git pull --ff-only
git stash drop   # 旧改动已不需要

# 重建
docker compose up -d --build
```

---

## 日常更新部署

> ⚠️ 服务器上**绝不能直接改 `docker-compose.yml`**，密钥等配置放在 `.env` 文件里。
> 这样 `git pull` 才不会冲突。

服务器执行一键更新：

```bash
cd ~/eggnum
git stash && git pull --ff-only && git stash pop
docker compose up -d --build
```

`git stash` 暂存你本地的 `.env` 等改动，`git pull` 拉取最新代码，`git stash pop` 恢复你的本地配置。

推荐保存为脚本 `~/update-eggnum.sh`：

```bash
#!/bin/bash
set -e
cd ~/eggnum
echo "📥 拉取最新代码..."
git stash push -m "auto-stash-before-update-$(date +%Y%m%d-%H%M)" 2>/dev/null || true
git pull --ff-only
git stash pop 2>/dev/null || true
echo "🔨 重新构建..."
docker compose down
docker compose build --no-cache
docker compose up -d
echo "✅ 更新完成"
```

如果 `stash pop` 有冲突，手动解决后 `git stash drop` 即可。

---

## 版本回退

```bash
cd ~/eggnum

# 查看历史版本
git log --oneline

# 回退到指定版本（例如回退一个版本）
git checkout HEAD~1
docker compose down
docker compose build --no-cache
docker compose up -d

# 回到最新版本
git checkout main
docker compose down
docker compose build --no-cache
docker compose up -d
```

---

## 常用命令

| 操作 | 命令 |
|------|------|
| 启动 | `docker compose up -d` |
| 停止 | `docker compose down` |
| 查看日志 | `docker compose logs -f` |
| 重启 | `docker compose restart` |
| 更新镜像 | `docker compose down && docker compose build --no-cache && docker compose up -d` |
| 查看数据文件位置 | `docker volume inspect eggnum_data` |

---

## 数据持久化

数据库文件存储在 Docker Volume `eggnum_data` 中：

```
容器内路径: /data/eggnum.db
宿主机路径: Docker 管理 (通常 /var/lib/docker/volumes/eggnum_data/)
```

即使删除容器或重新构建镜像，**数据不会丢失**。

### 自动备份（每天 + 自动轮转 7 天）

```bash
# 1. 赋予执行权限
chmod +x backup.sh

# 2. 编辑备份目录（默认 ./backups）
# 编辑 backup.sh，修改 BACKUP_DIR 为你的路径

# 3. 手动测试
./backup.sh

# 4. 添加到 crontab，每天凌晨 3 点自动备份
crontab -e
# 添加一行:
0 3 * * * /home/Happ/Service/EggNum/backup.sh >> /home/Happ/Service/EggNum/backups/backup.log 2>&1
```

备份使用 `sqlite3 .backup` 命令，正确处理 WAL 模式，不会丢未写入数据。文件名格式 `eggnum_20260607.db`，自动保留最近 7 天。

### 恢复数据库

```bash
# 复制备份到容器
docker cp ./backups/eggnum_20260607.db eggnum:/data/eggnum.db
docker compose restart
```

---

## 自定义端口

编辑 `docker-compose.yml` 的 `ports` 映射：

```yaml
ports:
  - "你的端口:5000"   # 左侧为宿主机端口，右侧为容器内部端口(固定5000)
```

---

## 使用 Nginx 反向代理 (可选)

```nginx
server {
    listen 80;
    server_name eggnum.example.com;

    location / {
        proxy_pass http://127.0.0.1:5080;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```
