"""Users, API keys and search preferences in the SQLite database.

Everything about accounts lives here: the backend keeps nothing else.
Authelia does not read this database: for sign-in it gets a users file generated
from here (`write_authelia_users`), rewritten on every change to the users.
"""
import json
import os
import re
import sqlite3
import tempfile
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Dict, List, Optional, Tuple

from app.accounts import security
from app.accounts.db import connection
from app.config import get_settings

#: Services that accept an API key, with the same ids the frontend uses.
SERVICES = ("abuseipdb", "proxycheck", "virustotal")

#: Accepted key format: 8-256 characters among letters, digits and . _ ~ + / = -
KEY_PATTERN = re.compile(r"[A-Za-z0-9._~+/=-]{8,256}")

#: User name: lowercase letters, digits, dot, hyphen and underscore, 3-32 characters.
USERNAME_PATTERN = re.compile(r"[a-z0-9][a-z0-9._-]{2,31}")

_EMAIL_PATTERN = re.compile(r"[^@\s]+@[^@\s]+\.[^@\s]+")


class StoreError(ValueError):
    """Invalid request (existing user, weak password, wrong format...). The message can be shown."""


class WrongPassword(StoreError):
    """The current password given to change it is wrong."""


@dataclass(frozen=True)
class User:
    username: str
    display_name: str
    email: str
    disabled: bool = False
    #: second factor required for this user (the user chooses it in Settings)
    mfa_enabled: bool = False


def _now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _user(row: sqlite3.Row) -> User:
    return User(row["username"], row["display_name"], row["email"], bool(row["disabled"]), bool(row["mfa_enabled"]))


def normalize_username(raw: str) -> str:
    username = raw.strip().lower()
    if not USERNAME_PATTERN.fullmatch(username):
        raise StoreError("The username must have 3 to 32 characters: lowercase letters, digits, dot, dash and underscore, starting with a letter or digit.")
    return username


def get_user(username: str) -> Optional[User]:
    with connection() as db:
        row = db.execute("SELECT * FROM users WHERE username = ?", (username.strip().lower(),)).fetchone()
    return _user(row) if row else None


def list_users() -> List[User]:
    with connection() as db:
        rows = db.execute("SELECT * FROM users ORDER BY username").fetchall()
    return [_user(r) for r in rows]


def create_user(username: str, password: str, display_name: str = "", email: str = "") -> User:
    username = normalize_username(username)
    problem = security.check_password_policy(password, username)
    if problem:
        raise StoreError(problem)
    display_name = display_name.strip() or username
    email = email.strip() or f"{username}@argus.local"
    if not _EMAIL_PATTERN.fullmatch(email):
        raise StoreError("The email address is not valid.")
    now = _now()
    try:
        with connection() as db:
            db.execute(
                "INSERT INTO users (username, display_name, email, password_hash, disabled, created_at, updated_at) "
                "VALUES (?, ?, ?, ?, 0, ?, ?)",
                (username, display_name, email, security.hash_password(password), now, now),
            )
    except sqlite3.IntegrityError as exc:
        raise StoreError(f"The user '{username}' already exists.") from exc
    write_authelia_users()
    return User(username, display_name, email)


def set_password(username: str, new_password: str) -> None:
    username = username.strip().lower()
    problem = security.check_password_policy(new_password, username)
    if problem:
        raise StoreError(problem)
    with connection() as db:
        cur = db.execute(
            "UPDATE users SET password_hash = ?, updated_at = ? WHERE username = ?",
            (security.hash_password(new_password), _now(), username),
        )
        if cur.rowcount == 0:
            raise StoreError(f"The user '{username}' does not exist.")
    write_authelia_users()


def change_password(username: str, current: str, new: str) -> None:
    """The user changes their own password: the current one is required."""
    username = username.strip().lower()
    with connection() as db:
        row = db.execute("SELECT password_hash FROM users WHERE username = ?", (username,)).fetchone()
    if row is None or not security.verify_password(current, row["password_hash"]):
        raise WrongPassword("The current password is not correct.")
    set_password(username, new)


