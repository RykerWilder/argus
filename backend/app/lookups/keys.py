"""Helpers shared by the routers that use the user's API key."""
from fastapi import HTTPException, Request

from app.accounts import store


def request_api_key(http_request: Request, service: str) -> str:
    """The API key the authenticated user saved in Settings for `service`
    (encrypted in the database, see store.py). Empty string if there is none.
    The user is set by the require_user dependency, which protects every /api route.
    """
    user = getattr(http_request.state, "user", None)
    if user is None:
        raise HTTPException(status_code=401, detail="Not authenticated.")
    return store.get_api_key(user.username, service) or ""
