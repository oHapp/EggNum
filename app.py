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

from datetime import date, datetime

from flask import Flask, jsonify, render_template, request

from config import APP_VERSION, DEFAULT_STORE_NAME, PRESET_TEMPLATES, init_app_config
from db import close_db, get_db as _get_db, init_db as _init_db
from services.attendance import (
    create_entry as create_attendance_entry,
    delete_entry as delete_attendance_entry,
    entry_exists as attendance_entry_exists,
    export_rows as attendance_export_rows,
    history_groups as attendance_history_groups,
    list_entries as list_attendance_entries,
    update_entry as update_attendance_entry,
)
from services.records import (
    build_ordered_items as build_ordered_items_service,
    build_history_api_records,
    build_history_page_groups,
    debug_records,
    delete_history_record,
    delete_reserve_history,
    generate_output_text as generate_output_text_service,
    get_history_detail,
    load_record_items as load_record_items_service,
    load_today_record as load_today_record_service,
    log_reserve_event,
    reserve_api_update as reserve_api_update_service,
    reserve_history_groups,
    update_history_record,
    upsert_record as upsert_record_service,
)

# ==========================================
#  App factory
# ==========================================

app = Flask(__name__)
init_app_config(app)


# Inject app version into all templates (for footer + SW cache busting)
@app.context_processor
def inject_app_version():
    return {"app_version": APP_VERSION}


# ==========================================
#  Helpers: build flat item list in template order
# ==========================================

def build_ordered_items(
    quantities_by_key: dict[str, int] | None = None,
) -> list[dict]:
    return build_ordered_items_service(PRESET_TEMPLATES, quantities_by_key)


def _item_key(category: str, spec: int) -> str:
    return f"{category}_{spec}"


# ==========================================
#  Database helpers
# ==========================================


def get_db():
    return _get_db(app)


@app.teardown_appcontext
def _close_db(exception: object) -> None:
    close_db(exception)


def init_db() -> None:
    _init_db(app)


# ==========================================
#  Text generation (core logic)
# ==========================================


def generate_output_text(
    store_name: str,
    record_date_str: str,
    items: list[dict],
) -> str:
    return generate_output_text_service(store_name, record_date_str, items)


def format_date_cn(d: date) -> str:
    """Convert a date object to Chinese format like '6月4日'."""
    return f"{d.month}月{d.day}日"



def _load_items_for_record(record_id: int) -> list[dict]:
    db = get_db()
    return load_record_items_service(db, record_id)


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
    return render_template(
        "history.html",
        date_groups=build_history_page_groups(db, generate_output_text),
    )


# ==========================================
#  Routes — API
# ==========================================


# ── Reserve (库存留存) ──


@app.route("/api/reserve")
def api_reserve():
    """Get all reserve quantities (cumulative, cross-day)."""
    db = get_db()
    rows = db.execute(
        "SELECT category, spec, quantity FROM reserve_items ORDER BY category, spec"
    ).fetchall()
    items = [dict(r) for r in rows]
    return jsonify({"items": items})


@app.route("/api/reserve", methods=["POST"])
def api_reserve_update():
    """
    Update reserve quantity for a single spec and sync with today's report.

    Body: { category, spec, delta }
    - delta > 0: increase reserve, decrease today's report
    - delta < 0: decrease reserve, increase today's report
    """
    data = _parse_json_body()
    if not data:
        return jsonify({"success": False, "error": "无效数据"}), 400

    db = get_db()
    data_result, status = reserve_api_update_service(db, data, date.today)
    return jsonify(data_result), status


# ── Attendance (考勤打卡) ──


@app.route("/api/attendance")
def api_attendance_list():
    """List attendance entries. Query: ?days=3 (default 3 days) or ?from=&to="""
    db = get_db()
    days = request.args.get("days", type=int)
    date_from = request.args.get("from")
    date_to = request.args.get("to")
    rows = list_attendance_entries(db, days=days, date_from=date_from, date_to=date_to)
    return jsonify({"entries": [dict(r) for r in rows]})


