# 鸡蛋库存登记助手 — 功能说明

> v1.3.15-dev | Flask + SQLite + Vanilla JS + PWA

---

## 目录

- [1. 产品预设模板](#1-产品预设模板)
- [2. 数据库表结构](#2-数据库表结构)
- [3. 页面与前端功能](#3-页面与前端功能)
  - [3.1 出库登记（首页）](#31-出库登记首页)
  - [3.2 扣留/留存](#32-扣留留存)
  - [3.3 考勤打卡](#33-考勤打卡)
  - [3.4 历史记录页](#34-历史记录页)
  - [3.5 扣留记录页](#35-扣留记录页)
  - [3.6 考勤记录页](#36-考勤记录页)
  - [3.7 开发者工具](#37-开发者工具)
- [4. API 端点](#4-api-端点)
- [5. 核心业务逻辑](#5-核心业务逻辑)
- [6. PWA 配置](#6-pwa-配置)
- [7. 移动端优化](#7-移动端优化)
- [8. 备份与恢复](#8-备份与恢复)
- [9. 部署与配置](#9-部署与配置)
- [10. 版本与分支管理](#10-版本与分支管理)

---

## 1. 产品预设模板

共 8 个品类、16 个规格行，定义在 `app.py` 的 `PRESET_TEMPLATES`：

| 品类 | 规格（枚数） |
|------|------------|
| 农家蛋 | 30, 15 |
| 五谷蛋 | 30, 15, 10 |
| 虫草蛋 | 30, 15, 10 |
| 小花蛋 | 30, 20, 15 |
| 五黑初生蛋 | 20 |
| 五黑彩鸡蛋 | 30 |
| 珍珠鸡蛋 | 20 |
| 初生蛋 | 20 |

新增产品只需在 `PRESET_TEMPLATES` 加一行，无需改数据库、HTML 或 JS。

---

## 2. 数据库表结构

SQLite（WAL 模式），5 张表，全部 `CREATE TABLE IF NOT EXISTS`，启动时自动建表。

### 2.1 records — 出库主记录

| 列 | 类型 | 说明 |
|----|------|------|
| id | INTEGER PK | 自增 |
| store_name | TEXT | 店铺名，默认"鹏泰(大福店)" |
| record_date | DATE | 记录日期 YYYY-MM-DD |
| created_at | DATETIME | 创建时间 |

索引: `idx_records_date` ON `record_date`

### 2.2 record_items — 出库明细

| 列 | 类型 | 说明 |
|----|------|------|
| id | INTEGER PK | 自增 |
| record_id | INTEGER FK | 关联 records.id |
| category | TEXT | 品类名 |
| spec | INTEGER | 规格（枚数） |
| quantity | INTEGER | 数量，默认 0 |
| sort_order | INTEGER | 排序，按模板顺序 |

索引: `idx_items_record` ON `record_id`

### 2.3 reserve_items — 留存库存

| 列 | 类型 | 说明 |
|----|------|------|
| id | INTEGER PK | 自增 |
| category | TEXT | 品类名 |
| spec | INTEGER | 规格 |
| quantity | INTEGER | 跨天累计数量 |
| updated_at | DATETIME | 更新时间 |

UNIQUE(category, spec) — 每规格一条记录，跨天不清零

### 2.4 reserve_log — 留存变更日志

| 列 | 类型 | 说明 |
|----|------|------|
| id | INTEGER PK | 自增 |
| record_date | DATE | 日期 |
| category | TEXT | 品类名（`__link__` = 联动开关事件） |
| spec | INTEGER | 规格 |
| delta | INTEGER | 本次变更量，正=存入，负=取出 |
| linked | INTEGER | 1=联动 ON，0=联动 OFF |
| created_at | DATETIME | 精确时间戳 |

索引: `idx_reserve_log_date` ON `record_date`

### 2.5 attendance — 考勤打卡

| 列 | 类型 | 说明 |
|----|------|------|
| id | INTEGER PK | 自增 |
| record_date | DATE | 日期 |
| time_start | TEXT | 开始时间 HH:MM |
| time_end | TEXT | 结束时间 HH:MM |
| hours | REAL | 时长（小时） |
| note | TEXT | 备注 |
| created_at | DATETIME | 创建时间 |

索引: `idx_attendance_date` ON `record_date`

---

## 3. 页面与前端功能

三标签页结构（出库 / 扣留 / 考勤），tab 选中状态存入 `sessionStorage`，跨页面刷新保持。

### 3.1 出库登记（首页）

**数据加载**
- 打开页面自动加载今日数据 `GET /api/today`
- 有数据 → 填充所有规格行 → 显示"已加载今日数据"
- 无数据 → 全部归零 → 显示"今日暂无记录"

**± 按钮**
- 使用 `pointerdown`（非 click），触碰即响应，消除 300ms 延迟
- 轻触检测：<200ms 且移动 <8px 才算有效，滑动不触发
- 数值钳制 0-999
- `navigator.vibrate(10)` 触觉反馈
- 0 值时显示灰色（`.is-zero` 类），空白视觉

**联动开关（出库侧）**
- 位置：顶部状态栏右侧，默认 **关**
- 开启后：出库 ± 时自动反向同步留存（+1 出库 → -1 留存）
- 联动不足时弹出确认框（"今日出库数量为 0，确定要存入留存吗？"）

**自动保存 + 重试**
- 任何数量变动触发自动保存，有 300ms 防抖
- 失败自动重试 3 次，间隔递增（1s / 3s / 6s）
- 视觉反馈：
  - 顶部栏显示"保存中..."→"重试中 (N/3)..."
  - 头部颜色渐进变红
  - 3 次失败后头部全红 + 错误提示条 + Toast
- **防竞态保护**：
  - 每规格维护 `saveGeneration` 版本计数器
  - 保存成功时检查版本号：如有更新的变动则跳过快照，触发新保存
  - 重试期间有变动的规格行置灰并禁用交互（`spec-row--saving`）
  - 最终失败后自动从服务器重载数据，确保本地状态与后端一致

**智能保存**
- 仅发送变动的规格行（`merge: true`）
- 支持多设备并发：同日期只保留一条记录，按品类+规格 upsert

**紧急保存**
- 页面关闭/切走时用 `navigator.sendBeacon` 发起最后一次保存
- 只在有改动时才发送

**生成并复制**
- 点击"生成并复制"按钮，本地生成文本后复制到剪贴板
- 优先 `navigator.clipboard.writeText`，降级 `execCommand('copy')`
- 复制成功后异步提交到后端保存

**日期切换**
- 点击日期标签弹出透明 `<input type="date">` 覆盖层
- 选择历史日期可查看/编辑往日数据
- 选择非今日时显示橙色"↺ 回到今天"按钮
- 日期覆盖值存 `localStorage`，跨页面保持
- 如果覆盖日期恰好是今天则自动清除

**品类折叠**
- 点击品类标题收起/展开该组
- 箭头从下→右旋转动画

### 3.2 扣留/留存

**数据加载**
- `GET /api/reserve` 获取全部留存数量
- 每个规格行显示当前累计值和出库联动提示

**± 按钮**
- 与出库相同的 pointerdown 轻触机制
- 300ms 单行冷却：防止快速点击导致竞态条件
- 增量 ≤ 0 时忽略（不会负数）
- 乐观更新：先改 UI，API 失败后回滚（同时恢复 totals 和跨 tab 提示）

**联动开关（留存侧）**
- 位置：顶部状态栏右侧，默认 **开**
- 关闭时弹出确认："关闭联动后，留存 ± 不再影响出库数量。确定？"
- 开关事件写入 `reserve_log`（category=`__link__`），绿色=开，红色=关

**与出库的双向联动**
- 留存 +1 → 出库 -1（实时更新出库 tab 显示）
- 留存 -1 → 出库 +1
- 跨 tab 提示：出库 tab 显示"扣留: N"，留存 tab 显示"出库: N"

### 3.3 考勤打卡

**时间段管理**
- 初始一个时段，自动填入当前时间（按 30 分钟向上取整）+ 2 小时
- "添加时段"按钮：新增 09:00-11:00 时段
- 删除按钮：至少保留一个时段时隐藏删除按钮
- 时段自动编号（时段 1、时段 2...）

**智能默认**
- 修改开始时间 → 结束时间自动 = 开始 + 2 小时
- 跨天自动修正（如 23:00 + 2h = 01:00）

**30 分步进（默认关）**
- 开启后所有时间输入强制对齐到最近的 30 分钟
- 对齐规则：余数 ≤15 向下取整，>15 向上取整，然后规范到 0-1439 分钟范围

**一键请假**
- 点击 🏖 按钮：备注自动填"请假"，时间段重置为 00:00-00:00（0h）

**保存**
- 按每个时段生成一条考勤记录
- 保存前统一执行步进规则
- 成功后清空备注、重置为单时段

**最近记录**
- 显示最近 3 天 + 当前选择日期的打卡记录
- 按日期分组，显示每日总时长
- 每条记录可单独删除

**Excel 导出**
- 选择起止日期，导出 `.xlsx` 文件
- 如有模板文件则保留格式，按日期分组，合并多时段时间

### 3.4 历史记录页

路径: `/history`

- 所有出库记录按日期分组，最新在上
- 每条显示前 3 行文本预览（超出截断 +"..."）
- **查看详情**：展开卡片，加载完整文本
- **一键复制**：复制该记录文本到剪贴板
- **单条删除**：确认弹窗 → 删除 → 卡片淡出动画
- **批量模式**：
  - 长按任意卡片 600ms 进入批量模式
  - 显示选择框 + 底部工具栏（已选计数、批量删除、取消）
  - 长按再按一次选中/取消，点击其他地方退出批量模式
- 全部删除后显示"暂无历史记录"空状态

### 3.5 扣留记录页

路径: `/reserve-history`

- 按日期分组，每日显示净变动汇总
- **时间轴视图**：
  - 每次 ± 操作显示精确时间戳（HH:MM:SS）
  - **5 秒合并**：相邻 5 秒内的同联动状态操作合并显示（×N）
  - **联动分隔线**：`⚙ 联动开启`（绿色）/ `⚙ 联动关闭`（红色）
- 每日标题显示联动状态变化："联动: 开→关→开"
- 每个规格行展开/折叠详细变更
- **批量删除**：选中日期 → 删除当天全部记录

### 3.6 考勤记录页

路径: `/attendance-history`

- 全部考勤记录按日期分组
- 每日显示总时长
- 独立页面，不从 tab 切换进入

### 3.7 开发者工具

**激活**: 连续 3 次点击页面底部版本号（500ms 窗口内）

**功能**:
- 模拟离线：勾选后劫持 `fetch` 和 `sendBeacon`，所有网络请求失败
- 提示文字："日期切换请点击上方日期标签"

---

## 4. API 端点

### 页面路由

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/` | 首页（出库登记） |
| GET | `/history` | 历史记录页 |
| GET | `/attendance-history` | 考勤全部记录页 |

### 出库 API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/today` | 获取今日记录。`?date=YYYY-MM-DD` 可查指定日期 |
| POST | `/api/submit` | 提交/更新记录。`{store_name, record_date, items, record_id?, merge?:bool}` |
| GET | `/api/history` | 全部历史记录 JSON |
| GET | `/api/history/<id>` | 单条记录详情 |
| PUT | `/api/history/<id>` | 编辑单条记录 |
| DELETE | `/api/history/<id>` | 删除单条记录 |
| GET | `/api/history/<id>/text` | 重新生成记录文本（一键复制用） |
| GET | `/api/debug` | 调试端点，显示全部记录 |

### 留存 API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/reserve` | 全部留存数量 |
| POST | `/api/reserve` | 更新单规格留存。`{category, spec, delta, date?}` |
| GET | `/api/reserve-history` | 留存变更日志（按日期分组） |
| DELETE | `/api/reserve-history` | 删除留存日志。`?dates=日期1,日期2` 或全部 |
| POST | `/api/reserve/log-event` | 记录系统事件（联动开关）。`{record_date, category, spec, delta}` |

### 考勤 API

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/attendance` | 考勤列表。`?days=3` 或 `?from=&to=` |
| POST | `/api/attendance` | 新建打卡。`{record_date, time_start, time_end, hours, note}` |
| PUT | `/api/attendance/<id>` | 编辑打卡记录 |
| DELETE | `/api/attendance/<id>` | 删除打卡记录 |
| GET | `/api/attendance-history` | 全部考勤记录（按日期分组 + 每日总计） |
| GET | `/api/attendance/export` | 导出 Excel。`?from=YYYY-MM-DD&to=YYYY-MM-DD` |

---

## 5. 核心业务逻辑

### 5.1 零值即空白

- 数量为 0 = "未填写"，输出文本中显示为空白而非 "0"
- 前端：0 值输入框灰色显示
- 后端 `generate_output_text()`：`quantity > 0` 才输出数字

### 5.2 按日期 Upsert（多设备同步）

- 同一天只保留一条 record
- 提交时检测已有记录 → 更新 → 删除重复（保留最新）
- `merge: true`：只更新发送的规格行，不动其他行
- `merge: false`（默认）：全量替换

### 5.3 出库-留存双向联动

- 出库 +N → 留存 -N（实时更新对方 tab 显示）
- 留存 +N → 出库 -N
- 双向安全提示（出库归零时确认、留存关闭联动时确认）
- 联动开关事件全量记录到日志，可在扣留记录页追溯

### 5.4 sendBeacon 兼容

`sendBeacon` 发送 `text/plain` 而非 `application/json`，后端 `_parse_json_body()` 做降级解析。

### 5.5 时区处理

- 前端 `localDateStr()` 使用本地时间组件（非 UTC），避免东八区日期偏移
- 后端存储 `DATE` 类型，查询用字符串 YYYY-MM-DD

---

## 6. PWA 配置

### manifest.json

| 属性 | 值 |
|------|-----|
| name | 鸡蛋库存登记助手 |
| short_name | 鸡蛋登记 |
| display | standalone（全屏应用） |
| orientation | portrait |
| background_color | #FAFAFA |
| theme_color | #4CAF50 |
| icon | SVG 192×192 |

### Service Worker (`sw.js`)

缓存名: `eggnum-<app_version>`（版本号从注册 URL 参数自动注入，发布时自动更新缓存，无需手动维护）

| 资源类型 | 策略 |
|----------|------|
| HTML 页面 | Network-first（网络优先，离线时用缓存） |
| 静态资源 (CSS/JS) | Cache-first（缓存优先，后台更新） |
| API 请求 (`/api/*`) | 永不缓存（始终走网络） |

install 时预缓存 CSS、JS、manifest、icon；activate 时清理旧缓存、立即接管页面。

### iOS 适配

- `apple-mobile-web-app-capable: yes` — 添加到主屏幕后全屏
- `apple-mobile-web-app-title: 鸡蛋登记`
- `view-fit: cover` — 适配 iPhone X+ 刘海/安全区
- `env(safe-area-inset-*)` CSS 变量留出安全边距

---

## 7. 移动端优化

| 优化项 | 实现 |
|--------|------|
| 消除 300ms 延迟 | `touch-action: manipulation` + pointerdown 事件 |
| 最小触摸目标 | 48×48px（超 Apple HIG 44pt） |
| 防止双击缩放 | `maximum-scale=1.0, user-scalable=no` |
| 防止按钮文字选中 | `user-select: none` |
| 弹性滚动 | `overscroll-behavior: none` |
| 高亮消除 | `-webkit-tap-highlight-color: transparent` |
| 触觉反馈 | `navigator.vibrate()` 每次 ± 操作 |

---

## 8. 备份与恢复

### 自动备份（backup.sh）

- 放在服务器项目目录，通过 crontab 每天凌晨 3:00 执行
- 使用 Python `sqlite3.backup()` 从运行中的容器内复制数据库（正确处理 WAL 模式）
- 备份文件命名：`eggnum_YYYYMMDD.db`
- 保存路径：`/home/Happ/Service/backups/`
- 自动轮转：超过 7 天的备份自动删除
- 日志写入 `backups/backup.log`
- **异地备份**（可选）：脚本内置 rclone / SCP / Telegram Bot 三种远程同步方案，取消注释即可启用

### 恢复步骤

```bash
# 1. 复制备份文件到容器
docker cp eggnum_YYYYMMDD.db eggnum:/data/eggnum.db

# 2. 重启
docker compose restart
```

### 完整重建

可以完全从零恢复：
- **代码**：`git clone https://github.com/oHapp/EggNum.git`
- **数据**：备份 `.db` 文件
- **配置**：`.env` 文件（含 SECRET_KEY + EGGS_PORT）
- **脚本**：`backup.sh` + `update-eggnum.sh`

---

## 9. 部署与配置

### Docker 部署

```bash
# 首次启动
docker compose up -d --build

# 更新
./update-eggnum.sh
# 等价于：git pull → docker compose build --no-cache → docker compose up -d
```

### 技术栈

| 组件 | 版本 |
|------|------|
| Python | 3.13-slim |
| Flask | 3.1.2 |
| Gunicorn | 23.0.0（2 workers，60s timeout） |
| SQLite | 内置（WAL 模式） |
| openpyxl | 3.1.5（Excel 导出） |

### 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `SECRET_KEY` | `dev-eggnum-2026` | Flask 密钥，生产环境必须覆盖 |
| `EGGS_DB_DIR` | `instance/` | 数据库文件目录 |
| `EGGS_PORT` | `5080` | 宿主机端口映射 |
| `TZ` | `Asia/Shanghai` | 时区（在 docker-compose 中设置） |

### Docker Compose 架构

- 容器名：`eggnum`
- 端口映射：`${EGGS_PORT:-5080}:5000`
- 数据卷：`eggnum_data`（具名卷，挂载到 `/data`）
- 重启策略：`unless-stopped`
- 数据库路径：容器内 `/data/eggnum.db`

---

## 10. 版本与分支管理

### 分支策略

| 分支 | 用途 |
|------|------|
| `main` | 正式版，禁止直接修改 |
| `dev-v*` | 开发分支（当前 `dev-v1.3.0`） |

### 版本号规则

```
main:  v1.3.13      (正式版)
dev:   v1.3.15-dev  (开发中)
tag:   v1.3.13
```

每发布一次，第三位 +1。

### 发布流程

1. dev 分支开发、测试、提交（版本号带 `-dev`）
2. 去 `-dev` 后缀，同步 Docker 版本号
3. 合并到 main
4. 打 tag `v1.3.x`
5. 推送 main + tag
6. 切回 dev，版本号 +1 并加 `-dev`

---

> 完整代码：https://github.com/oHapp/EggNum
