"""Account of the authenticated user: profile, password, second factor, API keys and search preferences."""
import time
from typing import Dict, List, Optional
from urllib.parse import quote

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from app.accounts import store
from app.accounts.auth import require_user
from app.config import get_settings

router = APIRouter()

# Someone with a valid session can only try to guess the current password a few times:
# after 5 failures in 10 minutes, password changes for that user stop until the window
# expires. The counter lives in memory (the backend runs as a single process).
MAX_WRONG_CURRENT = 5
WRONG_CURRENT_WINDOW = 600.0
_wrong_current: Dict[str, List[float]] = {}


def _recent_wrong(username: str) -> List[float]:
    now = time.monotonic()
    recent = [t for t in _wrong_current.get(username, []) if now - t < WRONG_CURRENT_WINDOW]
    if recent:
        _wrong_current[username] = recent
    else:
        _wrong_current.pop(username, None)
    return recent


def reset_limits() -> None:
    """Resets the counters (used by tests)."""
    _wrong_current.clear()


def _logout_url() -> str:
    """Authelia portal sign-out link, returning to Argus. Empty if the address is not configured."""
    settings = get_settings()
    if not settings.auth_url:
        return ""
    back = f"?rd={quote(settings.public_url + '/', safe='')}" if settings.public_url else ""
    return f"{settings.auth_url}/logout{back}"


def _mfa(user: store.User) -> Dict[str, object]:
    """Second-factor state: on, enforced by the server for everyone, and where devices are managed."""
    settings = get_settings()
    required = settings.auth_policy == "two_factor"
    return {
        "enabled": required or user.mfa_enabled,
        "required": required,
        # In the Authelia portal the user registers and removes TOTP apps and security keys
        "manageUrl": f"{settings.auth_url}/settings" if settings.auth_url else "",
    }


@router.get("/me")
def me(user: store.User = Depends(require_user)):
    return {
        "username": user.username,
        "displayName": user.display_name,
        "email": user.email,
        "logoutUrl": _logout_url(),
        "mfa": _mfa(user),
    }


class PasswordChange(BaseModel):
    current: str = Field(..., max_length=256)
    new: str = Field(..., max_length=256)


@router.post("/me/password")
def change_password(body: PasswordChange, user: store.User = Depends(require_user)):
    if len(_recent_wrong(user.username)) >= MAX_WRONG_CURRENT:
        raise HTTPException(status_code=429, detail="Too many wrong passwords. Try again in a few minutes.")
    try:
        store.change_password(user.username, body.current, body.new)
    except store.WrongPassword as exc:
        _wrong_current.setdefault(user.username, []).append(time.monotonic())
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except store.StoreError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    _wrong_current.pop(user.username, None)
    return {"ok": True}


class MfaChange(BaseModel):
    enabled: bool
    #: only needed to turn it off
    password: str = Field("", max_length=256)


@router.put("/me/mfa")
def change_mfa(body: MfaChange, user: store.User = Depends(require_user)):
    """Turns the second factor on or off for the user.

    Turning it on asks for nothing: at the next sign-in Authelia has them register a device.
    Turning it off asks for the password, so a session left open cannot lower the protection.
    """
    if get_settings().auth_policy == "two_factor":
        raise HTTPException(status_code=409, detail="Two-factor authentication is required for everyone on this server.")
    if body.enabled == user.mfa_enabled:
        return _mfa(user)
    if not body.enabled:
        if len(_recent_wrong(user.username)) >= MAX_WRONG_CURRENT:
            raise HTTPException(status_code=429, detail="Too many wrong passwords. Try again in a few minutes.")
        if not store.verify_password(user.username, body.password):
            _wrong_current.setdefault(user.username, []).append(time.monotonic())
            raise HTTPException(status_code=400, detail="The current password is not correct.")
        _wrong_current.pop(user.username, None)
    store.set_mfa(user.username, body.enabled)
    updated = store.get_user(user.username)
    return _mfa(updated if updated else user)


class KeyBody(BaseModel):
    key: str = Field(..., max_length=512)


@router.get("/keys")
def key_status(user: store.User = Depends(require_user)):
    """Which keys are saved (last 4 characters only). Never the full key."""
    return store.key_status(user.username)


def _known_service(service: str) -> str:
    if service not in store.SERVICES:
        raise HTTPException(status_code=404, detail="Unknown service.")
    return service


@router.put("/keys/{service}")
def save_key(service: str, body: KeyBody, user: store.User = Depends(require_user)):
    _known_service(service)
    try:
        store.set_api_key(user.username, service, body.key)
    except store.StoreError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return store.key_status(user.username)[service]


@router.delete("/keys/{service}")
def remove_key(service: str, user: store.User = Depends(require_user)):
    store.delete_api_key(user.username, _known_service(service))
    return {"configured": False, "hint": None}


class PreferencesBody(BaseModel):
    """Only the given fields change. Values are validated in store.set_preferences."""

    disabledSources: Optional[List[str]] = Field(None, max_length=store.MAX_DISABLED_SOURCES)


@router.get("/preferences")
def get_preferences(user: store.User = Depends(require_user)):
    """The user's search preferences (which sources to query)."""
    return store.get_preferences(user.username)


@router.put("/preferences")
def save_preferences(body: PreferencesBody, user: store.User = Depends(require_user)):
    try:
        return store.set_preferences(user.username, body.model_dump(exclude_none=True))
    except store.StoreError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
