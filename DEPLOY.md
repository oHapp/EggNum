# 鸡蛋库存登记助手 — 部署说明

> 版本: 1.0.0 | 技术栈: Python Flask + SQLite + Docker

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
git commit -m "v1.0.0 — 鸡蛋库存登记助手"

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

# 修改 SECRET_KEY（用之前生成的密钥）
# 编辑 docker-compose.yml，替换 change-me-to-a-random-string

# 启动
docker compose up -d
```

服务运行在 `http://你的服务器IP:5080`。

---

## 日常更新部署

本地改了代码并推送后，在服务器执行：

```bash
cd ~/eggnum
git pull
docker compose down
docker compose build --no-cache
docker compose up -d
```

一键脚本（保存为 `~/update-eggnum.sh`）：

```bash
#!/bin/bash
cd ~/eggnum
git pull
docker compose down
docker compose build --no-cache
docker compose up -d
echo "✅ 更新完成"
```

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

### 备份数据库

```bash
# 从 volume 中复制数据库文件出来
docker cp eggnum:/data/eggnum.db ./eggnum_backup_$(date +%Y%m%d).db
```

### 恢复数据库

```bash
docker cp ./eggnum_backup_20260605.db eggnum:/data/eggnum.db
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