def delete_user(username: str) -> bool:
    """Deletes the user and, by cascade, their keys. True if the user existed."""
    with connection() as db:
        cur = db.execute("DELETE FROM users WHERE username = ?", (username.strip().lower(),))
        removed = cur.rowcount > 0
    if removed:
        write_authelia_users()
    return removed


def set_disabled(username: str, disabled: bool) -> bool:
    with connection() as db:
        cur = db.execute(
            "UPDATE users SET disabled = ?, updated_at = ? WHERE username = ?",
            (int(disabled), _now(), username.strip().lower()),
        )
        changed = cur.rowcount > 0
    if changed:
        write_authelia_users()
    return changed


def set_mfa(username: str, enabled: bool) -> bool:
    """Requires (or stops requiring) the second factor for a user. True if the user exists.

    Authelia applies it from the users file: the user joins the "mfa" group, and the access
    rule for that group is two_factor. The device (TOTP app, security key) is registered by
    the user in the portal and kept by Authelia, not by Argus.
    """
    with connection() as db:
        cur = db.execute(
            "UPDATE users SET mfa_enabled = ?, updated_at = ? WHERE username = ?",
            (int(enabled), _now(), username.strip().lower()),
        )
        changed = cur.rowcount > 0
    if changed:
        write_authelia_users()
    return changed


def verify_password(username: str, password: str) -> bool:
    """True if the password is the user's (to confirm sensitive actions, like turning off the second factor)."""
    with connection() as db:
        row = db.execute("SELECT password_hash FROM users WHERE username = ?", (username.strip().lower(),)).fetchone()
    return row is not None and security.verify_password(password, row["password_hash"])


def _check_service(service: str) -> None:
    if service not in SERVICES:
        raise StoreError(f"Unknown service '{service}'.")


def set_api_key(username: str, service: str, key: str) -> None:
    _check_service(service)
    key = key.strip()
    if not KEY_PATTERN.fullmatch(key):
        raise StoreError("Use 8 to 256 characters: letters, digits and . _ ~ + / = -")
    username = username.strip().lower()
    blob = security.encrypt_secret(key, username=username, service=service)
    with connection() as db:
        db.execute(
            "INSERT INTO api_keys (username, service, ciphertext, updated_at) VALUES (?, ?, ?, ?) "
            "ON CONFLICT(username, service) DO UPDATE SET ciphertext = excluded.ciphertext, updated_at = excluded.updated_at",
            (username, service, blob, _now()),
        )


def delete_api_key(username: str, service: str) -> None:
    _check_service(service)
    with connection() as db:
        db.execute("DELETE FROM api_keys WHERE username = ? AND service = ?", (username.strip().lower(), service))


def get_api_key(username: str, service: str) -> Optional[str]:
    """The plaintext key, or None if there is none (or it cannot be decrypted)."""
    username = username.strip().lower()
    with connection() as db:
        row = db.execute("SELECT ciphertext FROM api_keys WHERE username = ? AND service = ?", (username, service)).fetchone()
    if row is None:
        return None
    return security.decrypt_secret(row["ciphertext"], username=username, service=service)


def key_status(username: str) -> Dict[str, Dict[str, object]]:
    """For each service: whether a key exists and its last 4 characters. The full key never leaves the server."""
    out: Dict[str, Dict[str, object]] = {s: {"configured": False, "hint": None} for s in SERVICES}
    for service in SERVICES:
        key = get_api_key(username, service)
        if key:
            out[service] = {"configured": True, "hint": key[-4:]}
    return out


#: A source id (as in frontend/src/lib/search/lookup.ts): lowercase letters, digits, hyphen and underscore.
_SOURCE_ID = re.compile(r"[a-z0-9][a-z0-9_-]{0,31}")
MAX_DISABLED_SOURCES = 64


def _clean_disabled_sources(value: object) -> List[str]:
    if not isinstance(value, list) or not all(isinstance(v, str) for v in value):
        raise StoreError("disabledSources must be a list of source ids.")
    if len(value) > MAX_DISABLED_SOURCES:
        raise StoreError(f"disabledSources can have at most {MAX_DISABLED_SOURCES} entries.")
    for item in value:
        if not _SOURCE_ID.fullmatch(item):
            raise StoreError(f"'{item[:40]}' is not a valid source id.")
    return sorted(set(value))


