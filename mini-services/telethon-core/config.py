import os
import sqlite3
from dataclasses import dataclass
from typing import Dict, Optional

@dataclass(frozen=True)
class Settings:
    api_id: int
    api_hash: str
    bot_token: str
    session_path: str
    storage_chat_id: int
    internal_key: str
    max_concurrent_uploads: int
    max_upload_bytes: int
    port: int

def find_sqlite_path() -> Optional[str]:
    db_url = os.getenv("DATABASE_URL", "")
    if db_url:
        path = db_url.replace("file:", "").split("?")[0]
        if os.path.isfile(path):
            return path

    r_path = os.getenv("REALTIME_DB_PATH", "")
    if r_path and os.path.isfile(r_path):
        return r_path

    candidates = [
        "/app/db/custom.db",
        os.path.abspath(os.path.join(os.path.dirname(__file__), "../../db/custom.db")),
        os.path.abspath(os.path.join(os.path.dirname(__file__), "../db/custom.db")),
        os.path.abspath(os.path.join(os.getcwd(), "db/custom.db")),
        os.path.abspath(os.path.join(os.getcwd(), "../db/custom.db")),
        os.path.abspath(os.path.join(os.getcwd(), "custom.db")),
    ]
    for c in candidates:
        if os.path.isfile(c):
            return c
    return None

def load_settings_from_db() -> Dict[str, str]:
    db_path = find_sqlite_path()
    if not db_path:
        return {}
    try:
        conn = sqlite3.connect(db_path, timeout=5.0)
        cursor = conn.cursor()
        cursor.execute("SELECT key, value FROM Setting")
        rows = cursor.fetchall()
        conn.close()
        return {r[0]: str(r[1]) for r in rows if r[0] and r[1] is not None}
    except Exception as e:
        print(f"[telethon-core] Warning: Could not read Setting table from {db_path}: {e}")
        return {}

def get_settings() -> Settings:
    db_settings = load_settings_from_db()

    # Telegram API ID (defaults to Telegram Web official API ID if unset or 0)
    DEFAULT_API_ID = 2496
    DEFAULT_API_HASH = "8c0481c4a212e0850d3a163d6026d6e3"

    api_id_raw = os.getenv(
        "TELETHON_API_ID",
        os.getenv("TELETHON_API_ID", db_settings.get("tgApiId", ""))
    ).strip()
    try:
        api_id = int(api_id_raw) if api_id_raw and api_id_raw != "0" else DEFAULT_API_ID
    except ValueError as exc:
        raise ValueError("TELETHON_API_ID must be an integer") from exc
    if api_id <= 0:
        raise ValueError("TELETHON_API_ID must be a positive integer")

    # Telegram API Hash
    api_hash = os.getenv(
        "TELETHON_API_HASH",
        os.getenv("TELETHON_API_HASH", db_settings.get("tgApiHash", ""))
    ).strip()
    if not api_hash:
        api_hash = DEFAULT_API_HASH

    # Bot Token
    bot_token = os.getenv(
        "TELETHON_BOT_TOKEN",
        os.getenv("TELETHON_BOT_TOKEN", db_settings.get("tgBotToken", ""))
    ).strip()

    # Storage Chat ID
    chat_id_raw = os.getenv(
        "TELETHON_STORAGE_CHAT_ID",
        os.getenv("TELETHON_STORAGE_CHAT_ID", db_settings.get("tgStorageChatId", "0"))
    ).strip()
    try:
        storage_chat_id = int(chat_id_raw)
    except ValueError:
        storage_chat_id = 0

    # Session Path
    session_path = os.getenv("TELETHON_SESSION_PATH", "").strip()
    if not session_path:
        if os.path.isdir("/app/db"):
            session_path = "/app/db/telethon.session"
        else:
            db_path = find_sqlite_path()
            if db_path:
                session_path = os.path.join(os.path.dirname(db_path), "telethon.session")
            else:
                session_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "../../db/telethon.session"))

    internal_key = os.getenv("TELETHON_INTERNAL_KEY", "vs-telethon-internal-key").strip()

    try:
        max_concurrent_uploads = int(os.getenv("TELETHON_MAX_CONCURRENT_UPLOADS", "1"))
    except ValueError:
        max_concurrent_uploads = 1

    # 2 GiB = 2,147,483,648 bytes (MTProto file limit)
    try:
        db_max_str = db_settings.get("maxFileSize", "2147483648")
        db_max = int(db_max_str) if str(db_max_str).isdigit() else 2_147_483_648
        if db_max <= 2_000_000_000:
            db_max = 2_147_483_648
        max_upload_bytes = int(os.getenv("MAX_UPLOAD_BYTES", str(db_max)))
    except ValueError:
        max_upload_bytes = 2_147_483_648

    try:
        port = int(os.getenv("TELETHON_PORT", os.getenv("TELETHON_CORE_PORT", "3005")))
    except ValueError:
        port = 3005

    return Settings(
        api_id=api_id,
        api_hash=api_hash,
        bot_token=bot_token,
        session_path=session_path,
        storage_chat_id=storage_chat_id,
        internal_key=internal_key,
        max_concurrent_uploads=max_concurrent_uploads,
        max_upload_bytes=max_upload_bytes,
        port=port,
    )
