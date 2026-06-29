from collections import OrderedDict
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


def build_history_page_groups(db, generate_text_fn):
    records = list_history_records(db)
    if not records:
        return []

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

    date_groups: list[dict] = []
    seen_dates: set[str] = set()
    for row in records:
        record_date = row["record_date"]
        if record_date not in seen_dates:
            seen_dates.add(record_date)
            date_groups.append({"date_display": record_date, "records": []})

        items_list = items_by_record.get(row["id"], [])
        full_text = generate_text_fn(row["store_name"], record_date, items_list)
        preview_lines = full_text.split("\n")
        preview = "\n".join(preview_lines[:3])
        if len(preview_lines) > 3:
            preview += "\n..."

        date_groups[-1]["records"].append(
            {
                "id": row["id"],
                "store_name": row["store_name"],
                "record_date": record_date,
                "text_preview": preview,
                "item_count": len([it for it in items_list if it["quantity"] > 0]),
            }
        )
    return date_groups


def build_history_api_records(db, generate_text_fn):
    records = list_history_records(db)
    if not records:
        return []

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
                "text": generate_text_fn(row["store_name"], row["record_date"], items_list),
            }
        )
    return result


def get_history_detail(db, record_id: int, load_items_fn, generate_text_fn):
    row = db.execute(
        "SELECT id, store_name, record_date, created_at FROM records WHERE id = ?",
        (record_id,),
    ).fetchone()
    if not row:
        return None
    items = load_items_fn(record_id)
    return {
        "id": row["id"],
        "store_name": row["store_name"],
        "record_date": row["record_date"],
        "created_at": row["created_at"],
        "items": items,
        "text": generate_text_fn(row["store_name"], row["record_date"], items),
    }


def update_history_record(db, record_id: int, data: dict, load_items_fn, generate_text_fn):
    row = db.execute("SELECT id FROM records WHERE id = ?", (record_id,)).fetchone()
    if not row:
        return None, 404

    if "store_name" in data:
        db.execute(
            "UPDATE records SET store_name = ? WHERE id = ?",
            (data["store_name"], record_id),
        )

    if "record_date" in data:
        db.execute(
            "UPDATE records SET record_date = ? WHERE id = ?",
            (data["record_date"], record_id),
        )

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
    items = load_items_fn(record_id)
    row2 = db.execute(
        "SELECT id, store_name, record_date, created_at FROM records WHERE id = ?",
        (record_id,),
    ).fetchone()
    return {
        "success": True,
        "id": row2["id"],
        "store_name": row2["store_name"],
        "record_date": row2["record_date"],
        "items": items,
        "text": generate_text_fn(row2["store_name"], row2["record_date"], items),
    }, 200


def delete_history_record(db, record_id: int) -> bool:
    row = db.execute("SELECT id FROM records WHERE id = ?", (record_id,)).fetchone()
    if not row:
        return False
    db.execute("DELETE FROM record_items WHERE record_id = ?", (record_id,))
    db.execute("DELETE FROM records WHERE id = ?", (record_id,))
    db.commit()
    return True


def reserve_history_groups(db):
    rows = db.execute(
        """SELECT record_date, category, spec, delta, linked, created_at
           FROM reserve_log ORDER BY record_date DESC, created_at DESC"""
    ).fetchall()

    groups = OrderedDict()
    for r in rows:
        d = r["record_date"]
        if d not in groups:
            groups[d] = {"date": d, "items": [], "total_delta": 0}
        groups[d]["items"].append({
            "category": r["category"],
            "spec": r["spec"],
            "delta": r["delta"],
            "created_at": r["created_at"],
            "linked": bool(r["linked"]) if "linked" in r.keys() else True,
        })
        groups[d]["total_delta"] += r["delta"]
    return list(groups.values())


def delete_reserve_history(db, dates: list[str] | None = None):
    if dates:
        placeholders = ",".join("?" for _ in dates)
        db.execute(
            f"DELETE FROM reserve_log WHERE record_date IN ({placeholders})",
            dates,
        )
    else:
        db.execute("DELETE FROM reserve_log")
    db.commit()


def log_reserve_event(db, data: dict, today_fn=date.today):
    try:
        db.execute("ALTER TABLE reserve_log ADD COLUMN linked INTEGER DEFAULT 1")
    except Exception:
        pass
    db.execute(
        "INSERT INTO reserve_log (record_date, category, spec, delta, linked) VALUES (?,?,?,?,?)",
        (
            data.get("record_date", today_fn().isoformat()),
            data.get("category", "__link__"),
            data.get("spec", 0),
            data.get("delta", 0),
            1,
        ),
    )
    db.commit()


def debug_records(db):
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
    return {"record_count": len(result), "records": result}


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
