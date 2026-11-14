"""SQLite database: users, API keys and search preferences.

It is a real file (normally ./data/argus/argus.db on the host): moving Argus only takes
copying it along with the project folder. One connection per operation: SQLite is local
and operations take a few milliseconds, so no pool is needed.

The journal is the classic one (DELETE), not WAL: WAL adds two more files (-wal and -shm)
that must be copied together, and it can misbehave on a folder shared with the host (Docker
Desktop bind mount). With DELETE, once the database is stopped, the file is all there is.

The schema grows through numbered migrations: `PRAGMA user_version` tells where the file is.
"""
import sqlite3
from contextlib import contextmanager
from typing import Callable, Dict, Iterator, List

from app.config import get_settings

SCHEMA_VERSION = 2


class DatabaseError(RuntimeError):
    """The database cannot be opened or upgraded. The message says what to do."""


# Version 1: users and API keys.
_V1 = [
    """
    CREATE TABLE IF NOT EXISTS users (
        username      TEXT PRIMARY KEY,
        display_name  TEXT NOT NULL,
        email         TEXT NOT NULL,
        password_hash TEXT NOT NULL,
        disabled      INTEGER NOT NULL DEFAULT 0,
        created_at    TEXT NOT NULL,
        updated_at    TEXT NOT NULL
    )
    """,
    # The API key is encrypted (AES-256-GCM, bound to user and service): never stored in clear.
    """
    CREATE TABLE IF NOT EXISTS api_keys (
        username   TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE ON UPDATE CASCADE,
        service    TEXT NOT NULL,
        ciphertext BLOB NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (username, service)
    )
    """,
]

# Version 2: per-user two-factor flag and search preferences.
_V2 = [
    # Off by default: the user turns it on in Settings.
    "ALTER TABLE users ADD COLUMN mfa_enabled INTEGER NOT NULL DEFAULT 0",
    # One row per preference; the value is JSON. Search history is NOT stored here: it stays in the browser.
    """
    CREATE TABLE IF NOT EXISTS preferences (
        username   TEXT NOT NULL REFERENCES users(username) ON DELETE CASCADE ON UPDATE CASCADE,
        key        TEXT NOT NULL,
        value      TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (username, key)
    )
    """,
]

#: Migration steps: the key is the version reached by running them.
_MIGRATIONS: Dict[int, List[str]] = {1: _V1, 2: _V2}

_FOLDER_HINT = (
    "Check that the folder exists and that the user running the backend can write to it "
    "(with Docker: ./data/argus, see the Troubleshooting section of the README)."
)


def _connect() -> sqlite3.Connection:
    path = get_settings().db_path
    try:
        path.parent.mkdir(parents=True, exist_ok=True)
        conn = sqlite3.connect(path, timeout=10)
    except (OSError, sqlite3.OperationalError) as exc:
        raise DatabaseError(f"Cannot open the database {path}: {exc}. {_FOLDER_HINT}") from exc
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA busy_timeout = 5000")
    return conn


@contextmanager
def connection() -> Iterator[sqlite3.Connection]:
    """A connection with a transaction: commit on success, roll back on error."""
    conn = _connect()
    try:
        with conn:
            yield conn
    finally:
        conn.close()


def init_db() -> None:
    """Creates the database or brings it up to the latest version. The file is owner-only (it holds hashes and encrypted keys)."""
    path = get_settings().db_path
    existed = path.exists()
    conn = _connect()
    try:
        try:
            # Also for a file created by an earlier version that used WAL: back to a single file.
            conn.execute("PRAGMA journal_mode = DELETE")
            # BEGIN IMMEDIATE: a second process (CLI and backend together) waits instead of migrating twice.
            conn.execute("BEGIN IMMEDIATE")
            version = conn.execute("PRAGMA user_version").fetchone()[0]
            if version > SCHEMA_VERSION:
                raise DatabaseError(
                    f"The database was created by a newer Argus (schema {version}); this one knows schema {SCHEMA_VERSION}."
                )
            for target in range(version + 1, SCHEMA_VERSION + 1):
                for statement in _MIGRATIONS[target]:
                    conn.execute(statement)
                conn.execute(f"PRAGMA user_version = {target}")
            conn.commit()
        except sqlite3.OperationalError as exc:
            conn.rollback()
            raise DatabaseError(f"Cannot write to the database {path}: {exc}. {_FOLDER_HINT}") from exc
        except BaseException:
            conn.rollback()
            raise
    finally:
        conn.close()
    if not existed:
        path.chmod(0o600)
