"""VirusTotal (API v3): reputazione di un dominio o di un URL.

Il piano gratuito consente 4 richieste al minuto e 500 al giorno. Per un URL
mai visto si invia l'analisi e si attende al massimo due controlli, così una
ricerca non supera mai 4 richieste.
"""
import asyncio
import base64
from datetime import datetime, timezone
from typing import Any, Literal, Optional

import httpx
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from .common import request_api_key
from .domain_common import normalize_domain, normalize_url

router = APIRouter()

VT_BASE = "https://www.virustotal.com/api/v3"
POLL_WAIT = 4.0
POLL_TRIES = 2


class VTRequest(BaseModel):
    target: str = Field(..., description="Dominio (es. example.com) o URL (es. https://example.com/login)")
    type: Literal["domain", "url"] = "domain"


def _api_key(http_request: Request) -> str:
    key = request_api_key(http_request, "VIRUSTOTAL_API_KEY")
    if not key:
        raise HTTPException(
            status_code=503,
            detail="No VirusTotal API key: add one in Settings or set VIRUSTOTAL_API_KEY in .env.",
        )
    return key


def _ts(value: Any) -> Optional[str]:
    if not value:
        return None
    try:
        return datetime.fromtimestamp(int(value), tz=timezone.utc).isoformat()
    except (TypeError, ValueError, OSError):
        return None


def _check(resp: httpx.Response) -> None:
    if resp.status_code == 401:
        raise HTTPException(status_code=401, detail="Invalid VirusTotal API key.")
    if resp.status_code == 429:
        raise HTTPException(status_code=429, detail="VirusTotal rate limit reached (free plan: 4 lookups per minute).")
    if resp.status_code >= 400 and resp.status_code != 404:
        raise HTTPException(status_code=502, detail=f"VirusTotal responded with HTTP {resp.status_code}.")


def _stats(raw: dict | None) -> dict:
    raw = raw or {}
    keys = ("malicious", "suspicious", "harmless", "undetected", "timeout")
    stats = {k: int(raw.get(k) or 0) for k in keys}
    stats["total"] = sum(stats.values())
    return stats


def _flagged(results: dict | None) -> list[dict]:
    out = []
    for engine, r in (results or {}).items():
        category = (r or {}).get("category")
        if category in ("malicious", "suspicious"):
            out.append({"engine": r.get("engine_name") or engine, "category": category, "result": r.get("result")})
    out.sort(key=lambda r: (r["category"] != "malicious", r["engine"].lower()))
    return out


def _common(attrs: dict) -> dict:
    categories = sorted({str(c) for c in (attrs.get("categories") or {}).values() if c})
    votes = attrs.get("total_votes") or {}
    return {
        "stats": _stats(attrs.get("last_analysis_stats")),
        "flagged": _flagged(attrs.get("last_analysis_results")),
        "reputation": attrs.get("reputation"),
        "votes": {"harmless": votes.get("harmless", 0), "malicious": votes.get("malicious", 0)},
        "categories": categories,
        "tags": attrs.get("tags") or [],
        "lastAnalysisAt": _ts(attrs.get("last_analysis_date")),
    }


def _domain_report(domain: str, attrs: dict) -> dict:
    cert = attrs.get("last_https_certificate") or {}
    validity = cert.get("validity") or {}
    ranks = [
        {"source": name, "rank": (v or {}).get("rank")}
        for name, v in (attrs.get("popularity_ranks") or {}).items()
        if (v or {}).get("rank")
    ]
    ranks.sort(key=lambda r: r["rank"])
    return {
        "type": "domain",
        "target": domain,
        "found": True,
        **_common(attrs),
        "popularity": ranks[:5],
        "dnsRecords": [
            {"type": r.get("type"), "value": r.get("value"), "ttl": r.get("ttl")}
            for r in attrs.get("last_dns_records") or []
            if r.get("type") and r.get("value")
        ],
        "certificate": {
            "subject": (cert.get("subject") or {}).get("CN"),
            "issuer": (cert.get("issuer") or {}).get("O") or (cert.get("issuer") or {}).get("CN"),
            "validFrom": validity.get("not_before"),
            "validTo": validity.get("not_after"),
        } if cert else None,
        "registrar": attrs.get("registrar"),
        "createdAt": _ts(attrs.get("creation_date")),
    }


def _url_report(url: str, attrs: dict) -> dict:
    return {
        "type": "url",
        "target": url,
        "found": True,
        "status": "completed",
        **_common(attrs),
        "finalUrl": attrs.get("last_final_url"),
        "title": attrs.get("title"),
        "httpStatus": attrs.get("last_http_response_code"),
        "redirects": [u for u in attrs.get("redirection_chain") or [] if u],
        "timesSubmitted": attrs.get("times_submitted"),
        "firstSubmittedAt": _ts(attrs.get("first_submission_date")),
    }


async def _domain(client: httpx.AsyncClient, domain: str) -> dict:
    resp = await client.get(f"{VT_BASE}/domains/{domain}")
    _check(resp)
    if resp.status_code == 404:
        return {"type": "domain", "target": domain, "found": False}
    return _domain_report(domain, resp.json().get("data", {}).get("attributes", {}))


async def _url(client: httpx.AsyncClient, url: str) -> dict:
    url_id = base64.urlsafe_b64encode(url.encode()).decode().rstrip("=")
    resp = await client.get(f"{VT_BASE}/urls/{url_id}")
    _check(resp)
    if resp.status_code != 404:
        return _url_report(url, resp.json().get("data", {}).get("attributes", {}))

    # URL mai analizzato: si invia e si attende il risultato per qualche secondo.
    resp = await client.post(f"{VT_BASE}/urls", data={"url": url})
    _check(resp)
    if resp.status_code == 404:
        raise HTTPException(status_code=502, detail="VirusTotal could not submit this URL.")
    analysis_id = resp.json().get("data", {}).get("id")

    attrs: dict = {}
    for _ in range(POLL_TRIES):
        await asyncio.sleep(POLL_WAIT)
        resp = await client.get(f"{VT_BASE}/analyses/{analysis_id}")
        _check(resp)
        attrs = resp.json().get("data", {}).get("attributes", {}) if resp.status_code == 200 else {}
        if attrs.get("status") == "completed":
            break

    completed = attrs.get("status") == "completed"
    return {
        "type": "url",
        "target": url,
        "found": True,
        "status": "completed" if completed else "queued",
        "stats": _stats(attrs.get("stats")),
        "flagged": _flagged(attrs.get("results")),
        "reputation": None,
        "votes": None,
        "categories": [],
        "tags": [],
        "lastAnalysisAt": _ts(attrs.get("date")),
        "newlySubmitted": True,
    }


@router.post("")
async def virustotal(request: VTRequest, http_request: Request):
    headers = {"x-apikey": _api_key(http_request), "Accept": "application/json"}
    try:
        async with httpx.AsyncClient(headers=headers, timeout=20.0) as client:
            if request.type == "domain":
                return await _domain(client, normalize_domain(request.target))
            url, _host = normalize_url(request.target)
            return await _url(client, url)
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="VirusTotal timed out.")
    except httpx.RequestError as e:
        raise HTTPException(status_code=502, detail=f"VirusTotal error: {type(e).__name__}")
