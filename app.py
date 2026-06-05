"""
鸡蛋库存登记助手 — Flask 应用入口

- GET  /                     首页 (录入界面)
- GET  /history              历史记录页
- GET  /api/today            获取今天的最新记录 (自动加载)
- POST /api/submit           提交/更新录入数据 (支持 upsert)
- GET  /api/history          获取历史记录列表 (JSON)
- GET  /api/history/<id>     获取某条记录详情 (JSON)
- PUT  /api/history/<id>     更新某条记录 (批量编辑)
- DELETE /api/history/<id>   删除某条记录
"""

import os
import sqlite3
from datetime import date, datetime

from flask import Flask, g, jsonify, render_template, request

# ==========================================
#  App factory
# ==========================================

app = Flask(__name__)
app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "dev-eggnum-2026")

# Database path: honour EGGS_DB_DIR env var, fallback to instance/
_db_dir = os.environ.get("EGGS_DB_DIR", app.instance_path)
app.config["DATABASE"] = os.path.join(_db_dir, "eggnum.db")

os.makedirs(_db_dir, exist_ok=True)

# ==========================================
#  Preset templates (from design.md §3.1)
# ==========================================

PRESET_TEMPLATES: dict[str, list[int]] = {
    "农家蛋":   [30, 15],
    "五谷蛋":   [30, 15, 10],
    "虫草蛋":   [30, 15, 10],
    "小花蛋":   [30, 20, 15],
    "五黑初生蛋": [20],
    "初生蛋":   [20],
}

DEFAULT_STORE_NAME = "鹏泰(大福店)"


# ==========================================
#  Helpers: build flat item list in template order
# ==========================================

def build_ordered_items(
    quantities_by_key: dict[str, int] | None = None,
) -> list[dict]:
    """
    Build a flat list of {category, spec, quantity} in preset template order.
    quantities_by_key: optional dict keyed by "category_spec" → quantity.
    """
    result = []
    for cat in PRESET_TEMPLATES:
        for sp in PRESET_TEMPLATES[cat]:
            key = f"{cat}_{sp}"
            qty = quantities_by_key.get(key, 0) if quantities_by_key else 0
            result.append({"category": cat, "spec": sp, "quantity": qty})
    return result


def _item_key(category: str, spec: int) -> str:
    return f"{category}_{spec}"


# ==========================================
#  Database helpers
# ==========================================


def get_db() -> sqlite3.Connection:
    """Get a database connection for the current request."""
    if "db" not in g:
        g.db = sqlite3.connect(app.config["DATABASE"])
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA journal_mode=WAL")
        g.db.execute("PRAGMA foreign_keys=ON")
    return g.db


@app.teardown_appcontext
def close_db(exception: object) -> None:
    """Close the database connection at the end of a request."""
    db = g.pop("db", None)
    if db is not None:
        db.close()


def init_db() -> None:
    """Create tables if they don't exist."""
    db = get_db()
    db.executescript("""
        CREATE TABLE IF NOT EXISTS records (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            store_name  TEXT NOT NULL DEFAULT '鹏泰(大福店)',
            record_date DATE NOT NULL,
            created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS record_items (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            record_id   INTEGER NOT NULL,
            category    TEXT NOT NULL,
            spec        INTEGER NOT NULL,
            quantity    INTEGER NOT NULL DEFAULT 0,
            sort_order  INTEGER NOT NULL DEFAULT 0,
            FOREIGN KEY (record_id) REFERENCES records(id)
        );

        CREATE INDEX IF NOT EXISTS idx_items_record
            ON record_items(record_id);
        CREATE INDEX IF NOT EXISTS idx_records_date
            ON records(record_date);
    """)
    db.commit()


# ==========================================
#  Text generation (core logic)
# ==========================================


def generate_output_text(
    store_name: str,
    record_date_str: str,
    items: list[dict],
) -> str:
    """
    Generate formatted output text.

    Key rule: quantity == 0 → blank after colon (not "0").
    See design.md §5.2.
    """
    lines = [f"{store_name} {record_date_str}"]

    for item in items:
        category = item["category"]
        spec = item["spec"]
        qty = item.get("quantity", 0)

        # ★ Core judgment: qty == 0 → empty string
        qty_str = str(qty) if qty > 0 else ""

        lines.append(f"{category}{spec}枚:{qty_str}")

    return "\n".join(lines)


def format_date_cn(d: date) -> str:
    """Convert a date object to Chinese format like '6月4日'."""
    return f"{d.month}月{d.day}日"



