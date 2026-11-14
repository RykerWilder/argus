"""Helpers shared by the domain and URL routers."""
import re
from urllib.parse import urlsplit

import tldextract
from fastapi import HTTPException

from app.lookups.net import as_ip

# Public Suffix List bundled with the package: no network request, no disk cache.
tld_extract = tldextract.TLDExtract(suffix_list_urls=(), cache_dir=None)

_LABEL = re.compile(r"^(?!-)[a-z0-9-]{1,63}(?<!-)$")


def normalize_domain(raw: str) -> str:
    """Validates a host name and returns it lowercase and in punycode (IDN)."""
    host = (raw or "").strip().rstrip(".").lower()
    if not host:
        raise HTTPException(status_code=400, detail="Enter a domain name.")
    try:
        host = host.encode("idna").decode("ascii")
    except UnicodeError:
        raise HTTPException(status_code=400, detail="Invalid domain name.")
    labels = host.split(".")
    if len(host) > 253 or len(labels) < 2 or not all(_LABEL.match(label) for label in labels):
        raise HTTPException(status_code=400, detail="Invalid domain name.")
    if labels[-1].isdigit():
        raise HTTPException(status_code=400, detail="Invalid domain name.")
    return host


def registrable_domain(host: str) -> str:
    """www.google.co.uk -> google.co.uk (the name the WHOIS is done on)."""
    ext = tld_extract(host)
    if not ext.domain or not ext.suffix:
        raise HTTPException(status_code=422, detail="This is a public suffix, not a registrable domain.")
    return f"{ext.domain}.{ext.suffix}"


def normalize_url(raw: str) -> tuple[str, str]:
    """Returns (normalized url, host). Only http and https are accepted."""
    value = (raw or "").strip()
    if "://" not in value:
        value = "http://" + value
    parts = urlsplit(value)
    if parts.scheme not in ("http", "https") or not parts.hostname:
        raise HTTPException(status_code=400, detail="Invalid URL: only http and https addresses are supported.")
    host = parts.hostname
    if as_ip(host) is None:
        host = normalize_domain(host)
    return value, host
