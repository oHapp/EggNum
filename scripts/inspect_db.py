"""
Inspect an EggNum SQLite database for common data issues.

Examples:
  python scripts/inspect_db.py instance/eggnum.db
  python scripts/inspect_db.py /data/eggnum.db --from 2026-06-25 --to 2026-06-29
"""

from __future__ import annotations

import argparse
import os
import sqlite3
from datetime import date, timedelta


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Inspect EggNum database health.")
    parser.add_argument(
        "db",
        nargs="?",
        default=os.path.join("instance", "eggnum.db"),
        help="Path to eggnum.db. Defaults to instance/eggnum.db.",
    )
    parser.add_argument("--from", dest="date_from", help="Start date YYYY-MM-DD.")
    parser.add_argument("--to", dest="date_to", help="End date YYYY-MM-DD.")
    return parser.parse_args()


def connect(path: str) -> sqlite3.Connection:
    if not os.path.exists(path):
        raise SystemExit(f"Database not found: {path}")
    con = sqlite3.connect(path)
    con.row_factory = sqlite3.Row
    return con


def print_records(con: sqlite3.Connection, date_from: str | None, date_to: str | None) -> None:
    where = []
    params: list[str] = []
    if date_from:
        where.append("r.record_date >= ?")
        params.append(date_from)
    if date_to:
        where.append("r.record_date <= ?")
        params.append(date_to)

    sql = """
        SELECT
            r.record_date,
            COUNT(DISTINCT r.id) AS records,
            COUNT(i.id) AS item_rows,
            COALESCE(SUM(i.quantity), 0) AS total_qty,
            MIN(r.created_at) AS first_created,
            MAX(r.created_at) AS last_created
        FROM records r
        LEFT JOIN record_items i ON i.record_id = r.id
    """
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " GROUP BY r.record_date ORDER BY r.record_date"

    rows = con.execute(sql, params).fetchall()
    print("records by date:")
    if not rows:
        print("  (none)")
        return

    for row in rows:
        marker = "  "
        if row["records"] > 1:
            marker = "! "
        elif row["total_qty"] == 0:
            marker = "? "
        print(
            f"{marker}{row['record_date']} records={row['records']} "
            f"items={row['item_rows']} total={row['total_qty']} "
            f"created={row['first_created']}..{row['last_created']}"
        )


def print_missing_dates(con: sqlite3.Connection, date_from: str | None, date_to: str | None) -> None:
    if not date_from or not date_to:
        return

    existing = {
        row["record_date"]
        for row in con.execute(
            "SELECT DISTINCT record_date FROM records WHERE record_date BETWEEN ? AND ?",
            (date_from, date_to),
        )
    }
    start = date.fromisoformat(date_from)
    end = date.fromisoformat(date_to)
    missing = []
    current = start
    while current <= end:
        current_str = current.isoformat()
        if current_str not in existing:
            missing.append(current_str)
        current += timedelta(days=1)

    if missing:
        print("\nmissing record dates:")
        for value in missing:
            print(f"  {value}")


def print_attendance(con: sqlite3.Connection, date_from: str | None, date_to: str | None) -> None:
    where = []
    params: list[str] = []
    if date_from:
        where.append("record_date >= ?")
        params.append(date_from)
    if date_to:
        where.append("record_date <= ?")
        params.append(date_to)

    sql = """
        SELECT record_date, COUNT(*) AS entries, ROUND(SUM(hours), 2) AS hours
        FROM attendance
    """
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " GROUP BY record_date ORDER BY record_date"

    rows = con.execute(sql, params).fetchall()
    print("\nattendance by date:")
    if not rows:
        print("  (none)")
        return
    for row in rows:
        print(f"  {row['record_date']} entries={row['entries']} hours={row['hours']}")


def print_reserve_log(con: sqlite3.Connection, date_from: str | None, date_to: str | None) -> None:
    where = []
    params: list[str] = []
    if date_from:
        where.append("record_date >= ?")
        params.append(date_from)
    if date_to:
        where.append("record_date <= ?")
        params.append(date_to)

    sql = """
        SELECT record_date, COUNT(*) AS events, COALESCE(SUM(delta), 0) AS net
        FROM reserve_log
    """
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " GROUP BY record_date ORDER BY record_date"

    rows = con.execute(sql, params).fetchall()
    print("\nreserve log by date:")
    if not rows:
        print("  (none)")
        return
    for row in rows:
        print(f"  {row['record_date']} events={row['events']} net={row['net']}")


def main() -> None:
    args = parse_args()
    con = connect(args.db)
    print(f"database: {os.path.abspath(args.db)}")
    print_records(con, args.date_from, args.date_to)
    print_missing_dates(con, args.date_from, args.date_to)
    print_attendance(con, args.date_from, args.date_to)
    print_reserve_log(con, args.date_from, args.date_to)


if __name__ == "__main__":
    main()