def _load_items_for_record(record_id: int) -> list[dict]:
    """Load all items for a single record, ordered by sort_order."""
    db = get_db()
    rows = db.execute(
        """SELECT category, spec, quantity
           FROM record_items
           WHERE record_id = ?
           ORDER BY sort_order""",
        (record_id,),
    ).fetchall()
    return [dict(r) for r in rows]


# ==========================================
#  Routes — Pages
# ==========================================


@app.route("/")
def index():
    """Home page — data entry form."""
    today = date.today()
    return render_template(
        "index.html",
        store_name=DEFAULT_STORE_NAME,
        date_display=format_date_cn(today),
        templates=PRESET_TEMPLATES,
    )


@app.route("/history")
def history():
    """History page — list past records.  Optimized: single batch query for all items."""
    db = get_db()
    records = db.execute(
        """
        SELECT id, store_name, record_date, created_at
        FROM records
        ORDER BY record_date DESC, created_at DESC
        """
    ).fetchall()

    if not records:
        return render_template("history.html", date_groups=[])

    # ★ Optimisation: batch-load all items in ONE query (fixes N+1)
    record_ids = [r["id"] for r in records]
    placeholders = ",".join("?" for _ in record_ids)
    all_items = db.execute(
        f"""SELECT record_id, category, spec, quantity
            FROM record_items
            WHERE record_id IN ({placeholders})
            ORDER BY record_id, sort_order""",
        record_ids,
    ).fetchall()

    # Group items by record_id
    items_by_record: dict[int, list[dict]] = {}
    for item in all_items:
        rid = item["record_id"]
        if rid not in items_by_record:
            items_by_record[rid] = []
        items_by_record[rid].append(
            {"category": item["category"], "spec": item["spec"], "quantity": item["quantity"]}
        )

    # Build date groups
    date_groups: list[dict] = []
    seen_dates: set[str] = set()

    for row in records:
        d = row["record_date"]
        if d not in seen_dates:
            seen_dates.add(d)
            date_groups.append({"date_display": d, "records": []})

        items_list = items_by_record.get(row["id"], [])
        full_text = generate_output_text(row["store_name"], d, items_list)

        # Preview: first 3 lines
        preview_lines = full_text.split("\n")
        preview = "\n".join(preview_lines[:3])
        if len(preview_lines) > 3:
            preview += "\n..."

        date_groups[-1]["records"].append(
            {
                "id": row["id"],
                "store_name": row["store_name"],
                "record_date": d,
                "text_preview": preview,
                "item_count": len([it for it in items_list if it["quantity"] > 0]),
            }
        )

    return render_template("history.html", date_groups=date_groups)


# ==========================================
#  Routes — API
# ==========================================


@app.route("/api/debug")
def api_debug():
    """Show ALL records and their items — for troubleshooting."""
    db = get_db()
    records = db.execute(
        "SELECT id, store_name, record_date, created_at FROM records ORDER BY record_date DESC, created_at DESC"
    ).fetchall()
    result = []
    for r in records:
        items = db.execute(
            "SELECT category, spec, quantity FROM record_items WHERE record_id = ? ORDER BY sort_order",
            (r["id"],),
        ).fetchall()
        qty_sum = sum(it["quantity"] for it in items)
        result.append({
            "id": r["id"],
            "record_date": r["record_date"],
            "created_at": r["created_at"],
            "total_qty": qty_sum,
            "items": [dict(it) for it in items if it["quantity"] > 0],
        })
    return jsonify({"record_count": len(result), "records": result})


@app.route("/api/today")
def api_today():
    """
    Get today's latest record for auto-loading on the index page.
    Accepts ?date=YYYY-MM-DD from client to avoid server timezone mismatch.
    Returns {found: true, record_id, items: [...]} or {found: false}.
    """
    today_str = request.args.get("date", date.today().isoformat())
    db = get_db()

    row = db.execute(
        """
        SELECT id, store_name, record_date
        FROM records
        WHERE record_date = ?
        ORDER BY created_at DESC
        LIMIT 1
        """,
        (today_str,),
    ).fetchone()

    if not row:
        resp = jsonify({"found": False})
        resp.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        return resp

    items = _load_items_for_record(row["id"])

    resp = jsonify(
        {
            "found": True,
            "record_id": row["id"],
            "store_name": row["store_name"],
            "record_date": row["record_date"],
            "items": items,
        }
    )
    resp.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    return resp


