import sqlite3

from flask import g


def get_db(app) -> sqlite3.Connection:
    """Get a database connection for the current request."""
    if "db" not in g:
        g.db = sqlite3.connect(app.config["DATABASE"])
        g.db.row_factory = sqlite3.Row
        g.db.execute("PRAGMA journal_mode=WAL")
        g.db.execute("PRAGMA foreign_keys=ON")
    return g.db


def close_db(exception: object) -> None:
    """Close the database connection at the end of a request."""
    db = g.pop("db", None)
    if db is not None:
        db.close()


def _merge_duplicate_record_dates(db: sqlite3.Connection) -> None:
    """Merge old duplicate record dates into the newest row."""
    duplicate_dates = db.execute(
        """
        SELECT record_date
        FROM records
        GROUP BY record_date
        HAVING COUNT(*) > 1
        """
    ).fetchall()

    for date_row in duplicate_dates:
        rows = db.execute(
            """
            SELECT id
            FROM records
            WHERE record_date = ?
            ORDER BY created_at DESC, id DESC
            """,
            (date_row["record_date"],),
        ).fetchall()
        if len(rows) <= 1:
            continue

        keep_id = rows[0]["id"]
        for dup in rows[1:]:
            dup_items = db.execute(
                """
                SELECT category, spec, quantity, sort_order
                FROM record_items
                WHERE record_id = ?
                ORDER BY sort_order
                """,
                (dup["id"],),
            ).fetchall()

            for item in dup_items:
                if item["quantity"] <= 0:
                    continue
                existing = db.execute(
                    """
                    SELECT id, quantity
                    FROM record_items
                    WHERE record_id = ? AND category = ? AND spec = ?
                    """,
                    (keep_id, item["category"], item["spec"]),
                ).fetchone()
                if existing:
                    if existing["quantity"] == 0:
                        db.execute(
                            "UPDATE record_items SET quantity = ? WHERE id = ?",
                            (item["quantity"], existing["id"]),
                        )
                else:
                    db.execute(
                        """
                        INSERT INTO record_items
                            (record_id, category, spec, quantity, sort_order)
                        VALUES (?, ?, ?, ?, ?)
                        """,
                        (
                            keep_id,
                            item["category"],
                            item["spec"],
                            item["quantity"],
                            item["sort_order"],
                        ),
                    )

            db.execute("DELETE FROM record_items WHERE record_id = ?", (dup["id"],))
            db.execute("DELETE FROM records WHERE id = ?", (dup["id"],))


def init_db(app) -> None:
    """Create tables if they don't exist."""
    db = get_db(app)
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

        CREATE TABLE IF NOT EXISTS reserve_items (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            category    TEXT NOT NULL,
            spec        INTEGER NOT NULL,
            quantity    INTEGER NOT NULL DEFAULT 0,
            updated_at  DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(category, spec)
        );

        CREATE TABLE IF NOT EXISTS reserve_log (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            record_date DATE NOT NULL,
            category    TEXT NOT NULL,
            spec        INTEGER NOT NULL,
            delta       INTEGER NOT NULL,
            linked      INTEGER NOT NULL DEFAULT 1,
            created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_reserve_log_date
            ON reserve_log(record_date);

        CREATE TABLE IF NOT EXISTS attendance (
            id          INTEGER PRIMARY KEY AUTOINCREMENT,
            record_date DATE NOT NULL,
            time_start  TEXT NOT NULL,
            time_end    TEXT NOT NULL,
            hours       REAL NOT NULL DEFAULT 0,
            note        TEXT DEFAULT '',
            created_at  DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE INDEX IF NOT EXISTS idx_attendance_date
            ON attendance(record_date);
    """)
    try:
        db.execute("ALTER TABLE reserve_log ADD COLUMN linked INTEGER DEFAULT 1")
    except Exception:
        pass
    _merge_duplicate_record_dates(db)
    db.execute(
        "CREATE UNIQUE INDEX IF NOT EXISTS idx_records_record_date_unique ON records(record_date)"
    )
    db.commit()