#: Known preferences: name -> (value check, default). Every new preference is added here.
_PREFERENCES: Dict[str, Tuple[Callable[[object], object], object]] = {
    # Sources the user turned off: they are not queried. Default: all on.
    "disabledSources": (_clean_disabled_sources, []),
}


def get_preferences(username: str) -> Dict[str, object]:
    """The user's preferences, with defaults where nothing was chosen."""
    out: Dict[str, object] = {name: default for name, (_, default) in _PREFERENCES.items()}
    with connection() as db:
        rows = db.execute("SELECT key, value FROM preferences WHERE username = ?", (username.strip().lower(),)).fetchall()
    for row in rows:
        if row["key"] not in _PREFERENCES:
            continue  # preference from a newer version, or removed: ignore it
        try:
            out[row["key"]] = _PREFERENCES[row["key"]][0](json.loads(row["value"]))
        except (ValueError, StoreError):
            pass  # unreadable value: the default applies
    return out


def set_preferences(username: str, changes: Dict[str, object]) -> Dict[str, object]:
    """Saves the given preferences (the others do not change) and returns the complete set."""
    username = username.strip().lower()
    clean: Dict[str, object] = {}
    for name, value in changes.items():
        if name not in _PREFERENCES:
            raise StoreError(f"Unknown preference '{name}'.")
        clean[name] = _PREFERENCES[name][0](value)
    now = _now()
    with connection() as db:
        for name, value in clean.items():
            db.execute(
                "INSERT INTO preferences (username, key, value, updated_at) VALUES (?, ?, ?, ?) "
                "ON CONFLICT(username, key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
                (username, name, json.dumps(value), now),
            )
    return get_preferences(username)


#: Name of the placeholder user: it cannot match a real user (USERNAME_PATTERN does not allow a leading underscore).
PLACEHOLDER_USER = "_no-users-yet_"

#: Argon2id hash of an unknown password: well-formed, but nobody can know the password.
_PLACEHOLDER_HASH = "$argon2id$v=19$m=65536,t=3,p=4$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"


def render_authelia_users(users: List[User], hashes: Dict[str, str]) -> str:
    """YAML of the users file. Values are JSON strings, which YAML accepts as quoted strings."""
    lines = [
        "# Generated by Argus from its SQLite database: do not edit by hand,",
        "# changes are overwritten. Manage users with: python -m app.cli",
        "users:",
    ]
    entries = [(u.username, u.disabled, u.display_name, hashes[u.username], u.email, u.mfa_enabled) for u in users]
    if not entries:
        # Authelia does not start with an empty list: until there is a real user, it gets a disabled placeholder
        entries = [(PLACEHOLDER_USER, True, "No users yet", _PLACEHOLDER_HASH, f"{PLACEHOLDER_USER}@argus.local", False)]
    for username, disabled, display_name, password_hash, email, mfa in entries:
        lines += [
            f"  {json.dumps(username)}:",
            f"    disabled: {'true' if disabled else 'false'}",
            f"    displayname: {json.dumps(display_name)}",
            f"    password: {json.dumps(password_hash)}",
            f"    email: {json.dumps(email)}",
            "    groups:",
            '      - "users"',
        ]
        if mfa:
            # The access rule in authelia/configuration.yml requires the second factor for this group
            lines.append('      - "mfa"')
    return "\n".join(lines) + "\n"


def write_authelia_users() -> Optional[Path]:
    """Rewrites Authelia's users file atomically (Authelia never reads it half-written)."""
    path = get_settings().authelia_users_file
    if path is None:
        return None
    with connection() as db:
        rows = db.execute("SELECT * FROM users ORDER BY username").fetchall()
    users = [_user(r) for r in rows]
    text = render_authelia_users(users, {r["username"]: r["password_hash"] for r in rows})

    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".users-", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(text)
        # Readable by Authelia even if it runs as another user: it holds only Argon2id hashes
        os.chmod(tmp, 0o644)
        os.replace(tmp, path)
    except BaseException:
        Path(tmp).unlink(missing_ok=True)
        raise
    return path
