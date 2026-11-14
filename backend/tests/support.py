"""Test environment: temporary database and users file, test keys, minimal ASGI client."""
import asyncio
import base64
import json
import os
import shutil
import tempfile
import unittest
from typing import Dict, Optional, Tuple

from app import config
from app.accounts import db

SECRET_KEY = base64.b64encode(bytes(range(32))).decode()
PROXY_SECRET = "p" * 40
STRONG = "correct horse battery staple"


class ArgusTestCase(unittest.TestCase):
    """Each test gets its own database and users file, in a temporary folder."""

    env_extra: Dict[str, str] = {}

    def setUp(self) -> None:
        self.tmp = tempfile.mkdtemp(prefix="argus-test-")
        self.db_path = os.path.join(self.tmp, "argus.db")
        self.users_file = os.path.join(self.tmp, "authelia", "users_database.yml")
        self._saved = dict(os.environ)
        for name in [k for k in os.environ if k.startswith("ARGUS_")]:
            del os.environ[name]
        os.environ.update(
            ARGUS_SECRET_KEY=SECRET_KEY,
            ARGUS_PROXY_SECRET=PROXY_SECRET,
            ARGUS_DB_PATH=self.db_path,
            ARGUS_AUTHELIA_USERS_FILE=self.users_file,
            ARGUS_AUTH_URL="https://auth.argus.localhost",
            ARGUS_PUBLIC_URL="https://argus.localhost",
        )
        os.environ.update(self.env_extra)
        config.reset_settings()
        db.init_db()

    def tearDown(self) -> None:
        os.environ.clear()
        os.environ.update(self._saved)
        config.reset_settings()
        shutil.rmtree(self.tmp, ignore_errors=True)


def proxy_headers(user: Optional[str], secret: str = PROXY_SECRET) -> Dict[str, str]:
    """The headers nginx adds after Authelia has authenticated the request."""
    headers = {"X-Argus-Proxy-Secret": secret}
    if user is not None:
        headers["Remote-User"] = user
    return headers


async def _call(app, method: str, path: str, headers: Dict[str, str], body: object) -> Tuple[int, object]:
    raw = b"" if body is None else json.dumps(body).encode()
    raw_headers = [(k.lower().encode(), v.encode()) for k, v in headers.items()]
    if body is not None:
        raw_headers += [(b"content-type", b"application/json"), (b"content-length", str(len(raw)).encode())]
    scope = {
        "type": "http", "asgi": {"version": "3.0"}, "http_version": "1.1", "method": method, "scheme": "http",
        "path": path, "raw_path": path.encode(), "query_string": b"", "root_path": "", "headers": raw_headers,
        "client": ("127.0.0.1", 50000), "server": ("backend", 8000),
    }
    sent = False

    async def receive():
        nonlocal sent
        if not sent:
            sent = True
            return {"type": "http.request", "body": raw, "more_body": False}
        return {"type": "http.disconnect"}

    status = 0
    chunks = []

    async def send(message):
        nonlocal status
        if message["type"] == "http.response.start":
            status = message["status"]
        elif message["type"] == "http.response.body":
            chunks.append(message.get("body", b""))

    await app(scope, receive, send)
    data = b"".join(chunks)
    try:
        return status, json.loads(data) if data else None
    except ValueError:
        return status, data.decode("utf-8", "replace")


def call(app, method: str, path: str, headers: Optional[Dict[str, str]] = None, body: object = None) -> Tuple[int, object]:
    """An HTTP request to the ASGI app, without network. Returns (status, JSON)."""
    return asyncio.run(_call(app, method, path, headers or {}, body))
