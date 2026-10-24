"""Scomposizione di un nome host: sottodominio, nome registrato e suffisso pubblico.

Usa la Public Suffix List inclusa in tldextract, così "www.bbc.co.uk" diventa
sottodominio "www", nome "bbc", suffisso "co.uk".
"""
from fastapi import APIRouter, Query

from .domain_common import _extract, normalize_domain
from .ip_utils import as_ip

router = APIRouter()


@router.get("")
async def fqdn_parts(host: str = Query(..., description="Nome host, es. www.bbc.co.uk")):
    raw = (host or "").strip().strip("[]")
    if as_ip(raw) is not None:
        return {"host": raw, "isIp": True, "subdomain": None, "domain": None, "suffix": None, "registrable": None}
    name = normalize_domain(raw)
    ext = _extract(name)
    registrable = f"{ext.domain}.{ext.suffix}" if ext.domain and ext.suffix else None
    return {
        "host": name,
        "isIp": False,
        "subdomain": ext.subdomain or None,
        "domain": ext.domain or None,
        "suffix": ext.suffix or None,
        "registrable": registrable,
    }
