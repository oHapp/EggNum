# 鸡蛋库存登记助手 — 开发设计文档 (design.md)

> 版本: 1.0 | 日期: 2026-06-04 | 技术栈: Python Flask + SQLite + Vanilla JS (PWA)

---

## 目录

1. [项目概述](#1-项目概述)
2. [技术架构](#2-技术架构)
3. [数据结构设计](#3-数据结构设计)
4. [核心逻辑：加减按钮交互](#4-核心逻辑加减按钮交互)
5. [核心逻辑：0值为空](#5-核心逻辑0值为空)
6. [文本生成与输出格式](#6-文本生成与输出格式)
7. [页面与路由设计](#7-页面与路由设计)
8. [移动端 UI/UX 规范](#8-移动端-uiux-规范)
9. [PWA 配置](#9-pwa-配置)
10. [文件结构](#10-文件结构)

---

## 1. 项目概述

### 1.1 目标

为鸡蛋库存登记场景提供一个移动端优先的 Web 应用。用户通过大尺寸加减按钮快速录入各规格鸡蛋数量，一键生成格式化文本并复制到剪贴板，同时支持历史记录回溯。

### 1.2 核心用户流程

```
首页(录入) ──点击[+]/[-]或手动输入──> 调整数量
    │                                    │
    │                              ┌─────┴──────┐
    │                              │ 生成并复制  │ ──> Toast "已复制"
    │                              └─────┬──────┘
    │                                    │
    │                              同时存入 SQLite
    │
    └── 导航栏 ──> 历史记录页 ──> 查看过往记录
                                    │
                                    └──> 一键重新复制
```

### 1.3 输出格式示例

```
鹏泰(大福店) 6月4日
农家蛋30枚:2
五谷蛋30枚:1
虫草蛋30枚:1
农家蛋15枚:3
五谷蛋15枚:1
虫草蛋15枚:1
虫草蛋10枚:2
五谷蛋10枚:
小花蛋30枚:
五黑初生蛋20枚:11
```

> **关键规则**: 数量为 0 时，冒号后留空，不显示 `0`。

---

## 2. 技术架构

```
┌──────────────────────────────────────────┐
│                 前端 (PWA)                │
│  HTML5 + CSS3 + Vanilla JS               │
│  - manifest.json (添加到主屏幕)           │
│  - Service Worker (离线缓存)              │
│  - navigator.clipboard (剪贴板 API)       │
│  - navigator.vibrate (震动反馈)           │
└──────────────────┬───────────────────────┘
                   │ HTTP (fetch / form POST)
┌──────────────────▼───────────────────────┐
│              后端 (Flask)                 │
│  - Jinja2 模板渲染 (首页 + 历史页)        │
│  - RESTful API (提交/查询)                │
│  - SQLite 操作 (通过 sqlite3 模块)        │
└──────────────────┬───────────────────────┘
                   │
┌──────────────────▼───────────────────────┐
│              SQLite 数据库                │
│  文件: instance/eggnum.db                │
│  表: records, record_items               │
└──────────────────────────────────────────┘
```

| 层级 | 技术选型 | 理由 |
|------|---------|------|
| 后端框架 | Flask | 轻量, Python 生态, 快速开发 |
| 数据库 | SQLite | 零配置, 单文件, 适合单机小数据量 |
| 前端 | 原生 HTML/JS/CSS | 无构建工具依赖, PWA 开箱即用 |
| 剪贴板 | `navigator.clipboard.writeText()` | 现代浏览器原生支持 |
| 震动 | `navigator.vibrate()` / 兼容模式 | Android 原生; iOS 通过 Safari 间接支持 |

---

## 3. 数据结构设计

### 3.1 预设模板数据 (常量, 定义在 Python 中)

```python
# 格式: { "品类名": [规格列表(枚数)] }
PRESET_TEMPLATES = {
    "农家蛋":   [30, 15],
    "五谷蛋":   [30, 15, 10],
    "虫草蛋":   [30, 15, 10],
    "小花蛋":   [30, 20, 15],
    "五黑初生蛋": [20],
    "初生蛋":   [20],
}
```

### 3.2 数据库表设计

```sql
-- 每次提交生成一条主记录
CREATE TABLE records (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    store_name  TEXT NOT NULL DEFAULT '鹏泰(大福店)',
    record_date DATE NOT NULL,          -- 录入日期 (YYYY-MM-DD)
    created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- 每条主记录下挂多个规格明细
CREATE TABLE record_items (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    record_id   INTEGER NOT NULL,
    category    TEXT NOT NULL,           -- 品类名, 如 "农家蛋"
    spec        INTEGER NOT NULL,        -- 规格(枚数), 如 30
    quantity    INTEGER NOT NULL DEFAULT 0,  -- 数量, 0 表示未填
    sort_order  INTEGER NOT NULL DEFAULT 0,  -- 排序(按模板顺序)
    FOREIGN KEY (record_id) REFERENCES records(id)
);
```

### 3.3 数据流

```
前端表单 ──POST JSON──> Flask API (/api/submit)
                          │
                          ├── INSERT INTO records (...)
                          ├── 循环 INSERT INTO record_items (...)
                          ├── 生成格式化文本
                          └── 返回 JSON { success, text, record_id }

历史查询 ──GET──> Flask API (/api/history)
                    │
                    └── SELECT ... JOIN ... ORDER BY record_date DESC
                        返回 JSON [{ id, date, text, items: [...] }, ...]
```

---

## 4. 核心逻辑：加减按钮交互

### 4.1 设计目标

- **大尺寸触碰区域**: 按钮最小 48×48px (超过 Apple HIG 建议的 44pt)
- **按住连续加减**: 支持长按快速增减 (可选增强)
- **视觉反馈**: 点击瞬间背景色变化 + 数字弹跳动画
- **数值边界**: 最小值 0, 最大值 999 (防止异常数据)
- **震动反馈**: 每次点击触发 10ms 短震 (iOS Safari 需特殊处理)

### 4.2 HTML 结构

每个规格行由**一个隐藏控件 + 三个可见元素**组成：

```html
<div class="spec-row" data-category="农家蛋" data-spec="30">
  <!-- 隐藏的原始 input, 作为"数据源", 默认 value=0 -->
  <input type="hidden"
         class="spec-value"
         name="qty_农家蛋_30"
         value="0">

  <!-- 左侧: 品名+规格标签 (只读) -->
  <span class="spec-label">农家蛋30枚</span>

  <!-- 中间: 数量控制组 -->
  <div class="quantity-control">
    <!-- [-] 按钮: min 48×48px -->
    <button type="button"
            class="btn-qty btn-minus"
            aria-label="减少农家蛋30枚"
            data-target="qty_农家蛋_30">−</button>

    <!-- 数字显示/输入框: 介于两个按钮之间 -->
    <input type="number"
           class="qty-display"
           inputmode="numeric"
           pattern="[0-9]*"
           min="0" max="999"
           value="0"
           data-target="qty_农家蛋_30"
           readonly>

    <!-- [+] 按钮: min 48×48px -->
    <button type="button"
            class="btn-qty btn-plus"
            aria-label="增加农家蛋30枚"
            data-target="qty_农家蛋_30">+</button>
  </div>
</div>
```

> **设计要点**:
> - 隐藏 input 作为真实数据载体 (提交时读取其 value)
> - 可见 input 使用 `readonly` 属性, 禁止键盘直接输入时意外触发页面滚动 (但同时绑定 click 事件允许手动输入)
> - 实际做法见 4.4

### 4.3 改进方案: 可编辑的数字输入

由于用户要求"支持点击数字手动输入", 数字显示区必须是可编辑的 `<input>`。但又要避免 `type="number"` 在 iOS 上的一些问题 (如显示微调箭头)。推荐方案：

```html
<!-- 最终推荐方案 -->
<input type="text"
       class="qty-display"
       inputmode="numeric"
       pattern="[0-9]*"
       min="0" max="999"
       value="0"
       autocomplete="off">
```

选择 `type="text"` + `inputmode="numeric"` 的组合：
- `inputmode="numeric"` → iOS 弹出纯数字键盘
- `type="text"` → 不显示浏览器默认的微调箭头 (spin buttons), 界面更干净
- `pattern="[0-9]*"` → HTML5 表单验证保证只接受数字

### 4.4 JavaScript 交互逻辑 (伪代码/关键实现)

```javascript
// ==========================================
// 加减按钮控制器
// ==========================================

class QuantityController {

  constructor(rowElement) {
    this.row      = rowElement;
    this.display  = rowElement.querySelector('.qty-display');
    this.btnMinus = rowElement.querySelector('.btn-minus');
    this.btnPlus  = rowElement.querySelector('.btn-plus');
    this.min      = 0;
    this.max      = 999;

    this._bindEvents();
  }

  // --- 事件绑定 ---
  _bindEvents() {
    // 1. [+] 按钮点击
    this.btnPlus.addEventListener('pointerdown', (e) => {
      e.preventDefault();            // 阻止焦点丢失
      this.increment();
      this._hapticFeedback();        // 震动
    });

    // 2. [-] 按钮点击
    this.btnMinus.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.decrement();
      this._hapticFeedback();
    });

    // 3. 手动输入: 失焦时校正数值
    this.display.addEventListener('blur', () => {
      this._sanitizeValue();
    });

    // 4. 手动输入: 回车确认
    this.display.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.display.blur();         // 失焦触发校正
      }
    });

    // 5. 防止双击选中文本 (移动端体验优化)
    this.btnMinus.addEventListener('selectstart', (e) => e.preventDefault());
    this.btnPlus.addEventListener('selectstart', (e) => e.preventDefault());
  }

  // --- 核心方法 ---

  /** 获取当前数值 */
  getValue() {
    const raw = this.display.value.trim();
    if (raw === '') return 0;        // 空值 → 0
    const n = parseInt(raw, 10);
    return isNaN(n) ? 0 : n;
  }

  /** 设置数值并更新 UI */
  setValue(val) {
    const clamped = Math.max(this.min, Math.min(this.max, val));
    this.display.value = clamped;
    // 视觉提示: 如果值为 0, 添加 .is-zero 样式 (变灰)
    this.display.classList.toggle('is-zero', clamped === 0);
  }

  /** 加 1 */
  increment() {
    this.setValue(this.getValue() + 1);
    this._animateButton(this.btnPlus);
  }

  /** 减 1 (下限 0) */
  decrement() {
    if (this.getValue() > 0) {
      this.setValue(this.getValue() - 1);
      this._animateButton(this.btnMinus);
    }
  }

  // --- 辅助方法 ---

  /** 数值校正: 处理非法输入 */
  _sanitizeValue() {
    const raw = this.display.value.trim();
    // 空字符串 → 设为 0
    if (raw === '') {
      this.setValue(0);
      return;
    }
    // 非纯数字 → 恢复上次有效值
    if (!/^\d+$/.test(raw)) {
      this.setValue(this._lastValidValue || 0);
      return;
    }
    const n = parseInt(raw, 10);
    if (n < this.min) this.setValue(this.min);
    else if (n > this.max) this.setValue(this.max);
    else {
      this._lastValidValue = n;
      this.setValue(n);
    }
  }

  /** 震动反馈 */
  _hapticFeedback() {
    // Android / 标准 API
    if (navigator.vibrate) {
      navigator.vibrate(10);         // 10ms 短震
    }
    // iOS Safari 不支持 vibrate, 但 PWA 模式下
    // 可通过 Haptic 模拟: 用 CSS 动画产生"触感错觉"
    // (实际 iPhone 上的点击反馈依赖于系统级 Taptic Engine,
    //  在网页中无法直接调用; 但添加到主屏幕后,
    //  系统会为所有 tap 事件提供默认的轻触反馈)
  }

  /** 按钮点击动画 (视觉反馈) */
  _animateButton(btn) {
    btn.classList.add('btn-pressed');
    // 100ms 后移除, 模拟"按下-弹起"
    setTimeout(() => btn.classList.remove('btn-pressed'), 100);
  }
}

// --- 页面初始化 ---
document.addEventListener('DOMContentLoaded', () => {
  // 为每一行规格绑定控制器
  document.querySelectorAll('.spec-row').forEach(row => {
    new QuantityController(row);
  });
});
```

### 4.5 关键设计决策说明

| 决策点 | 选择 | 理由 |
|--------|------|------|
| 事件类型 | `pointerdown` (非 `click`) | `click` 有 300ms 延迟 (移动端); `pointerdown` 即时响应 |
| 防止焦点丢失 | `e.preventDefault()` | 避免点击按钮时数字输入框获取焦点并弹出键盘 |
| 输入框类型 | `type="text"` + `inputmode="numeric"` | 数字键盘 + 无微调箭头 + 界面干净 |
| 最大值 | 999 | 业务合理上限, 防止手误输入过长数字 |
| 空字符串处理 | 校正为 0 | 用户在输入框中清空内容后失焦, 自动回退为 0 |

### 4.6 CSS 按钮样式 (移动端尺寸)

```css
/* 加减按钮 — 满足 48×48px 最小触摸区域 */
.btn-qty {
  width: 48px;
  height: 48px;
  border-radius: 12px;
  border: 2px solid #e0e0e0;
  background: #f8f9fa;
  font-size: 24px;
  font-weight: 700;
  line-height: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  user-select: none;
  -webkit-user-select: none;
  -webkit-tap-highlight-color: transparent;
  /* 防止 iOS 长按弹出菜单 */
  -webkit-touch-callout: none;
  transition: background 0.1s, transform 0.1s;
}

/* 按下状态: 瞬间反馈 (< 100ms) */
.btn-qty.btn-pressed,
.btn-qty:active {
  background: #c0c0c0;
  transform: scale(0.92);
}

/* [+] 绿色调 */
.btn-plus {
  background: #e8f5e9;
  border-color: #a5d6a7;
  color: #2e7d32;
}
.btn-plus:active {
  background: #c8e6c9;
}

/* [-] 红色调 (仅在 > 0 时高亮) */
.btn-minus {
  background: #fce4ec;
  border-color: #ef9a9a;
  color: #c62828;
}
.btn-minus:active {
  background: #ffcdd2;
}

/* 数量为 0 时 [-] 按钮置灰 */
.spec-row.is-empty .btn-minus {
  background: #f5f5f5;
  border-color: #e0e0e0;
  color: #bdbdbd;
}
```

---

## 5. 核心逻辑：0值为空

### 5.1 双层"空"概念

在整个系统中, "0" 有**两个层面的含义**, 必须区分处理：

| 层面 | 含义 | 存储 | 显示 |
|------|------|------|------|
| 数据库 | 用户从未填过此规格 | `quantity = 0` | — |
| 输出文本 | 该规格数量为 0, 跳过显示数字 | 冒号后为空 `:` | 不显示 `0` |

### 5.2 输出文本生成逻辑

```python
def generate_output_text(store_name: str, record_date: str,
                         items: list[dict]) -> str:
    """
    生成格式化文本。

    Args:
        store_name:  店铺名称, 如 "鹏泰(大福店)"
        record_date: 日期字符串, 如 "6月4日"
        items:       明细列表, 每个元素为 {"category": str, "spec": int, "quantity": int}

    Returns:
        格式化后的多行文本
    """
    # 第1行: 店名 + 日期
    lines = [f"{store_name} {record_date}"]

    for item in items:
        category = item["category"]
        spec = item["spec"]
        qty = item.get("quantity", 0)

        # ★ 核心判断: qty == 0 时冒号后为空字符串
        qty_str = str(qty) if qty > 0 else ""

        line = f"{category}{spec}枚:{qty_str}"
        lines.append(line)

    return "\n".join(lines)
```

### 5.3 JavaScript 端等效逻辑

```javascript
/**
 * 从前端表单收集数据并生成输出文本
 * @param {string} storeName - 店铺名
 * @param {string} dateStr   - 日期字符串 "M月D日"
 * @param {Array}  rows      - 规格行数据 [{category, spec, quantity}, ...]
 * @returns {string} 格式化文本
 */
function generateOutputText(storeName, dateStr, rows) {
  let lines = [`${storeName} ${dateStr}`];

  for (const row of rows) {
    const { category, spec, quantity } = row;

    // ★ 核心判断: quantity 为 0 或是假值时, 冒号后留空
    const qtyStr = (quantity && quantity > 0) ? String(quantity) : '';

    lines.push(`${category}${spec}枚:${qtyStr}`);
  }

  return lines.join('\n');
}
```

### 5.4 判断流程图

```
输入: quantity (整数)

    ┌──────────────────┐
    │ quantity 是否为 0? │
    └──────┬───────────┘
           │
     ┌─────┴─────┐
     │ YES       │ NO
     ▼           ▼
   冒号后为空   冒号后接 quantity.toString()
   "农家蛋30枚:"   "农家蛋30枚:5"
```

### 5.5 边界情况处理

| 情况 | 输入 | 输出 |
|------|------|------|
| 正常有值 | `quantity = 5` | `农家蛋30枚:5` |
| 明确为 0 | `quantity = 0` | `农家蛋30枚:` |
| 空输入框失焦 | `display.value = ""` | 先校正为 `0`, 再输出 `:` |
| 非法字符输入 | `display.value = "abc"` | 校正为上次有效值或 `0`, 输出 `:` |
| 空格输入 | `display.value = "  "` | trim 后为 `""`, 校正为 `0`, 输出 `:` |
| 负值 | `display.value = "-5"` | `parseInt` → `-5`, clamp 到 `0`, 输出 `:` |

---

## 6. 文本生成与输出格式

### 6.1 完整生成流程 (后端 API)

```
POST /api/submit
Content-Type: application/json

{
  "store_name": "鹏泰(大福店)",
  "record_date": "2026-06-04",
  "items": [
    {"category": "农家蛋", "spec": 30, "quantity": 2},
    {"category": "五谷蛋", "spec": 30, "quantity": 1},
    ...
    {"category": "小花蛋", "spec": 30, "quantity": 0}   // ← 0 值也提交
  ]
}

↓ Flask 处理

1. 参数校验 (store_name 非空, record_date 合法, items 为数组)
2. 解析日期: "2026-06-04" → "6月4日" (用于输出文本)
3. 按模板排序 items (保持与 PRESET_TEMPLATES 一致顺序)
4. INSERT INTO records (store_name, record_date)
5. 对每个 item: INSERT INTO record_items (record_id, category, spec, quantity, sort_order)
6. 调用 generate_output_text() 生成文本
7. 返回 JSON

→ Response:
{
  "success": true,
  "text": "鹏泰(大福店) 6月4日\n农家蛋30枚:2\n...",
  "record_id": 1
}
```

### 6.2 前端"生成并复制"流程

```javascript
async function handleSubmit() {
  // 1. 收集所有规格行数据
  const rows = [];
  document.querySelectorAll('.spec-row').forEach(row => {
    const display = row.querySelector('.qty-display');
    const rawVal = display.value.trim();
    const quantity = (rawVal === '' || !/^\d+$/.test(rawVal))
                     ? 0
                     : parseInt(rawVal, 10);

    rows.push({
      category: row.dataset.category,
      spec: parseInt(row.dataset.spec),
      quantity: quantity
    });
  });

  // 2. 前端直接生成文本 (即时预览, 无需等待后端)
  const dateStr = formatDate(new Date()); // "6月4日"
  const text = generateOutputText('鹏泰(大福店)', dateStr, rows);

  // 3. 复制到剪贴板
  try {
    await navigator.clipboard.writeText(text);
    showToast('✅ 已复制到剪贴板');
    vibrate([10, 50, 10]);  // 成功震动模式
  } catch (err) {
    // 降级方案: 使用 textarea + execCommand
    fallbackCopy(text);
    showToast('✅ 已复制 (请手动粘贴)');
  }

  // 4. 异步提交到后端 (不阻塞 UI)
  fetch('/api/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      store_name: '鹏泰(大福店)',
      record_date: new Date().toISOString().split('T')[0],
      items: rows
    })
  }).catch(err => {
    // 静默失败不影响用户体验, 可后续补传
    console.error('提交失败:', err);
  });
}
```

### 6.3 Toast 提示实现

```javascript
function showToast(message, duration = 2000) {
  const toast = document.getElementById('toast') || createToastElement();
  toast.textContent = message;
  toast.classList.add('toast--visible');

  clearTimeout(toast._timeout);
  toast._timeout = setTimeout(() => {
    toast.classList.remove('toast--visible');
  }, duration);
}

function createToastElement() {
  const el = document.createElement('div');
  el.id = 'toast';
  el.className = 'toast';
  document.body.appendChild(el);
  return el;
}
```

```css
/* Toast 弹窗 — 顶部居中浮层 */
.toast {
  position: fixed;
  top: 20px;
  left: 50%;
  transform: translateX(-50%) translateY(-120px);
  background: #323232;
  color: #fff;
  padding: 12px 24px;
  border-radius: 24px;
  font-size: 16px;
  font-weight: 500;
  z-index: 9999;
  opacity: 0;
  transition: transform 0.3s ease, opacity 0.3s ease;
  pointer-events: none;
  box-shadow: 0 4px 12px rgba(0,0,0,0.25);
}

.toast--visible {
  transform: translateX(-50%) translateY(0);
  opacity: 1;
}
```

---

## 7. 页面与路由设计

### 7.1 Flask 路由表

| 方法 | 路径 | 功能 | 返回 |
|------|------|------|------|
| GET | `/` | 首页 — 录入界面 | HTML (Jinja2) |
| GET | `/history` | 历史记录列表页 | HTML (Jinja2) |
| POST | `/api/submit` | 提交录入数据 | JSON |
| GET | `/api/history` | 获取历史记录 (JSON) | JSON |
| GET | `/api/history/<id>` | 获取某条记录详情 | JSON |
| GET | `/api/history/<id>/text` | 重新生成某条记录的文本 | JSON |
| GET | `/manifest.json` | PWA 清单 | JSON |
| GET | `/sw.js` | Service Worker | JS |

### 7.2 首页布局 (移动端 375px 基准)

```
┌────────────────────────────────┐
│  🥚 鸡蛋库存登记助手            │  ← header
├────────────────────────────────┤
│  鹏泰(大福店)   [6月4日]        │  ← 店名 + 日期
├────────────────────────────────┤
│  ▸ 农家蛋                      │  ← 品类分组 (可折叠)
│    [−] 30枚: [ 2 ] [+]        │
│    [−] 15枚: [ 3 ] [+]        │
│                                │
│  ▸ 五谷蛋                      │
│    [−] 30枚: [ 1 ] [+]        │
│    [−] 15枚: [ 1 ] [+]        │
│    [−] 10枚: [   ] [+]        │  ← 0 值显示为空
│                                │
│  ▸ 虫草蛋                      │
│    ...                         │
│                                │
│  ▸ 小花蛋                      │
│    ...                         │
│                                │
│  ▸ 五黑初生蛋                   │
│    ...                         │
│                                │
│  ▸ 初生蛋                      │
│    ...                         │
├────────────────────────────────┤
│  ┌──────────────────────────┐  │
│  │     📋 生成并复制         │  │  ← 主操作按钮 (full-width)
│  └──────────────────────────┘  │
│  ┌──────────────────────────┐  │
│  │     📜 查看历史记录       │  │  ← 导航到 /history
│  └──────────────────────────┘  │
└────────────────────────────────┘
```

### 7.3 历史记录页布局

```
┌────────────────────────────────┐
│  ← 返回    历史记录             │
├────────────────────────────────┤
│  2026-06-04                    │  ← 日期分组 (倒序)
│  ┌──────────────────────────┐  │
│  │ 鹏泰(大福店) 6月4日       │  │
│  │ 农家蛋30枚:2  五谷蛋30枚:1│  │  ← 文本预览 (截断 2 行)
│  │ ...                      │  │
│  │              [📋 复制]   │  │  ← 一键复制按钮
│  └──────────────────────────┘  │
│                                │
│  2026-06-03                    │
│  ┌──────────────────────────┐  │
│  │ ...                      │  │
│  └──────────────────────────┘  │
└────────────────────────────────┘
```

---

## 8. 移动端 UI/UX 规范

### 8.1 Viewport 与缩放控制

```html
<!-- 必须在 <head> 中第一行设置 -->
<meta name="viewport"
      content="width=device-width,
               initial-scale=1.0,
               maximum-scale=1.0,
               user-scalable=no,
               viewport-fit=cover">
```

| 属性 | 作用 |
|------|------|
| `width=device-width` | 以设备物理宽度为基准 |
| `initial-scale=1.0` | 初始不缩放 |
| `maximum-scale=1.0` | **禁止双击/输入时自动放大** (核心) |
| `user-scalable=no` | 禁止手动捏合缩放 |
| `viewport-fit=cover` | iPhone X+ 全面屏适配, 内容延伸到安全区域 |

### 8.2 键盘优化

```html
<!-- 所有数字输入框统一使用 -->
<input type="text"
       inputmode="numeric"
       pattern="[0-9]*"
       autocomplete="off">
```

> iOS Safari 对 `inputmode="numeric"` 的支持: 弹出纯数字键盘 (无小数点, 无符号)。

### 8.3 触摸区域规范

| 元素 | 最小尺寸 | 实际建议 |
|------|---------|---------|
| `[+]` / `[-]` 按钮 | 44×44px (Apple HIG) | **48×48px** |
| 数字输入框 | 44px 高 | **48px 高** |
| 行间距 | — | **12px** (防止误触相邻按钮) |
| "生成并复制"按钮 | 44px 高 | **56px 高**, full-width |

### 8.4 聚焦样式

```css
/* 输入框聚焦时的高亮环 */
.qty-display:focus {
  outline: none;
  box-shadow: 0 0 0 3px rgba(66, 133, 244, 0.4);
  border-color: #4285f4;
}

/* 聚焦时整体行微高亮 */
.spec-row:focus-within {
  background: rgba(66, 133, 244, 0.04);
}
```

### 8.5 安全区域适配 (iPhone 底部横条)

```css
/* 主操作按钮区域适配 iPhone 底部 Home Indicator */
.main-actions {
  padding-bottom: env(safe-area-inset-bottom, 16px);
}

/* 顶部适配刘海/灵动岛 */
.app-header {
  padding-top: env(safe-area-inset-top, 16px);
}
```

### 8.6 颜色与视觉

```css
:root {
  --color-primary: #4CAF50;      /* 主色调: 绿色 (鸡蛋/农业联想) */
  --color-primary-dark: #388E3C;
  --color-bg: #FAFAFA;           /* 浅灰背景 */
  --color-surface: #FFFFFF;      /* 卡片白 */
  --color-text: #212121;         /* 主文字 */
  --color-text-secondary: #757575;
  --color-border: #E0E0E0;
  --radius: 12px;                /* 统一圆角 */
  --shadow: 0 2px 8px rgba(0,0,0,0.08);
}
```

---

## 9. PWA 配置

### 9.1 manifest.json

```json
{
  "name": "鸡蛋库存登记助手",
  "short_name": "鸡蛋登记",
  "description": "快速录入鸡蛋库存, 一键生成并复制文本",
  "start_url": "/",
  "display": "standalone",
  "orientation": "portrait",
  "background_color": "#FAFAFA",
  "theme_color": "#4CAF50",
  "icons": [
    {
      "src": "/static/icons/icon-192.png",
      "sizes": "192x192",
      "type": "image/png"
    },
    {
      "src": "/static/icons/icon-512.png",
      "sizes": "512x512",
      "type": "image/png",
      "purpose": "any maskable"
    }
  ]
}
```

### 9.2 HTML 引入

```html
<link rel="manifest" href="/manifest.json">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="default">
<meta name="apple-mobile-web-app-title" content="鸡蛋登记">
<link rel="apple-touch-icon" href="/static/icons/icon-192.png">
<meta name="theme-color" content="#4CAF50">
```

### 9.3 Service Worker (离线缓存策略)

- **策略**: Cache-first for static assets, Network-first for API
- **缓存内容**: CSS, JS, 图标, 首页 HTML shell
- **不缓存**: `/api/*` 接口响应 (保证数据实时性)

---

## 10. 文件结构

```
EggNum/
├── design.md                  ← 本文件
├── app.py                     ← Flask 应用入口
├── requirements.txt           ← Python 依赖 (Flask)
├── instance/
│   └── eggnum.db              ← SQLite 数据库 (自动创建)
├── templates/
│   ├── base.html              ← 公共布局 (viewport, PWA meta, 全局 CSS/JS)
│   ├── index.html             ← 首页 — 录入界面
│   └── history.html           ← 历史记录页
├── static/
│   ├── css/
│   │   └── app.css            ← 全局样式 (移动端优化)
│   ├── js/
│   │   ├── quantity.js        ← 加减按钮控制器 (QuantityController 类)
│   │   ├── app.js             ← 主逻辑 (提交, 复制, Toast)
│   │   └── history.js         ← 历史记录页交互
│   ├── icons/
│   │   ├── icon-192.png       ← PWA 图标 192×192
│   │   └── icon-512.png       ← PWA 图标 512×512
│   ├── manifest.json          ← PWA 清单
│   └── sw.js                  ← Service Worker
└── .vscode/
    └── settings.json
```

---

## 附录 A: 完整交互状态表

| 用户操作 | UI 变化 | 数据变化 | 触觉 |
|---------|---------|---------|------|
| 点击 `[+]` | 数字 +1, 按钮缩放动画, `[-]` 恢复红色 | `quantity += 1` | ✅ 震动 10ms |
| 点击 `[-]` (当前 > 0) | 数字 -1, 按钮缩放动画 | `quantity -= 1` | ✅ 震动 10ms |
| 点击 `[-]` (当前 = 0) | 无变化, `[-]` 保持灰色 | 不变 | ❌ 无震动 |
| 点击数字 | 输入框聚焦, 弹出数字键盘, 高亮环出现 | — | — |
| 输入数字后失焦 | 校正数值 (clamp 0~999), 键盘收起 | 校正后的值 | — |
| 清空数字后失焦 | 恢复为 0, 显示为空 | `0` | — |
| 点击"生成并复制" | Toast "已复制", 按钮短暂变色 | 提交到后端 | ✅ 双震 |
| 点击"查看历史" | 跳转 `/history` | — | — |
| 历史页点击"复制" | Toast "已复制" | — | ✅ 震动 |

## 附录 B: "0值为空"逻辑的所有实现点

| 位置 | 代码文件 | 关键判断 |
|------|---------|---------|
| 后端文本生成 | `app.py` → `generate_output_text()` | `qty_str = str(qty) if qty > 0 else ""` |
| 前端文本生成 | `static/js/app.js` → `generateOutputText()` | `const qtyStr = (quantity && quantity > 0) ? String(quantity) : ''` |
| 输入框失焦校正 | `static/js/quantity.js` → `_sanitizeValue()` | 空值 → `setValue(0)` → `display.value = 0` |
| CSS 视觉空态 | `static/css/app.css` | `.qty-display.is-zero { color: #ccc; }` (0 值时文字变灰) |
| 历史记录展示 | `templates/history.html` (Jinja2) | `{{ qty if qty > 0 else '' }}` |