@app.route("/api/attendance", methods=["POST"])
def api_attendance_create():
    """Create an attendance entry. Body: {record_date, time_start, time_end, hours, note}"""
    data = _parse_json_body()
    if not data:
        return jsonify({"success": False, "error": "无效数据"}), 400

    record_date = data.get("record_date", date.today().isoformat())
    time_start = data.get("time_start", "")
    time_end = data.get("time_end", "")
    hours = float(data.get("hours", 0))
    note = data.get("note", "")

    if not time_start or not time_end:
        return jsonify({"success": False, "error": "请选择时间"}), 400

    db = get_db()
    entry_id = create_attendance_entry(db, {
        "record_date": record_date,
        "time_start": time_start,
        "time_end": time_end,
        "hours": hours,
        "note": note,
    })
    return jsonify({"success": True, "id": entry_id})


@app.route("/api/attendance/<int:entry_id>", methods=["PUT", "DELETE"])
def api_attendance_modify(entry_id: int):
    """Update or delete an attendance entry."""
    db = get_db()
    if not attendance_entry_exists(db, entry_id):
        return jsonify({"success": False, "error": "记录不存在"}), 404

    if request.method == "DELETE":
        delete_attendance_entry(db, entry_id)
        return jsonify({"success": True})

    # PUT: update
    data = _parse_json_body()
    if not data:
        return jsonify({"success": False, "error": "无效数据"}), 400

    if not update_attendance_entry(db, entry_id, data):
        return jsonify({"success": False, "error": "无更新字段"}), 400

    return jsonify({"success": True})


@app.route("/attendance-history")
def attendance_history_page():
    """Full attendance history page."""
    return render_template("attendance_history.html")


@app.route("/api/attendance-history")
def api_attendance_history():
    """Get all attendance entries for the full history page."""
    db = get_db()
    return jsonify({"groups": attendance_history_groups(db)})


@app.route("/api/attendance/export")
def api_attendance_export():
    """Generate Excel report matching the template format."""
    import io as _io, os as _os

    try:
        import openpyxl as _xl
        from openpyxl.styles import Font, Alignment, Border, Side
    except ImportError:
        return jsonify({"success": False, "error": "openpyxl 未安装"}), 500

    date_from = request.args.get("from", "")
    date_to = request.args.get("to", "")

    if not date_from or not date_to:
        return jsonify({"success": False, "error": "请指定起止日期"}), 400

    db = get_db()
    rows = attendance_export_rows(db, date_from, date_to)

    # Load template (preserve all formatting — just clear values)
    template_path = _os.path.join(_os.path.dirname(__file__), "考勤报表_2026_03_28_to_04_30.xlsx")
    has_template = _os.path.exists(template_path)

    if has_template:
        wb = _xl.load_workbook(template_path)
        ws = wb.active
        # Only clear values in data rows (2 to max_row), keep formatting
        for row in ws.iter_rows(min_row=2, max_row=ws.max_row):
            for cell in row:
                cell.value = None
    else:
        wb = _xl.Workbook()
        ws = wb.active
        ws.title = "考勤报表"
        for i, h in enumerate(["日期", "时间段", "时长", "备注"], 1):
            c = ws.cell(row=1, column=i, value=h)
            c.font = Font(bold=True, size=11)
        ws.column_dimensions["A"].width = 14
        ws.column_dimensions["B"].width = 36
        ws.column_dimensions["C"].width = 8
        ws.column_dimensions["D"].width = 14

    # Group by date
    from collections import defaultdict
    groups: dict[str, list] = defaultdict(list)
    for r in rows:
        groups[r["record_date"]].append(r)

    # Fill data — only set values, don't touch formatting
    row_idx = 2
    total_hours = 0.0

    for d in sorted(groups.keys()):
        seg_count = len(groups[d])
        time_ranges = ", ".join(f"{r['time_start']}-{r['time_end']}" for r in groups[d])
        day_hours = sum(r["hours"] for r in groups[d])
        notes = "、".join(r["note"] for r in groups[d] if r["note"])
        total_hours += day_hours

        c_date = ws.cell(row=row_idx, column=1); c_date.value = d
        c_time = ws.cell(row=row_idx, column=2); c_time.value = time_ranges
        c_hours = ws.cell(row=row_idx, column=3); c_hours.value = day_hours
        c_note = ws.cell(row=row_idx, column=4); c_note.value = notes

        # Alignment: date + hours = vertical center; time range = top + wrap
        v_center = Alignment(vertical="center")
        top_wrap = Alignment(vertical="top", wrap_text=True)
        c_date.alignment = v_center
        c_time.alignment = top_wrap
        c_hours.alignment = v_center
        c_note.alignment = v_center

        # Multi-segment: increase row height
        if seg_count > 1:
            ws.row_dimensions[row_idx].height = 15 * seg_count

        row_idx += 1

    # Total row — only if not using template (template already has formatted total row)
    # Write value into the last data+1 row, keeping any existing formatting
    total_cell_date = ws.cell(row=row_idx, column=1)
    total_cell_hours = ws.cell(row=row_idx, column=3)
    total_cell_date.value = "合计"
    total_cell_hours.value = round(total_hours, 2)

    # If no template, bold the total row
    if not has_template:
        total_cell_date.font = Font(bold=True, size=11)
        total_cell_hours.font = Font(bold=True, size=11)

    buf = _io.BytesIO()
    wb.save(buf)
    buf.seek(0)

    from flask import send_file

    filename = f"考勤报表_{date_from}_to_{date_to}.xlsx"
    return send_file(
        buf,
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        as_attachment=True,
        download_name=filename,
    )


