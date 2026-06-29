import os


PRESET_TEMPLATES: dict[str, list[int]] = {
    "农家蛋": [30, 15],
    "五谷蛋": [30, 15, 10],
    "虫草蛋": [30, 15, 10],
    "小花蛋": [30, 20, 15],
    "五黑初生蛋": [20],
    "五黑彩鸡蛋": [30],
    "珍珠鸡蛋": [20],
    "初生蛋": [20],
}

DEFAULT_STORE_NAME = "鹏泰(大福店)"
APP_VERSION = os.environ.get("APP_VERSION", "v1.3.14-dev")


def init_app_config(app) -> None:
    """Configure settings that depend on the Flask app instance."""
    app.config["SECRET_KEY"] = os.environ.get("SECRET_KEY", "dev-eggnum-2026")

    db_dir = os.environ.get("EGGS_DB_DIR", app.instance_path)
    app.config["DATABASE"] = os.path.join(db_dir, "eggnum.db")
    os.makedirs(db_dir, exist_ok=True)
