"""ProxyCheck.io (API v3): rilevamento VPN, proxy, Tor, hosting e rischio."""
import time
from typing import Any, Optional

import httpx
from fastapi import APIRouter, HTTPException, Request
from pydantic import Field

from .common import IPRequest, parse_ip, request_api_key, require_public

router = APIRouter()

PROXYCHECK_BASE_URL = "https://proxycheck.io/v3"

CACHE_TTL_CLEAN = 600
CACHE_TTL_ANONYMOUS = 60
CACHE_MAX_ENTRIES = 1000
_cache: dict[tuple, tuple[float, dict]] = {}


class ProxyRequest(IPRequest):
    days: Optional[float] = Field(default=None, ge=0.01, le=60)


def _api_key(http_request: Request) -> Optional[str]:
    # La key è facoltativa: senza key ProxyCheck applica un limite giornaliero ridotto.
    return request_api_key(http_request) or None


def _cache_get(key: tuple) -> Optional[dict]:
    hit = _cache.get(key)
    if not hit:
        return None
    expires, body = hit
    if expires < time.monotonic():
        _cache.pop(key, None)
        return None
    return body


def _cache_set(key: tuple, body: dict, ttl: int) -> None:
    if len(_cache) >= CACHE_MAX_ENTRIES:
        now = time.monotonic()
        for k in [k for k, (exp, _) in _cache.items() if exp < now]:
            _cache.pop(k, None)
        if len(_cache) >= CACHE_MAX_ENTRIES:
            _cache.clear()
    _cache[key] = (time.monotonic() + ttl, body)


def _pick(*sources: Any, keys: tuple) -> Any:
    for src in sources:
        if isinstance(src, dict):
            for k in keys:
                if src.get(k) not in (None, ""):
                    return src[k]
    return None


async def _fetch(ip: str, params: dict) -> dict:
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(f"{PROXYCHECK_BASE_URL}/{ip}", params=params, timeout=15.0)
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="ProxyCheck.io timed out.")
    except httpx.RequestError as e:
        raise HTTPException(status_code=502, detail=f"ProxyCheck.io error: {type(e).__name__}")

    try:
        body = resp.json()
    except ValueError:
        body = {}
    if not isinstance(body, dict):
        body = {}

    status, message = body.get("status"), body.get("message")
    if resp.status_code == 429 or status == "denied":
        raise HTTPException(status_code=429, detail=message or "ProxyCheck.io rate limit reached.")
    if resp.status_code in (401, 403):
        raise HTTPException(status_code=resp.status_code, detail=message or "Access denied by ProxyCheck.io (check the API key).")
    if resp.status_code == 400 or status == "error":
        raise HTTPException(status_code=422, detail=message or "ProxyCheck.io rejected this IP.")
    if resp.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"ProxyCheck.io responded with HTTP {resp.status_code}.")
    return body


def _entry(body: dict, ip: str) -> dict:
    entry = body.get(ip)
    if isinstance(entry, dict):
        return entry
    return next((v for v in body.values() if isinstance(v, dict)), {})


def _normalize(ip: str, body: dict) -> dict:
    d = _entry(body, ip)
    det = d.get("detections") or {}
    net = d.get("network") or {}
    loc = d.get("location") or {}
    operator = d.get("operator")
    attack_history = d.get("attack_history")

    total_attacks = None
    if isinstance(attack_history, dict):
        total_attacks = sum(v for v in attack_history.values() if isinstance(v, (int, float)))

    op = None
    if isinstance(operator, dict):
        op = {
            "name": operator.get("name"),
            "url": operator.get("url"),
            "anonymity": operator.get("anonymity"),
            "popularity": operator.get("popularity"),
            "services": operator.get("services") or [],
            "protocols": operator.get("protocols") or [],
            "policies": operator.get("policies") or {},
        }

    return {
        "ip": ip,
        "warning": body.get("message") if body.get("status") == "warning" else None,
        "detections": {
            "anonymous": bool(det.get("anonymous")),
            "proxy": bool(det.get("proxy")),
            "vpn": bool(det.get("vpn")),
            "tor": bool(det.get("tor")),
            "hosting": bool(det.get("hosting")),
            "scraper": bool(det.get("scraper")),
            "compromised": bool(det.get("compromised")),
        },
        "confidence": det.get("confidence"),
        "risk": _pick(d, det, keys=("risk", "risk_score")),
        "firstSeen": det.get("first_seen"),
        "lastSeen": det.get("last_seen"),
        "network": {
            "asn": net.get("asn"),
            "range": net.get("range"),
            "hostname": net.get("hostname"),
            "provider": net.get("provider"),
            "organisation": net.get("organisation"),
            "type": net.get("type"),
        },
        "location": {
            "country": _pick(loc, keys=("country_name", "country")),
            "countryCode": _pick(loc, keys=("country_code", "isocode")),
            "region": _pick(loc, keys=("region_name", "region")),
            "city": _pick(loc, keys=("city_name", "city")),
            "lat": _pick(loc, keys=("latitude", "lat")),
            "lon": _pick(loc, keys=("longitude", "lon")),
            "timezone": _pick(loc, keys=("timezone",)),
        },
        "deviceEstimate": d.get("device_estimate"),
        "operator": op,
        "attackHistory": attack_history,
        "totalAttacks": total_attacks,
    }


@router.post("")
async def check_ip(request: ProxyRequest, http_request: Request):
    ip = require_public(parse_ip(request.ip))

    params: dict = {}
    if key := _api_key(http_request):
        params["key"] = key
    if request.days is not None:
        params["days"] = request.days

    cache_key = (ip, request.days)
    body = _cache_get(cache_key)
    if body is None:
        body = await _fetch(ip, params)
        anonymous = (_entry(body, ip).get("detections") or {}).get("anonymous", False)
        _cache_set(cache_key, body, CACHE_TTL_ANONYMOUS if anonymous else CACHE_TTL_CLEAN)

    return _normalize(ip, body)
