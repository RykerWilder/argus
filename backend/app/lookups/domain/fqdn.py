"""Splitting a host name: subdomain, registered name and public suffix.

Uses the Public Suffix List bundled in tldextract, so "www.bbc.co.uk" becomes
subdomain "www", name "bbc", suffix "co.uk".
"""
from fastapi import APIRouter, Query

from app.lookups.domain.common import normalize_domain, tld_extract
from app.lookups.net import as_ip

router = APIRouter()


@router.get("")
async def fqdn_parts(host: str = Query(..., description="Host name, e.g. www.bbc.co.uk")):
    raw = (host or "").strip().strip("[]")
    if as_ip(raw) is not None:
        return {"host": raw, "isIp": True, "subdomain": None, "domain": None, "suffix": None, "registrable": None}
    name = normalize_domain(raw)
    ext = tld_extract(name)
    registrable = f"{ext.domain}.{ext.suffix}" if ext.domain and ext.suffix else None
    return {
        "host": name,
        "isIp": False,
        "subdomain": ext.subdomain or None,
        "domain": ext.domain or None,
        "suffix": ext.suffix or None,
        "registrable": registrable,
    }
