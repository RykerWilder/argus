"""WHOIS di un indirizzo IP tramite RDAP (ipwhois).

Restituisce chi detiene il blocco di indirizzi: rete, registro regionale (RIR),
date di registrazione, organizzazione assegnataria e contatti abuse.
"""
import asyncio

from fastapi import APIRouter, HTTPException

from .common import IPRequest, parse_ip, require_public

router = APIRouter()


def _vcard_values(items) -> list[str]:
    out = []
    for item in items or []:
        value = item.get("value") if isinstance(item, dict) else item
        if value:
            out.append(str(value).strip())
    return out


def _events(events) -> dict:
    out = {}
    for ev in events or []:
        action = (ev or {}).get("action")
        if action and ev.get("timestamp"):
            out[action] = ev["timestamp"]
    return out


def _rdap_lookup(ip: str) -> dict:
    from ipwhois import IPWhois
    from ipwhois.exceptions import (
        ASNRegistryError,
        HTTPLookupError,
        HTTPRateLimitError,
        IPDefinedError,
    )

    try:
        result = IPWhois(ip, timeout=10).lookup_rdap(depth=1, inc_raw=False)
    except IPDefinedError:
        raise HTTPException(status_code=422, detail="Reserved address: no RDAP data.")
    except HTTPRateLimitError:
        raise HTTPException(status_code=429, detail="RDAP registry rate limit reached.")
    except (ASNRegistryError, HTTPLookupError) as e:
        raise HTTPException(status_code=502, detail=f"RDAP error: {e}")
    except Exception as e:  # ipwhois solleva molte eccezioni di rete diverse
        raise HTTPException(status_code=502, detail=f"RDAP error: {type(e).__name__}")

    network = result.get("network") or {}
    objects = result.get("objects") or {}

    contacts = []
    abuse_emails, abuse_phones = set(), set()
    for handle, ent in objects.items():
        ent = ent or {}
        roles = ent.get("roles") or []
        contact = ent.get("contact") or {}
        emails = _vcard_values(contact.get("email"))
        phones = _vcard_values(contact.get("phone"))
        if "abuse" in roles:
            abuse_emails.update(emails)
            abuse_phones.update(phones)
        contacts.append({
            "handle": handle,
            "name": contact.get("name"),
            "kind": contact.get("kind"),
            "roles": roles,
            "emails": emails,
            "address": " ".join(
                a.get("value", "") for a in (contact.get("address") or []) if isinstance(a, dict)
            ).strip() or None,
        })

    registrant = next(
        (c for c in contacts if "registrant" in c["roles"] and c["kind"] == "org"),
        next((c for c in contacts if "registrant" in c["roles"]), None),
    )

    remarks = []
    for r in network.get("remarks") or []:
        desc = (r or {}).get("description")
        if desc:
            remarks.append(desc.strip())

    events = _events(network.get("events"))

    return {
        "ip": ip,
        "registry": (result.get("asn_registry") or "").upper() or None,
        "asn": result.get("asn"),
        "asnCidr": result.get("asn_cidr"),
        "asnCountry": result.get("asn_country_code"),
        "asnDescription": result.get("asn_description"),
        "asnAllocated": result.get("asn_date"),
        "network": {
            "cidr": network.get("cidr"),
            "name": network.get("name"),
            "handle": network.get("handle"),
            "startAddress": network.get("start_address"),
            "endAddress": network.get("end_address"),
            "country": network.get("country"),
            "type": network.get("type"),
            "parentHandle": network.get("parent_handle"),
            "status": network.get("status") or [],
            "registered": events.get("registration"),
            "lastChanged": events.get("last changed"),
            "remarks": remarks,
        },
        "registrant": registrant,
        "abuse": {
            "emails": sorted(abuse_emails),
            "phones": sorted(abuse_phones),
        },
        "contacts": contacts,
    }


@router.post("")
async def whois_ip(request: IPRequest):
    ip = require_public(parse_ip(request.ip))
    return await asyncio.to_thread(_rdap_lookup, ip)
