from collections import OrderedDict


def list_entries(db, days: int | None = None, date_from: str | None = None, date_to: str | None = None):
    """List attendance rows using the same filters as the public API."""
    if date_from and date_to:
        return db.execute(
            "SELECT * FROM attendance WHERE record_date BETWEEN ? AND ? ORDER BY record_date DESC, time_start",
            (date_from, date_to),
        ).fetchall()
    if days:
        return db.execute(
            "SELECT * FROM attendance WHERE record_date >= date('now', ?) ORDER BY record_date DESC, time_start",
            (f"-{days} days",),
        ).fetchall()
    return db.execute(
        "SELECT * FROM attendance ORDER BY record_date DESC, time_start"
    ).fetchall()


def create_entry(db, data: dict) -> int:
    """Create one attendance entry and return its id."""
    record_date = data.get("record_date")
    time_start = data.get("time_start", "")
    time_end = data.get("time_end", "")
    hours = float(data.get("hours", 0))
    note = data.get("note", "")

    cursor = db.execute(
        """INSERT INTO attendance (record_date, time_start, time_end, hours, note)
           VALUES (?, ?, ?, ?, ?)""",
        (record_date, time_start, time_end, hours, note),
    )
    db.commit()
    return cursor.lastrowid


def entry_exists(db, entry_id: int) -> bool:
    row = db.execute("SELECT id FROM attendance WHERE id = ?", (entry_id,)).fetchone()
    return row is not None


def delete_entry(db, entry_id: int) -> None:
    db.execute("DELETE FROM attendance WHERE id = ?", (entry_id,))
    db.commit()


def update_entry(db, entry_id: int, data: dict) -> bool:
    """Update allowed attendance fields. Returns False when no fields changed."""
    updates = []
    params = []
    for field in ["record_date", "time_start", "time_end", "hours", "note"]:
        if field in data:
            updates.append(f"{field} = ?")
            value = data[field]
            if field == "hours":
                value = float(value)
            params.append(value)

    if not updates:
        return False

    params.append(entry_id)
    db.execute(f"UPDATE attendance SET {', '.join(updates)} WHERE id = ?", params)
    db.commit()
    return True


def history_groups(db) -> list[dict]:
    rows = db.execute(
        "SELECT * FROM attendance ORDER BY record_date DESC, time_start"
    ).fetchall()
    entries = [dict(row) for row in rows]

    groups = OrderedDict()
    for entry in entries:
        record_date = entry["record_date"]
        if record_date not in groups:
            groups[record_date] = {"entries": [], "total": 0}
        groups[record_date]["entries"].append(entry)
        groups[record_date]["total"] += entry["hours"]

    return [
        {
            "date": record_date,
            "total": round(group["total"], 2),
            "entries": group["entries"],
        }
        for record_date, group in groups.items()
    ]


def export_rows(db, date_from: str, date_to: str):
    return db.execute(
        """SELECT * FROM attendance
           WHERE record_date BETWEEN ? AND ?
           ORDER BY record_date, time_start""",
        (date_from, date_to),
    ).fetchall()
