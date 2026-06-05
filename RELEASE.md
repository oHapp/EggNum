# v1.2.0 — 第一个稳定版 🥚

> 2026-06-05

---

## ✨ 功能

- **鸡蛋库存录入** — 预设 6 类鸡蛋 × 13 种规格，大尺寸 ± 按钮 + 手动输入
- **一键生成文本** — 按 "店名 + 日期 + 品类:数量" 格式生成，数量为 0 时冒号后留空，自动复制到剪贴板
- **自动保存** — 每次改动即时持久化，页面关闭/切后台兜底保存，刷新不丢数据
- **多端协同** — 电脑/手机/平板共享同一数据库，按日期自动合并，同一天只有一条记录
- **历史记录** — 按日期倒序排列，支持查看详情、复制文本、删除（二次确认）、批量删除（长按进入）
- **PWA 支持** — 可添加到手机主屏幕，全屏沉浸体验，离线缓存

## 🛠 技术栈

| 层 | 技术 |
|---|------|
| 后端 | Python Flask + SQLite (WAL 模式) |
| 前端 | Vanilla JavaScript，移动端优先 |
| 部署 | Docker + Docker Compose，gunicorn 生产服务器 |
| PWA | Service Worker (network-first HTML, cache-first 静态资源) |

## 🐛 本版本修复

- **多端协同 Bug** — 修复保存时变量名错误导致 500，数据写入但前端不知
- **Service Worker 缓存旧 HTML** — 改为 network-first 策略，确保刷新拿到最新版
- **Android 杀进程丢数据** — 每次改动立即保存 + pagehide 兜底
- **滑动误触按钮** — 短按 <200ms 才算点击，长按/滑动忽略
- **日期时区问题** — 客户端传本地日期，`Cache-Control: no-store` 防缓存

## 📦 部署

```bash
git clone https://github.com/oHapp/EggNum.git
cd EggNum
cp .env.example .env    # 编辑 SECRET_KEY
docker compose up -d --build
```

详见 [DEPLOY.md](DEPLOY.md)

---

## ⚠️ 已知限制

- 多人同时编辑同一规格时，后保存者覆盖先保存者（last-write-wins）
- 计划在 v1.3.0 改进为增量更新 + 库存留存功能
