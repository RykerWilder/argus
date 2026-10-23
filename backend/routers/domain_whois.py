"""WHOIS di un dominio.

Prima si prova RDAP (JSON strutturato, servizio ufficiale dei registri): il
server giusto per il TLD si ricava dal bootstrap IANA. Se il TLD non ha RDAP
(molti ccTLD, es. .it e .de) si ripiega sul WHOIS classico via python-whois.
In più si risolvono gli indirizzi IP del nome richiesto.
"""
import asyncio
import socket
import time
from datetime import date, datetime, timezone
from typing import Any, Optional

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from .domain_common import normalize_domain, registrable_domain

router = APIRouter()

IANA_BOOTSTRAP = "https://data.iana.org/rdap/dns.json"
BOOTSTRAP_TTL = 24 * 3600
_bootstrap: dict = {"at": 0.0, "map": {}}


class DomainRequest(BaseModel):
    domain: str = Field(..., description="Dominio o nome host, es. www.example.com")


# ── utilità ────────────────────────────────────────────────

def _iso(value: Any) -> Optional[str]:
    if value in (None, "", []):
        return None
    if isinstance(value, list):
        value = next((v for v in value if v), None)
        if value is None:
            return None
    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)
        return value.isoformat()
    if isinstance(value, date):
        return value.isoformat()
    return str(value)


def _as_list(value: Any) -> list:
    if value in (None, ""):
        return []
    return value if isinstance(value, list) else [value]


def _clean_list(values) -> list[str]:
    seen, out = set(), []
    for v in values:
        s = str(v).strip().rstrip(".")
        if s and s.lower() not in seen:
            seen.add(s.lower())
            out.append(s)
    return out


# ── RDAP ───────────────────────────────────────────────────

async def _rdap_base(client: httpx.AsyncClient, tld: str) -> Optional[str]:
    if time.monotonic() - _bootstrap["at"] > BOOTSTRAP_TTL or not _bootstrap["map"]:
        resp = await client.get(IANA_BOOTSTRAP, timeout=10.0)
        resp.raise_for_status()
        mapping = {}
        for tlds, urls in resp.json().get("services", []):
            https = [u for u in urls if u.startswith("https://")] or urls
            for t in tlds:
                mapping[t.lower()] = https[0]
        _bootstrap.update(at=time.monotonic(), map=mapping)
    return _bootstrap["map"].get(tld)


def _vcard(entity: dict) -> dict:
    out: dict = {}
    card = entity.get("vcardArray")
    if not (isinstance(card, list) and len(card) == 2):
        return out
    for item in card[1]:
        if not isinstance(item, list) or len(item) < 4:
            continue
        name, params, _type, value = item[0], item[1] or {}, item[2], item[3]
        if name == "fn":
            out["name"] = value
        elif name == "org":
            out["org"] = value[0] if isinstance(value, list) else value
        elif name == "email":
            out.setdefault("emails", []).append(value)
        elif name == "tel":
            out.setdefault("phones", []).append(str(value).replace("tel:", ""))
        elif name == "adr":
            label = params.get("label") if isinstance(params, dict) else None
            if isinstance(value, list):
                country = value[-1] if value and isinstance(value[-1], str) else None
                if country:
                    out["country"] = country
            if label:
                out["address"] = label
    return out


def _entities(items: list, found: list) -> list:
    for ent in items or []:
        found.append(ent)
        _entities(ent.get("entities"), found)
    return found


def _parse_rdap(name: str, data: dict) -> dict:
    events = {e.get("eventAction"): e.get("eventDate") for e in data.get("events", []) if e.get("eventAction")}
    entities = _entities(data.get("entities"), [])

    def with_role(role):
        return [e for e in entities if role in (e.get("roles") or [])]

    registrar = next(iter(with_role("registrar")), None)
    registrar_card = _vcard(registrar) if registrar else {}
    iana_id = None
    for pid in (registrar or {}).get("publicIds") or []:
        if "iana" in str(pid.get("type", "")).lower():
            iana_id = pid.get("identifier")

    registrant = next(iter(with_role("registrant")), None)
    registrant_card = _vcard(registrant) if registrant else {}

    abuse_emails, abuse_phones = [], []
    for ent in with_role("abuse"):
        card = _vcard(ent)
        abuse_emails += card.get("emails", [])
        abuse_phones += card.get("phones", [])

    return {
        "domain": (data.get("ldhName") or name).lower(),
        "source": "RDAP",
        "registrar": registrar_card.get("name") or registrar_card.get("org"),
        "registrarIanaId": iana_id,
        "createdAt": events.get("registration"),
        "updatedAt": events.get("last changed"),
        "expiresAt": events.get("expiration"),
        "status": _clean_list(data.get("status") or []),
        "nameServers": _clean_list((ns.get("ldhName") or "").lower() for ns in data.get("nameservers") or []),
        "dnssec": (data.get("secureDNS") or {}).get("delegationSigned"),
        "registrant": {
            "organization": registrant_card.get("org") or registrant_card.get("name"),
            "country": registrant_card.get("country"),
        },
        "abuse": {"emails": _clean_list(abuse_emails), "phones": _clean_list(abuse_phones)},
        "whoisServer": data.get("port43"),
    }