def _parse_json_body():
    """
    Parse JSON request body regardless of Content-Type header.
    sendBeacon sends text/plain, not application/json, so get_json() fails.
    """
    import json as _json

    data = request.get_json(silent=True)
    if data is not None:
        return data
    # Fallback: try parsing raw body as JSON
    raw = request.get_data(as_text=True)
    if raw:
        try:
            return _json.loads(raw)
        except _json.JSONDecodeError:
            pass
    return None


@app.route("/api/submit", methods=["POST"])
def api_submit():
    """
    Submit or update a record.

    Body:
    {
        "store_name": "...",
        "record_date": "YYYY-MM-DD",
        "items": [{category, spec, quantity}, ...],
        "record_id": null | int   // if provided, UPDATE existing; else INSERT
    }
    """
    data = _parse_json_body()
    if not data:
        return jsonify({"success": False, "error": "无效的请求数据"}), 400

    store_name = data.get("store_name", DEFAULT_STORE_NAME)
    record_date_str = data.get("record_date", "")
    items_in = data.get("items", [])
    record_id = data.get("record_id")  # None → INSERT, int → UPDATE

    if not items_in:
        return jsonify({"success": False, "error": "没有提交任何数据"}), 400

    # Parse date
    try:
        record_date = datetime.strptime(record_date_str, "%Y-%m-%d").date()
    except (ValueError, TypeError):
        record_date = date.today()

    # Build quantity lookup from submitted items
    qty_map: dict[str, int] = {}
    for item in items_in:
        key = _item_key(item.get("category", ""), item.get("spec", 0))
        qty = item.get("quantity", 0)
        qty = max(0, min(999, int(qty) if qty else 0))
        qty_map[key] = qty

    db = get_db()

    # ── Multi-device: always upsert by DATE. Keep only ONE record per date ──
    same_date = db.execute(
        "SELECT id FROM records WHERE record_date = ? ORDER BY created_at DESC",
        (record_date.isoformat(),),
    ).fetchall()

    if same_date:
        # Use the latest record
        used_id = same_date[0]["id"]
        db.execute(
            "UPDATE records SET store_name = ?, record_date = ? WHERE id = ?",
            (store_name, record_date.isoformat(), used_id),
        )
        db.execute("DELETE FROM record_items WHERE record_id = ?", (used_id,))
        # Clean up duplicate records for same date (legacy data)
        for dup in same_date[1:]:
            db.execute("DELETE FROM record_items WHERE record_id = ?", (dup["id"],))
            db.execute("DELETE FROM records WHERE id = ?", (dup["id"],))
    else:
        cursor = db.execute(
            "INSERT INTO records (store_name, record_date) VALUES (?, ?)",
            (store_name, record_date.isoformat()),
        )
        used_id = cursor.lastrowid

    # Insert items in template order
    sort_idx = 0
    for cat in PRESET_TEMPLATES:
        for sp in PRESET_TEMPLATES[cat]:
            key = _item_key(cat, sp)
            qty = qty_map.get(key, 0)
            db.execute(
                """INSERT INTO record_items
                   (record_id, category, spec, quantity, sort_order)
                   VALUES (?, ?, ?, ?, ?)""",
                (used_id, cat, sp, qty, sort_idx),
            )
            sort_idx += 1

    db.commit()

    # Generate output text
    ordered_items = build_ordered_items(qty_map)
    text = generate_output_text(store_name, record_date.isoformat(), ordered_items)

    return jsonify(
        {
            "success": True,
            "text": text,
            "record_id": used_id,
            "is_update": bool(same_date),
        }
    )


@app.route("/api/history")
def api_history():
    """Get all history records as JSON (optimised batch query)."""
    db = get_db()
    records = db.execute(
        """
        SELECT id, store_name, record_date, created_at
        FROM records
        ORDER BY record_date DESC, created_at DESC
        """
    ).fetchall()

    if not records:
        return jsonify([])

    # Batch-load all items in one query
    record_ids = [r["id"] for r in records]
    placeholders = ",".join("?" for _ in record_ids)
    all_items = db.execute(
        f"""SELECT record_id, category, spec, quantity
            FROM record_items
            WHERE record_id IN ({placeholders})
            ORDER BY record_id, sort_order""",
        record_ids,
    ).fetchall()

    items_by_record: dict[int, list[dict]] = {}
    for item in all_items:
        rid = item["record_id"]
        if rid not in items_by_record:
            items_by_record[rid] = []
        items_by_record[rid].append(
            {"category": item["category"], "spec": item["spec"], "quantity": item["quantity"]}
        )

    result = []
    for row in records:
        items_list = items_by_record.get(row["id"], [])
        result.append(
            {
                "id": row["id"],
                "store_name": row["store_name"],
                "record_date": row["record_date"],
                "created_at": row["created_at"],
                "items": items_list,
                "text": generate_output_text(row["store_name"], row["record_date"], items_list),
            }
        )

    return jsonify(result)


