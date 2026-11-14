"""Who is making the request.

Sign-in is not done by the backend: Authelia does it. Before forwarding a request to
/api/, nginx has Authelia verify it and adds two headers:

- Remote-User: the authenticated user name (replaces any value sent by the browser);
- X-Argus-Proxy-Secret: a shared secret, proof that the request came through nginx.

The backend is not reachable from outside, but the secret also protects against another
container on the same network trying to impersonate a user.
"""
import hmac
import logging

from fastapi import HTTPException, Request

from app.accounts import store
from app.config import get_settings

log = logging.getLogger("argus.auth")

USER_HEADER = "Remote-User"
PROXY_SECRET_HEADER = "X-Argus-Proxy-Secret"


def require_user(request: Request) -> store.User:
    """FastAPI dependency: returns the authenticated user or answers 401/403."""
    settings = get_settings()

    if settings.dev_user:
        # Development without Authelia (see README): without Remote-User, use the configured user.
        username = (request.headers.get(USER_HEADER) or settings.dev_user).strip().lower()
    else:
        sent = request.headers.get(PROXY_SECRET_HEADER) or ""
        if not hmac.compare_digest(sent.encode("utf-8"), settings.proxy_secret.encode("utf-8")):
            log.warning("Request without a valid proxy secret from %s", request.client.host if request.client else "?")
            raise HTTPException(status_code=401, detail="Not authenticated.")
        username = (request.headers.get(USER_HEADER) or "").strip().lower()
        if not username:
            raise HTTPException(status_code=401, detail="Not authenticated.")

    user = store.get_user(username)
    if user is None or user.disabled:
        # Authelia knows the user but Argus does not (or the user is disabled): no access.
        raise HTTPException(status_code=403, detail="This account is not allowed to use Argus.")

    request.state.user = user
    return user
