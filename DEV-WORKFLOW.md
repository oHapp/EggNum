# 开发流程提醒

> 给自己看的，每次开发新功能前读一遍。

---

## ⚠️ 铁律

1. **正式版在 `main` 分支，永远不要直接在 `main` 上改代码**

2. **开发新功能在 `dev-v*` 分支**

3. **版本的 `-dev` 后缀**：dev 分支的版本号必须带 `-dev`
   - `main` 上：`v1.3.4`
   - `dev` 上：`v1.3.4-dev` 或 `v1.3.5-dev`

4. **测试通过后才合并到 `main` 并打 tag**

---

## 🔄 日常流程

```bash
# 1. 确认在开发分支
git branch   # 应该显示 * dev-v1.3.0

# 2. 改版本号为 -dev（如果忘记改了）
# 编辑 templates/base.html，版本号末尾加 -dev

# 3. 开发、测试、提交
git add -A
git commit -m "v1.3.x-dev: 描述改动"
git push

# 4. 测试通过后，发布正式版：
#    - 去 -dev 后缀 → v1.3.x
#    - 更新 Docker 版本号
#    - 合并到 main
#    - 打 tag v1.3.x
#    - 推送
#    - 切回 dev 分支，版本号 +1 并加 -dev

# 5. 发布后切回 dev，把版本号改成下一个 -dev
```

---

## 📝 版本号规则

```
main:    v1.3.4    (正式版)
dev:     v1.3.4-dev (开发中)  或  v1.3.5-dev (下一版)
tag:     v1.3.4
```

每发布一次，第三位 +1。

---

## ✅ 回归测试

每次改保存逻辑、日期逻辑、考勤或留存前后都跑：

```bash
python -m unittest discover -s tests -v
python -m py_compile app.py config.py db.py scripts/inspect_db.py tests/test_regressions.py
```

当前测试重点覆盖：

- 出库跨日期保存保护
- 考勤历史记录编辑
- 留存不能扣成负数

---

## 🔎 数据库检查

排查服务器数据时先用只读检查脚本：

```bash
python scripts/inspect_db.py instance/eggnum.db
python scripts/inspect_db.py /data/eggnum.db --from 2026-06-25 --to 2026-06-29
```

输出里的标记：

- `!` 表示同一天有多条出库主记录
- `?` 表示当天出库总数为 0

---

## 🧱 模块边界

当前重构方向：

- `config.py`：版本号、产品模板、默认店名、Flask 配置
- `db.py`：SQLite 连接、关闭、建表、轻量迁移
- `services/attendance.py`：考勤增删改查、历史分组、导出查询
- `app.py`：暂时保留路由和业务流程，后续再拆 services/routes