@app.route("/api/history/<int:record_id>", methods=["GET", "PUT", "DELETE"])
def api_history_detail(record_id: int):
    """Get, update, or delete a single history record."""

    db = get_db()

    # --- GET: return detail ---
    if request.method == "GET":
        row = db.execute(
            "SELECT id, store_name, record_date, created_at FROM records WHERE id = ?",
            (record_id,),
        ).fetchone()

        if not row:
            return jsonify({"success": False, "error": "记录不存在"}), 404

        items = _load_items_for_record(record_id)

        return jsonify(
            {
                "success": True,
                "id": row["id"],
                "store_name": row["store_name"],
                "record_date": row["record_date"],
                "created_at": row["created_at"],
                "items": items,
                "text": generate_output_text(row["store_name"], row["record_date"], items),
            }
        )

    # --- DELETE: remove record and its items ---
    if request.method == "DELETE":
        row = db.execute("SELECT id FROM records WHERE id = ?", (record_id,)).fetchone()
        if not row:
            return jsonify({"success": False, "error": "记录不存在"}), 404

        db.execute("DELETE FROM record_items WHERE record_id = ?", (record_id,))
        db.execute("DELETE FROM records WHERE id = ?", (record_id,))
        db.commit()

        return jsonify({"success": True})

    # --- PUT: update record (batch edit) ---
    if request.method == "PUT":
        data = request.get_json(silent=True)
        if not data:
            return jsonify({"success": False, "error": "无效的请求数据"}), 400

        row = db.execute("SELECT id FROM records WHERE id = ?", (record_id,)).fetchone()
        if not row:
            return jsonify({"success": False, "error": "记录不存在"}), 404

        # Update store_name if provided
        if "store_name" in data:
            db.execute(
                "UPDATE records SET store_name = ? WHERE id = ?",
                (data["store_name"], record_id),
            )

        # Update record_date if provided
        if "record_date" in data:
            db.execute(
                "UPDATE records SET record_date = ? WHERE id = ?",
                (data["record_date"], record_id),
            )

        # Update items if provided
        if "items" in data:
            for item in data["items"]:
                db.execute(
                    """UPDATE record_items
                       SET quantity = ?
                       WHERE record_id = ? AND category = ? AND spec = ?""",
                    (
                        max(0, min(999, int(item.get("quantity", 0)))),
                        record_id,
                        item["category"],
                        item["spec"],
                    ),
                )

        db.commit()

        # Return updated record
        items = _load_items_for_record(record_id)
        row2 = db.execute(
            "SELECT id, store_name, record_date, created_at FROM records WHERE id = ?",
            (record_id,),
        ).fetchone()

        return jsonify(
            {
                "success": True,
                "id": row2["id"],
                "store_name": row2["store_name"],
                "record_date": row2["record_date"],
                "items": items,
                "text": generate_output_text(row2["store_name"], row2["record_date"], items),
            }
        )

    # Should not reach here
    return jsonify({"success": False, "error": "不支持的请求方法"}), 405


@app.route("/api/history/<int:record_id>/text")
def api_history_text(record_id: int):
    """Re-generate text for a specific record (for one-tap copy)."""
    db = get_db()
    row = db.execute(
        "SELECT store_name, record_date FROM records WHERE id = ?",
        (record_id,),
    ).fetchone()

    if not row:
        return jsonify({"success": False, "error": "记录不存在"}), 404

    items = _load_items_for_record(record_id)
    text = generate_output_text(row["store_name"], row["record_date"], items)

    return jsonify({"success": True, "text": text})


# ==========================================
#  CLI init-db command
# ==========================================


@app.cli.command("init-db")
def init_db_command():
    """Create database tables."""
    with app.app_context():
        init_db()
    print("Database initialized.")


# ==========================================
#  Main
# ==========================================

# ── Auto-init DB on first request (Docker-friendly) ──
_init_done = False


@app.before_request
def _auto_init():
    global _init_done
    if not _init_done:
        _init_done = True
        init_db()


if __name__ == "__main__":
    with app.app_context():
        init_db()
    app.run(debug=True, host="0.0.0.0", port=5000)
