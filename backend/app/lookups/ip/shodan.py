"""Shodan InternetDB: open ports, hostnames, tags, software (CPE) and CVEs of an IP.

It needs no API key: use is free for non-commercial purposes. Shodan refreshes the data
once a week, so responses are cached for an hour. An IP without data answers 404: not
an error, Shodan simply has not seen anything on that address.
"""
import re
import time
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException

from app.lookups.ip.common import IPRequest, parse_ip, require_public

router = APIRouter()

INTERNETDB_URL = "https://internetdb.shodan.io/{ip}"

CACHE_TTL = 3600
CACHE_MAX_ENTRIES = 1000
_cache: dict[str, tuple[float, dict]] = {}

_CVE = re.compile(r"CVE-(\d{4})-(\d{4,})", re.IGNORECASE)


def _cache_get(ip: str) -> dict | None:
    hit = _cache.get(ip)
    if not hit:
        return None
    expires, body = hit
    if expires < time.monotonic():
        _cache.pop(ip, None)
        return None
    return body


def _cache_set(ip: str, body: dict) -> None:
    if len(_cache) >= CACHE_MAX_ENTRIES:
        now = time.monotonic()
        for k in [k for k, (exp, _) in _cache.items() if exp < now]:
            _cache.pop(k, None)
        if len(_cache) >= CACHE_MAX_ENTRIES:
            _cache.clear()
    _cache[ip] = (time.monotonic() + CACHE_TTL, body)


def _strings(value: Any) -> list[str]:
    """The non-empty strings of a list, without duplicates and in order of arrival."""
    if not isinstance(value, list):
        return []
    seen: dict[str, None] = {}
    for item in value:
        if isinstance(item, str) and item.strip():
            seen.setdefault(item.strip(), None)
    return list(seen)


def _ports(value: Any) -> list[int]:
    if not isinstance(value, list):
        return []
    return sorted({p for p in value if isinstance(p, int) and not isinstance(p, bool) and 0 < p < 65536})


def _cves(value: Any) -> list[str]:
    """The valid CVE identifiers, from the most recent to the oldest."""
    found = {m.group(0).upper() for m in map(_CVE.fullmatch, _strings(value)) if m}
    return sorted(found, key=lambda c: tuple(int(n) for n in _CVE.fullmatch(c).groups()), reverse=True)


def _normalize(ip: str, body: dict | None) -> dict:
    """`body` is None when Shodan has no data on the IP (HTTP 404)."""
    data = body or {}
    return {
        "ip": ip,
        "found": body is not None,
        "ports": _ports(data.get("ports")),
        "hostnames": _strings(data.get("hostnames")),
        "tags": _strings(data.get("tags")),
        "vulns": _cves(data.get("vulns")),
        "cpes": _strings(data.get("cpes")),
    }


async def _fetch(ip: str) -> dict | None:
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(INTERNETDB_URL.format(ip=ip), timeout=10.0)
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="Shodan InternetDB timed out.")
    except httpx.RequestError as e:
        raise HTTPException(status_code=502, detail=f"Shodan InternetDB error: {type(e).__name__}")

    if resp.status_code == 404:
        return None
    if resp.status_code == 429:
        raise HTTPException(status_code=429, detail="Shodan InternetDB rate limit reached.")
    if resp.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"Shodan InternetDB responded with HTTP {resp.status_code}.")
    try:
        body = resp.json()
    except ValueError:
        raise HTTPException(status_code=502, detail="Shodan InternetDB returned an unreadable response.")
    if not isinstance(body, dict):
        raise HTTPException(status_code=502, detail="Shodan InternetDB returned an unexpected response.")
    return body


@router.post("")
async def shodan(request: IPRequest):
    ip = require_public(parse_ip(request.ip))

    cached = _cache_get(ip)
    if cached is None:
        cached = _normalize(ip, await _fetch(ip))
        _cache_set(ip, cached)
    return cached