async def _rdap_lookup(client: httpx.AsyncClient, name: str) -> Optional[dict]:
    """None se il TLD non ha RDAP; solleva HTTPException se il dominio non esiste."""
    tld = name.rsplit(".", 1)[-1]
    base = await _rdap_base(client, tld)
    if not base:
        return None
    resp = await client.get(
        f"{base.rstrip('/')}/domain/{name}",
        headers={"Accept": "application/rdap+json"},
        timeout=12.0,
        follow_redirects=True,
    )
    if resp.status_code == 404:
        raise HTTPException(status_code=404, detail=f"{name} is not registered (RDAP).")
    if resp.status_code == 429:
        raise HTTPException(status_code=429, detail="RDAP registry rate limit reached.")
    resp.raise_for_status()
    return _parse_rdap(name, resp.json())


# ── WHOIS classico ─────────────────────────────────────────

def _whois_lookup(name: str) -> dict:
    from whois import whois as whois_query

    try:
        w = whois_query(name)
    except Exception as e:  # python-whois solleva eccezioni diverse per "non trovato"
        msg = str(e).lower()
        if "no match" in msg or "not found" in msg or "no entries" in msg:
            raise HTTPException(status_code=404, detail=f"{name} is not registered (WHOIS).")
        raise HTTPException(status_code=502, detail=f"WHOIS error: {type(e).__name__}")

    if not w or not w.get("domain_name"):
        raise HTTPException(status_code=404, detail=f"No WHOIS record found for {name}.")

    emails = _as_list(w.get("emails"))
    abuse = [e for e in emails if "abuse" in str(e).lower()] or emails

    return {
        "domain": name,
        "source": "WHOIS",
        "registrar": w.get("registrar"),
        "registrarIanaId": w.get("registrar_iana") or w.get("registrar_id"),
        "createdAt": _iso(w.get("creation_date")),
        "updatedAt": _iso(w.get("updated_date")),
        "expiresAt": _iso(w.get("expiration_date")),
        "status": _clean_list(s.split(" ")[0] for s in _as_list(w.get("status"))),
        "nameServers": _clean_list(str(n).lower() for n in _as_list(w.get("name_servers"))),
        "dnssec": (str(w.get("dnssec")).lower().startswith("signed") if w.get("dnssec") else None),
        "registrant": {
            "organization": w.get("org") or w.get("registrant_organization") or w.get("registrant_name"),
            "country": w.get("country") or w.get("registrant_country"),
        },
        "abuse": {"emails": _clean_list(abuse), "phones": []},
        "whoisServer": w.get("whois_server"),
    }


# ── DNS ────────────────────────────────────────────────────

async def _resolve(host: str) -> dict:
    loop = asyncio.get_running_loop()
    try:
        infos = await asyncio.wait_for(loop.getaddrinfo(host, None, type=socket.SOCK_STREAM), 5.0)
    except (OSError, asyncio.TimeoutError):
        return {"ipv4": [], "ipv6": []}
    v4 = sorted({i[4][0] for i in infos if i[0] == socket.AF_INET})
    v6 = sorted({i[4][0] for i in infos if i[0] == socket.AF_INET6})
    return {"ipv4": v4, "ipv6": v6}


@router.post("")
async def domain_whois(request: DomainRequest):
    host = normalize_domain(request.domain)
    name = registrable_domain(host)

    async def lookup() -> dict:
        try:
            async with httpx.AsyncClient() as client:
                result = await _rdap_lookup(client, name)
        except HTTPException as e:
            if e.status_code == 404:
                raise
            result = None
        except (httpx.HTTPError, ValueError):
            result = None
        if result is None:
            result = await asyncio.to_thread(_whois_lookup, name)
        return result

    record, dns = await asyncio.gather(lookup(), _resolve(host))
    return {"query": host, **record, "resolves": dns}
