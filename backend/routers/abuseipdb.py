"""AbuseIPDB: reputazione e segnalazioni di abuso per un IP."""
from collections import Counter
from datetime import datetime, timedelta, timezone

import httpx
from fastapi import APIRouter, HTTPException, Request
from pydantic import Field

from .common import IPRequest, parse_ip, request_api_key, require_public

router = APIRouter()

ABUSEIPDB_URL = "https://api.abuseipdb.com/api/v2/check"
# Report singoli restituiti al frontend (per il dettaglio nella timeline).
# I conteggi giornalieri usano invece tutti i report ricevuti da AbuseIPDB.
MAX_REPORTS = 500

CATEGORY_MAP = {
    1: "DNS Compromise", 2: "DNS Poisoning", 3: "Fraud Orders",
    4: "DDoS Attack", 5: "FTP Brute-Force", 6: "Ping of Death",
    7: "Phishing", 8: "Fraud VoIP", 9: "Open Proxy",
    10: "Web Spam", 11: "Email Spam", 12: "Blog Spam",
    13: "VPN IP", 14: "Port Scan", 15: "Hacking",
    16: "SQL Injection", 17: "Spoofing", 18: "Brute-Force",
    19: "Bad Web Bot", 20: "Exploited Host", 21: "Web App Attack",
    22: "SSH", 23: "IoT Targeted",
}


class AbuseRequest(IPRequest):
    maxAgeInDays: int = Field(default=90, ge=1, le=365)


def _api_key(http_request: Request) -> str:
    key = request_api_key(http_request, "ABUSEIPDB_API_KEY")
    if not key:
        raise HTTPException(
            status_code=503,
            detail="No AbuseIPDB API key: add one in Settings or set ABUSEIPDB_API_KEY in .env.",
        )
    return key


@router.post("")
async def check_ip(request: AbuseRequest, http_request: Request):
    ip = require_public(parse_ip(request.ip))
    params = {"ipAddress": ip, "maxAgeInDays": request.maxAgeInDays, "verbose": ""}
    headers = {"Key": _api_key(http_request), "Accept": "application/json"}

    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(ABUSEIPDB_URL, params=params, headers=headers, timeout=15.0)
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="AbuseIPDB timed out.")
    except httpx.RequestError as e:
        raise HTTPException(status_code=502, detail=f"AbuseIPDB error: {type(e).__name__}")

    if resp.status_code == 401:
        raise HTTPException(status_code=401, detail="Invalid AbuseIPDB API key.")
    if resp.status_code == 422:
        raise HTTPException(status_code=422, detail="AbuseIPDB rejected this IP.")
    if resp.status_code == 429:
        raise HTTPException(status_code=429, detail="AbuseIPDB rate limit reached.")
    if resp.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"AbuseIPDB responded with HTTP {resp.status_code}.")

    d = resp.json().get("data", {})
    raw_reports = d.get("reports") or []

    category_counts: Counter = Counter()
    reporter_countries: Counter = Counter()
    for r in raw_reports:
        for c in r.get("categories") or []:
            category_counts[CATEGORY_MAP.get(c, f"Category {c}")] += 1
        if r.get("reporterCountryCode"):
            reporter_countries[r["reporterCountryCode"]] += 1

    raw_reports = sorted(raw_reports, key=lambda r: r.get("reportedAt") or "", reverse=True)
    reports = [
        {
            "reportedAt": r.get("reportedAt"),
            "comment": (r.get("comment") or "").strip(),
            "categories": [CATEGORY_MAP.get(c, f"Category {c}") for c in r.get("categories") or []],
            "reporterId": r.get("reporterId"),
            "reporterCountry": r.get("reporterCountryCode"),
            "reporterCountryName": r.get("reporterCountryName"),
        }
        for r in raw_reports[:MAX_REPORTS]
    ]

    # Report per giorno (UTC) su tutta la finestra, giorni senza report compresi.
    per_day: Counter = Counter()
    for r in raw_reports:
        try:
            day = datetime.fromisoformat(str(r.get("reportedAt")).replace("Z", "+00:00")).astimezone(timezone.utc).date()
        except ValueError:
            continue
        per_day[day] += 1
    today = datetime.now(timezone.utc).date()
    start = today - timedelta(days=request.maxAgeInDays - 1)
    daily = [
        {"date": (start + timedelta(days=i)).isoformat(), "count": per_day.get(start + timedelta(days=i), 0)}
        for i in range(request.maxAgeInDays)
    ]

    return {
        "ip": d.get("ipAddress"),
        "maxAgeInDays": request.maxAgeInDays,
        "abuseScore": d.get("abuseConfidenceScore", 0),
        "isWhitelisted": bool(d.get("isWhitelisted")),
        "isTor": bool(d.get("isTor")),
        "countryCode": d.get("countryCode"),
        "usageType": d.get("usageType"),
        "isp": d.get("isp"),
        "domain": d.get("domain"),
        "hostnames": d.get("hostnames") or [],
        "totalReports": d.get("totalReports", 0),
        "numDistinctUsers": d.get("numDistinctUsers", 0),
        "lastReportedAt": d.get("lastReportedAt"),
        "categories": [{"name": n, "count": c} for n, c in category_counts.most_common()],
        "reporterCountries": [{"code": k, "count": v} for k, v in reporter_countries.most_common(10)],
        "reports": reports,
        "reportsReceived": len(raw_reports),
        "daily": daily,
    }
