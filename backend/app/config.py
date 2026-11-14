"""Backend settings, read from environment variables.

Configuration errors stop the startup with a clear message: better not to start
than to start without encryption or protection.
"""
import base64
import binascii
import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path
from typing import Optional

MIN_PROXY_SECRET_LENGTH = 32

#: Authelia access policies: password only, or a second factor for everyone.
AUTH_POLICIES = ("one_factor", "two_factor")


class ConfigError(RuntimeError):
    """Missing or invalid configuration."""


@dataclass(frozen=True)
class Settings:
    #: SQLite file with users and API keys
    db_path: Path
    #: 32 bytes used to encrypt API keys in the database
    secret_key: bytes
    #: secret nginx adds to requests: proof they came through the proxy
    proxy_secret: str
    #: development without Authelia only: user applied when the Remote-User header is missing
    dev_user: Optional[str]
    #: users_database.yml file the backend generates for Authelia (None = do not generate it)
    authelia_users_file: Optional[Path]
    #: public address of the Authelia portal, for the sign-out link
    auth_url: str
    #: public address of Argus, where to return after sign-out
    public_url: str
    #: server-wide access policy (ARGUS_AUTH_POLICY): with two_factor the second factor is mandatory for everyone
    auth_policy: str


def decode_secret_key(raw: str) -> bytes:
    """Decodes ARGUS_SECRET_KEY: 32 bytes in base64 (standard or URL-safe)."""
    text = raw.strip()
    if not text:
        raise ConfigError("ARGUS_SECRET_KEY is empty. Run scripts/init.sh to generate one.")
    padded = text + "=" * (-len(text) % 4)
    try:
        key = base64.urlsafe_b64decode(padded.replace("+", "-").replace("/", "_"))
    except (binascii.Error, ValueError) as exc:
        raise ConfigError("ARGUS_SECRET_KEY is not valid base64.") from exc
    if len(key) != 32:
        raise ConfigError(f"ARGUS_SECRET_KEY must decode to 32 bytes, it has {len(key)}. Generate one with: openssl rand -base64 32")
    return key


def _load() -> Settings:
    env = os.environ

    secret_raw = env.get("ARGUS_SECRET_KEY")
    if secret_raw is None:
        raise ConfigError("ARGUS_SECRET_KEY is not set. Run scripts/init.sh to generate the secrets.")
    secret_key = decode_secret_key(secret_raw)

    dev_user = (env.get("ARGUS_DEV_USER") or "").strip().lower() or None
    proxy_secret = (env.get("ARGUS_PROXY_SECRET") or "").strip()
    if not dev_user and len(proxy_secret) < MIN_PROXY_SECRET_LENGTH:
        raise ConfigError(
            f"ARGUS_PROXY_SECRET must have at least {MIN_PROXY_SECRET_LENGTH} characters: it is how the backend knows a "
            "request went through nginx and Authelia. Run scripts/init.sh to generate it."
        )

    auth_policy = (env.get("ARGUS_AUTH_POLICY") or "one_factor").strip()
    if auth_policy not in AUTH_POLICIES:
        raise ConfigError(f"ARGUS_AUTH_POLICY must be one of: {', '.join(AUTH_POLICIES)} (it is '{auth_policy}').")

    users_file = (env.get("ARGUS_AUTHELIA_USERS_FILE") or "").strip()
    return Settings(
        db_path=Path(env.get("ARGUS_DB_PATH") or "/data/argus.db"),
        secret_key=secret_key,
        proxy_secret=proxy_secret,
        dev_user=dev_user,
        authelia_users_file=Path(users_file) if users_file else None,
        auth_url=(env.get("ARGUS_AUTH_URL") or "").strip().rstrip("/"),
        public_url=(env.get("ARGUS_PUBLIC_URL") or "").strip().rstrip("/"),
        auth_policy=auth_policy,
    )


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return _load()


def reset_settings() -> None:
    """Re-reads the environment on the next request (used by tests)."""
    get_settings.cache_clear()
