#!/bin/bash
# ============================================================
#  鸡蛋库存登记助手 — 数据库自动备份 + 轮转
# ============================================================
#
#  ── 功能 ──
#  每天备份 SQLite 数据库到指定目录，自动清理超过 7 天的旧备份。
#  使用 sqlite3 .backup 命令，正确处理 WAL 模式，不丢未写入数据。
#
#  ── 手动执行 ──
#  chmod +x backup.sh      # 首次：赋予执行权限（只需一次）
#  ./backup.sh             # 手动跑一次测试
#
#  ── 定时自动执行 ──
#  Linux 系统有个内置的定时任务工具叫 crontab（定时器）。
#  你写好"几点几分执行什么命令"，系统到点就自动跑。
#
#  设置步骤：
#  1. 在服务器终端输入： crontab -e
#     （首次会提示选择编辑器，选 nano 或 vim）
#
#  2. 在打开的文件末尾粘贴下面这行：
#     0 3 * * * /home/Happ/Service/EggNum/backup.sh >> /home/Happ/Service/backups/backup.log 2>&1
#
#     这句的含义：
#       0 3 * * * ─ 每天凌晨 3:00
#       /path/backup.sh ─ 要执行的命令
#       >> backup.log ─ 把输出写到日志文件
#       2>&1 ─ 错误输出也写到同个文件
#
#     五个 * 号依次代表： 分钟(0-59) 小时(0-23) 日(1-31) 月(1-12) 星期(0-7)
#     常用例子：
#       0 3 * * *   → 每天凌晨 3 点
#       */30 * * * * → 每 30 分钟
#       0 3 * * 0   → 每周日凌晨 3 点
#
#  3. 保存退出。crontab 立即生效，无需重启。
#
#  4. 验证是否添加成功： crontab -l
#
#  ── 备份文件位置 ──
#  默认：/home/Happ/Service/backups/
#  文件名：eggnum_20260607.db
#  运行时日志：backups/backup.log
#
#  ── 恢复数据 ──
#  docker cp ./backups/eggnum_20260607.db eggnum:/data/eggnum.db
#  docker compose restart
#
#  ── 常见问题 ──
#  Q: crontab 没跑？
#  A: 检查日志 cat backups/backup.log，确认脚本路径写的是绝对路径
#  Q: 备份文件大小为 0？
#  A: 确认容器正在运行 docker ps | grep eggnum
#
# ============================================================
set -e

# ── 配置（按需修改） ──
CONTAINER_NAME="eggnum"
DB_PATH="/data/eggnum.db"
BACKUP_DIR="/home/Happ/Service/backups"
KEEP_DAYS=7

mkdir -p "$BACKUP_DIR"

BACKUP_FILE="$BACKUP_DIR/eggnum_$(date +%Y%m%d).db"

echo "[$(date '+%Y-%m-%d %H:%M:%S')] 开始备份..."

# Use Python's sqlite3 module (always available in the container)
docker exec "$CONTAINER_NAME" python3 -c "
import sqlite3
src = sqlite3.connect('$DB_PATH')
dst = sqlite3.connect('/tmp/eggnum_backup.db')
src.backup(dst)
dst.close()
src.close()
"
docker cp "$CONTAINER_NAME:/tmp/eggnum_backup.db" "$BACKUP_FILE"
docker exec "$CONTAINER_NAME" rm /tmp/eggnum_backup.db

echo "[$(date '+%Y-%m-%d %H:%M:%S')] 备份完成: $BACKUP_FILE ($(du -h "$BACKUP_FILE" | cut -f1))"

# ── 自动轮转：删除超过 KEEP_DAYS 的旧备份 ──
find "$BACKUP_DIR" -name "eggnum_*.db" -mtime +"$KEEP_DAYS" | while read f; do
  echo "[$(date '+%Y-%m-%d %H:%M:%S')] 清理旧备份: $(basename "$f")"
  rm "$f"
done

echo "[$(date '+%Y-%m-%d %H:%M:%S')] 当前备份列表:"
ls -lh "$BACKUP_DIR"/eggnum_*.db 2>/dev/null | awk '{print "  " $NF "  (" $5 ")"}'

echo "[$(date '+%Y-%m-%d %H:%M:%S')] 完成"