@app.route("/reserve-history")
def reserve_history_page():
    """扣留历史记录页面"""
    return render_template("reserve_history.html")


@app.route("/api/reserve-history", methods=["GET", "DELETE"])
def api_reserve_history():
    """Get or clear reserve change log."""
    db = get_db()

    if request.method == "DELETE":
        dates = request.args.get("dates", "")
        if dates:
            date_list = [d.strip() for d in dates.split(",") if d.strip()]
            delete_reserve_history(db, date_list)
        else:
            delete_reserve_history(db)
        return jsonify({"success": True})

    return jsonify({"groups": reserve_history_groups(db)})


@app.route("/api/reserve/log-event", methods=["POST"])
def api_reserve_log_event():
    """Log a system event (linkage toggle) to reserve_log."""
    data = _parse_json_body()
    if not data: return jsonify({"success": False}), 400
    db = get_db()
    log_reserve_event(db, data, date.today)
    return jsonify({"success": True})


@app.route("/api/debug")
def api_debug():
    """Show ALL records and their items — for troubleshooting."""
    db = get_db()
    return jsonify(debug_records(db))


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
    if not data.get("items", []):
        return jsonify({"success": False, "error": "没有提交任何数据"}), 400

    db = get_db()
    record_date_str = data.get("record_date", "")
    try:
        record_date = datetime.strptime(record_date_str, "%Y-%m-%d").date()
    except (ValueError, TypeError):
        record_date = date.today()
    result, status = upsert_record_service(
        db,
        PRESET_TEMPLATES,
        record_date,
        data.get("store_name", DEFAULT_STORE_NAME),
        data.get("items", []),
        record_id=data.get("record_id"),
        merge_mode=data.get("merge", False),
    )
    return jsonify(result), status


@app.route("/api/history")
def api_history():
    """Get all history records as JSON (optimised batch query)."""
    db = get_db()
    return jsonify(build_history_api_records(db, generate_output_text))


@app.route("/api/history/<int:record_id>", methods=["GET", "PUT", "DELETE"])
def api_history_detail(record_id: int):
    """Get, update, or delete a single history record."""

    db = get_db()

    # --- GET: return detail ---
    if request.method == "GET":
        detail = get_history_detail(db, record_id, _load_items_for_record, generate_output_text)
        if not detail:
            return jsonify({"success": False, "error": "记录不存在"}), 404
        return jsonify({"success": True, **detail})

    # --- DELETE: remove record and its items ---
    if request.method == "DELETE":
        if not delete_history_record(db, record_id):
            return jsonify({"success": False, "error": "记录不存在"}), 404
        return jsonify({"success": True})

    # --- PUT: update record (batch edit) ---
    if request.method == "PUT":
        data = request.get_json(silent=True)
        if not data:
            return jsonify({"success": False, "error": "无效的请求数据"}), 400
        updated, status = update_history_record(db, record_id, data, _load_items_for_record, generate_output_text)
        if not updated:
            return jsonify({"success": False, "error": "记录不存在"}), status
        return jsonify(updated)

    # Should not reach here
    return jsonify({"success": False, "error": "不支持的请求方法"}), 405


@app.route("/api/history/<int:record_id>/text")
def api_history_text(record_id: int):
    """Re-generate text for a specific record (for one-tap copy)."""
    db = get_db()
    detail = get_history_detail(db, record_id, _load_items_for_record, generate_output_text)
    if not detail:
        return jsonify({"success": False, "error": "记录不存在"}), 404

    return jsonify({"success": True, "text": detail["text"]})


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
