"""IP Tracker: geolocalizzazione e connessione via ip-api.com (nessuna API key),
più il prefisso BGP (CIDR) dell'IP via Team Cymru.
"""
import asyncio

import httpx
from fastapi import APIRouter, HTTPException

from .bgp import bgp_prefix
from .common import IPRequest, parse_ip, require_public

router = APIRouter()

IP_API_URL = "http://ip-api.com/json/{ip}"
IP_API_FIELDS = (
    "status,message,continent,continentCode,country,countryCode,region,"
    "regionName,city,district,zip,lat,lon,timezone,offset,currency,isp,org,"
    "as,asname,reverse,mobile,proxy,hosting,query"
)


@router.post("")
async def track_ip(request: IPRequest):
    addr = parse_ip(request.ip)
    ip = require_public(addr)

    base = {
        "ip": ip,
        "version": addr.version,
        "isPrivate": addr.is_private,
        "isLoopback": addr.is_loopback,
        "isReserved": addr.is_reserved,
        "isGlobal": addr.is_global,
    }

    async def geo():
        async with httpx.AsyncClient() as client:
            return await client.get(IP_API_URL.format(ip=ip), params={"fields": IP_API_FIELDS}, timeout=10.0)

    bgp_task = asyncio.create_task(bgp_prefix(addr))
    try:
        resp = await geo()
        if resp.status_code == 429:
            raise HTTPException(status_code=429, detail="ip-api.com rate limit reached.")
        resp.raise_for_status()
        data = resp.json()
    except httpx.TimeoutException:
        bgp_task.cancel()
        raise HTTPException(status_code=504, detail="Geolocation service timed out.")
    except httpx.HTTPError as e:
        bgp_task.cancel()
        raise HTTPException(status_code=502, detail=f"Geolocation error: {type(e).__name__}")
    except HTTPException:
        bgp_task.cancel()
        raise

    if data.get("status") != "success":
        bgp_task.cancel()
        raise HTTPException(status_code=422, detail=data.get("message", "Lookup failed."))

    bgp = await bgp_task
    asn_raw = data.get("as") or ""
    asn = asn_raw.split(" ", 1)[0] if asn_raw.startswith("AS") else None

    return {
        **base,
        "location": {
            "continent": data.get("continent"),
            "continentCode": data.get("continentCode"),
            "country": data.get("country"),
            "countryCode": data.get("countryCode"),
            "region": data.get("regionName"),
            "regionCode": data.get("region"),
            "city": data.get("city"),
            "district": data.get("district") or None,
            "zip": data.get("zip") or None,
            "lat": data.get("lat"),
            "lon": data.get("lon"),
            "timezone": data.get("timezone"),
            "utcOffset": data.get("offset"),
            "currency": data.get("currency"),
        },
        "connection": {
            "isp": data.get("isp") or None,
            "org": data.get("org") or None,
            "asn": asn,
            "asName": data.get("asname") or None,
            "reverse": data.get("reverse") or None,
            "isMobile": bool(data.get("mobile")),
            "isProxy": bool(data.get("proxy")),
            "isHosting": bool(data.get("hosting")),
        },
        "network": bgp,
    }
