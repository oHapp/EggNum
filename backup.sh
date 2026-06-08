#!/bin/bash
# ==============================================
#  鸡蛋库存登记助手 — 数据库备份脚本
#  用法: ./backup.sh
#  自动: crontab -e 添加  0 3 * * * /path/to/backup.sh
# ==============================================
set -e

# ── 配置 ──
CONTAINER_NAME="eggnum"              # Docker 容器名
DB_PATH="/data/eggnum.db"            # 容器内数据库路径
BACKUP_DIR="/home/Happ/Service/EggNum/backups"  # 备份存放目录
KEEP_DAYS=7                          # 保留最近几天的备份

mkdir -p "$BACKUP_DIR"

# ── 备份文件名 ──
BACKUP_FILE="$BACKUP_DIR/eggnum_$(date +%Y%m%d).db"

# ── 执行备份 (sqlite3 .backup 正确处理 WAL 模式) ──
echo "[$(date '+%Y-%m-%d %H:%M:%S')] 开始备份..."
docker exec "$CONTAINER_NAME" sqlite3 "$DB_PATH" ".backup /tmp/eggnum_backup.db"
docker cp "$CONTAINER_NAME:/tmp/eggnum_backup.db" "$BACKUP_FILE"
docker exec "$CONTAINER_NAME" rm /tmp/eggnum_backup.db
echo "[$(date '+%Y-%m-%d %H:%M:%S')] 备份完成: $BACKUP_FILE ($(du -h "$BACKUP_FILE" | cut -f1))"

# ── 自动轮转：删除超过 KEEP_DAYS 的旧备份 ──
DELETED=0
find "$BACKUP_DIR" -name "eggnum_*.db" -mtime +"$KEEP_DAYS" | while read f; do
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] 清理旧备份: $(basename "$f")"
  rm "$f"
  DELETED=$((DELETED + 1))
done

# ── 列出现有备份 ──
echo "[$(date '+%Y-%m-%d %H:%M:%S')] 当前备份列表:"
ls -lh "$BACKUP_DIR"/eggnum_*.db 2>/dev/null | awk '{print "  " $NF "  (" $5 ")"}'

echo "[$(date '+%Y-%m-%d %H:%M:%S')] 完成"
