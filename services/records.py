from datetime import date


def generate_output_text(store_name: str, record_date_str: str, items: list[dict]) -> str:
    lines = [f"{store_name} {record_date_str}"]
    for item in items:
        category = item["category"]
        spec = item["spec"]
        qty = item.get("quantity", 0)
        qty_str = str(qty) if qty > 0 else ""
        lines.append(f"{category}{spec}枚:{qty_str}")
    return "\n".join(lines)


def _item_key(category: str, spec: int) -> str:
    return f"{category}_{spec}"


def build_ordered_items(templates: dict[str, list[int]], quantities_by_key: dict[str, int] | None = None) -> list[dict]:
    result = []
    for cat in templates:
        for sp in templates[cat]:
            key = f"{cat}_{sp}"
            qty = quantities_by_key.get(key, 0) if quantities_by_key else 0
            result.append({"category": cat, "spec": sp, "quantity": qty})
    return result


def load_today_record(db, today_str: str):
    return db.execute(
        """
        SELECT id, store_name, record_date
        FROM records
        WHERE record_date = ?
        ORDER BY created_at DESC
        LIMIT 1
        """,
        (today_str,),
    ).fetchone()


def load_record_items(db, record_id: int):
    rows = db.execute(
        """SELECT category, spec, quantity
           FROM record_items
           WHERE record_id = ?
           ORDER BY sort_order""",
        (record_id,),
    ).fetchall()
    return [dict(r) for r in rows]


def list_history_records(db):
    return db.execute(
        """
        SELECT id, store_name, record_date, created_at
        FROM records
        ORDER BY record_date DESC, created_at DESC
        """
    ).fetchall()


def upsert_record(db, templates: dict[str, list[int]], record_date, store_name: str, items_in: list[dict], record_id=None, merge_mode=False):
    qty_map: dict[str, int] = {}
    for item in items_in:
        key = _item_key(item.get("category", ""), item.get("spec", 0))
        qty = item.get("quantity", 0)
        qty = max(0, min(999, int(qty) if qty else 0))
        qty_map[key] = qty

    target_date = record_date.isoformat()

    requested_record_id = None
    try:
        requested_record_id = int(record_id) if record_id else None
    except (TypeError, ValueError):
        requested_record_id = None

    if requested_record_id:
        existing_record = db.execute(
            "SELECT id, record_date FROM records WHERE id = ?",
            (requested_record_id,),
        ).fetchone()
        if existing_record and existing_record["record_date"] != target_date:
            if merge_mode:
                return {"success": False, "error": "记录日期已切换，请刷新后重新保存"}, 409
            requested_record_id = None

    same_date = db.execute(
        "SELECT id FROM records WHERE record_date = ? ORDER BY created_at DESC, id DESC",
        (target_date,),
    ).fetchall()

    if merge_mode and not same_date:
        return {"success": False, "error": "当前日期还没有记录，不能增量保存"}, 409

    if same_date:
        used_id = same_date[0]["id"]
        db.execute(
            "UPDATE records SET store_name = ?, record_date = ? WHERE id = ?",
            (store_name, target_date, used_id),
        )
        if not merge_mode:
            db.execute("DELETE FROM record_items WHERE record_id = ?", (used_id,))
        for dup in same_date[1:]:
            db.execute("DELETE FROM record_items WHERE record_id = ?", (dup["id"],))
            db.execute("DELETE FROM records WHERE id = ?", (dup["id"],))
    else:
        cursor = db.execute(
            "INSERT INTO records (store_name, record_date) VALUES (?, ?)",
            (store_name, target_date),
        )
        used_id = cursor.lastrowid

    if merge_mode and same_date:
        for item in items_in:
            cat = item.get("category", "")
            sp = item.get("spec", 0)
            qty = max(0, min(999, int(item.get("quantity", 0))))
            existing_item = db.execute(
                "SELECT id FROM record_items WHERE record_id = ? AND category = ? AND spec = ?",
                (used_id, cat, sp),
            ).fetchone()
            if existing_item:
                db.execute(
                    "UPDATE record_items SET quantity = ? WHERE id = ?",
                    (qty, existing_item["id"]),
                )
            else:
                max_sort = db.execute(
                    "SELECT COALESCE(MAX(sort_order), -1) FROM record_items WHERE record_id = ?",
                    (used_id,),
                ).fetchone()[0]
                db.execute(
                    "INSERT INTO record_items (record_id, category, spec, quantity, sort_order) VALUES (?, ?, ?, ?, ?)",
                    (used_id, cat, sp, qty, max_sort + 1),
                )
    else:
        sort_idx = 0
        for cat in templates:
            for sp in templates[cat]:
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
    ordered_items = build_ordered_items(templates, qty_map)
    text = generate_output_text(store_name, target_date, ordered_items)
    return {
        "success": True,
        "text": text,
        "record_id": used_id,
        "is_update": bool(same_date),
        "target_date": target_date,
        "ordered_items": ordered_items,
    }, 200


def reserve_api_update(db, data: dict, today_fn=date.today):
    category = data.get("category", "")
    spec = data.get("spec", 0)
    delta = data.get("delta", 0)
    report_date = data.get("date", None)

    if delta == 0:
        return {"success": False, "error": "delta 不能为 0"}, 400

    try:
        db.execute("ALTER TABLE reserve_log ADD COLUMN linked INTEGER DEFAULT 1")
    except Exception:
        pass

    existing = db.execute(
        "SELECT id, quantity FROM reserve_items WHERE category = ? AND spec = ?",
        (category, spec),
    ).fetchone()

    if existing:
        new_qty = existing["quantity"] + delta
        if new_qty < 0:
            return {"success": False, "error": "留存不足"}, 400
        db.execute(
            "UPDATE reserve_items SET quantity = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
            (new_qty, existing["id"]),
        )
    else:
        if delta < 0:
            return {"success": False, "error": "留存不足"}, 400
        new_qty = delta
        db.execute(
            "INSERT INTO reserve_items (category, spec, quantity) VALUES (?, ?, ?)",
            (category, spec, delta),
        )

    if report_date:
        report_row = db.execute(
            "SELECT id FROM records WHERE record_date = ? ORDER BY created_at DESC LIMIT 1",
            (report_date,),
        ).fetchone()
        if report_row:
            item_row = db.execute(
                "SELECT id, quantity FROM record_items WHERE record_id = ? AND category = ? AND spec = ?",
                (report_row["id"], category, spec),
            ).fetchone()
            if item_row:
                new_report_qty = item_row["quantity"] - delta
                if new_report_qty < 0:
                    new_report_qty = 0
                db.execute(
                    "UPDATE record_items SET quantity = ? WHERE id = ?",
                    (new_report_qty, item_row["id"]),
                )

    log_date = report_date if report_date else today_fn().isoformat()
    linked = 1 if report_date else 0
    db.execute(
        "INSERT INTO reserve_log (record_date, category, spec, delta, linked) VALUES (?, ?, ?, ?, ?)",
        (log_date, category, spec, delta, linked),
    )
    db.commit()
    return {"success": True, "quantity": new_qty}, 200
