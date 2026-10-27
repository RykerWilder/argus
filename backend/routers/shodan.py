"""Shodan: porte aperte, servizi, software e CVE di un IP.

Due modalità:

- Senza API key si usa InternetDB (https://internetdb.shodan.io): porte,
  hostname, tag, software (CPE) e CVE. È gratuito per scopi non commerciali, i
  dati vengono aggiornati ogni settimana e le risposte restano in cache per
  un'ora. Un IP senza dati risponde 404: non è un errore, Shodan non ha
  semplicemente visto nulla su quell'indirizzo.
- Con una API key (header X-Argus-Api-Key, impostata in Settings) si usa
  l'endpoint completo /shodan/host/{ip}, che restituisce anche i servizi con
  banner, certificati TLS, SSH, sistema operativo, organizzazione e dettagli
  delle CVE. Se il piano della chiave non permette questa chiamata si ripiega
  su InternetDB e la risposta riporta un avviso.

La risposta ha sempre la stessa forma. I campi che esistono solo con la chiave
sono vuoti in modalità InternetDB. Dell'API completa si riporta tutto quello
che Shodan restituisce, tranne i dati pesanti o i link a siti di terzi: HTML
delle pagine, catene di certificati in PEM, dati dell'icona, contenuto di
robots.txt, sitemap e security.txt, riferimenti delle CVE.
"""
import re
import time
from datetime import datetime, timezone
from typing import Any, Iterator, Optional

import httpx
from fastapi import APIRouter, HTTPException, Request

from .common import IPRequest, parse_ip, request_api_key, require_public

router = APIRouter()

INTERNETDB_URL = "https://internetdb.shodan.io/{ip}"
API_HOST_URL = "https://api.shodan.io/shodan/host/{ip}"

CACHE_TTL = 3600
CACHE_MAX_ENTRIES = 1000
_cache: dict[str, tuple[float, dict]] = {}

MAX_VALUE = 600  # caratteri di un singolo valore
MAX_ITEMS = 40  # elementi di una lista
MAX_BANNER = 6000  # caratteri del banner di un servizio

_CVE = re.compile(r"CVE-(\d{4})-(\d{4,})", re.IGNORECASE)


class _NotAllowed(Exception):
    """Il piano della chiave non permette la ricerca per IP."""


# ── Cache (solo InternetDB) ────────────────────────────────


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


# ── Valori ─────────────────────────────────────────────────


def _strings(value: Any) -> list[str]:
    """Le stringhe non vuote di una lista, senza doppioni e nell'ordine di arrivo."""
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


def _cve_key(cve: str) -> tuple[int, int]:
    m = _CVE.fullmatch(cve)
    return (int(m.group(1)), int(m.group(2))) if m else (0, 0)


def _cves(value: Any) -> list[str]:
    """Gli identificativi CVE validi (da una lista o dalle chiavi di un dizionario), dal più recente."""
    items = list(value) if isinstance(value, dict) else _strings(value)
    found = {c.strip().upper() for c in items if isinstance(c, str) and _CVE.fullmatch(c.strip())}
    return sorted(found, key=_cve_key, reverse=True)


def _label(key: str) -> str:
    text = key.strip("_").replace("_", " ").strip()
    return text[:1].upper() + text[1:] if text else key


def _text(value: Any) -> Optional[str]:
    if value is None or isinstance(value, (dict, list)):
        return None
    if isinstance(value, bool):
        return "Yes" if value else "No"
    text = str(value).strip()
    if not text:
        return None
    return text if len(text) <= MAX_VALUE else text[:MAX_VALUE] + "…"


def _item(value: Any) -> Optional[str]:
    """Un valore qualsiasi come testo: le liste si uniscono con la virgola, i dizionari in "chiave: valore"."""
    if isinstance(value, dict):
        parts = [f"{_label(str(k))}: {t}" for k, v in value.items() if (t := _item(v))]
        return "; ".join(parts) or None
    if isinstance(value, list):
        shown = [t for v in value[:MAX_ITEMS] if (t := _item(v))]
        if len(value) > MAX_ITEMS:
            shown.append(f"+{len(value) - MAX_ITEMS} more")
        return ", ".join(shown) or None
    return _text(value)


def _when(text: str) -> str:
    """Data e ora di Shodan ("2026-10-20T10:11:12.1", "20261020101112Z") in "2026-10-20 10:11 UTC"."""
    for fmt in ("%Y%m%d%H%M%SZ", "%Y-%m-%dT%H:%M:%S.%f", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%dT%H:%M:%S.%f%z", "%Y-%m-%dT%H:%M:%S%z"):
        try:
            parsed = datetime.strptime(text, fmt)
        except ValueError:
            continue
        if parsed.tzinfo:
            parsed = parsed.astimezone(timezone.utc)
        return parsed.strftime("%Y-%m-%d %H:%M UTC")
    return text


def _leaves(obj: dict, skip: set[str], prefix: str = "") -> Iterator[tuple[str, str]]:
    """Ogni valore foglia di un dizionario annidato come (percorso, testo); `skip` esclude percorsi interi."""
    for key, value in obj.items():
        path = f"{prefix}{key}"
        if path in skip:
            continue
        if isinstance(value, dict):
            yield from _leaves(value, skip, path + ".")
        elif (text := _item(value)) is not None:
            yield path, text


def _rows(
    obj: dict,
    labels: dict[str, str],
    skip: set[str] | frozenset[str] = frozenset(),
    mono: set[str] | frozenset[str] = frozenset(),
    dates: set[str] | frozenset[str] = frozenset(),
) -> list[dict]:
    """Righe {label, value, mono}: prima i percorsi noti, nell'ordine di `labels`, poi tutti gli altri."""
    leaves = dict(_leaves(obj, set(skip)))
    rows = []

    def add(path: str, label: str) -> None:
        value = leaves.pop(path)
        rows.append({"label": label, "value": _when(value) if path in dates else value, "mono": path in mono})

    for path, label in labels.items():
        if path in leaves:
            add(path, label)
    for path in list(leaves):
        add(path, " › ".join(_label(p) for p in path.split(".")))
    return rows


# ── Servizi (API completa) ─────────────────────────────────

SERVICE_LABELS = {
    "product": "Product",
    "version": "Version",
    "_shodan.module": "Module",
    "transport": "Transport",
    "timestamp": "Last seen",
    "org": "Organization",
    "isp": "ISP",
    "asn": "ASN",
    "os": "Operating system",
    "device": "Device",
    "devicetype": "Device type",
    "info": "Info",
    "hostnames": "Hostnames",
    "domains": "Domains",
    "cpe": "CPE",
    "tags": "Tags",
    "hash": "Banner hash",
}
SERVICE_SKIP = {"data", "port", "ip", "ip_str", "ssl", "http", "ssh", "vulns", "location", "opts", "cpe23", "_shodan.id"}

HTTP_LABELS = {
    "title": "Title",
    "server": "Server",
    "status": "Status code",
    "host": "Host",
    "location": "Location",
    "waf": "WAF",
    "html_hash": "HTML hash",
    "headers_hash": "Headers hash",
    "favicon.hash": "Favicon hash",
    "robots_hash": "robots.txt hash",
    "sitemap_hash": "Sitemap hash",
    "securitytxt_hash": "security.txt hash",
}
HTTP_SKIP = {"html", "favicon.data", "robots", "sitemap", "securitytxt", "components", "redirects"}
HTTP_MONO = {"html_hash", "headers_hash", "favicon.hash", "robots_hash", "sitemap_hash", "securitytxt_hash"}

SSL_LABELS = {
    "cert.subject.CN": "Subject (CN)",
    "cert.subject.O": "Subject organization",
    "cert.issuer.CN": "Issuer (CN)",
    "cert.issuer.O": "Issuer organization",
    "cert.issued": "Issued",
    "cert.expires": "Expires",
    "cert.expired": "Expired",
    "cert.serial": "Serial number",
    "cert.version": "Certificate version",
    "cert.sig_alg": "Signature algorithm",
    "cert.fingerprint.sha1": "SHA-1 fingerprint",
    "cert.fingerprint.sha256": "SHA-256 fingerprint",
    "versions": "TLS versions",
    "cipher.name": "Cipher",
    "cipher.version": "Cipher protocol",
    "cipher.bits": "Cipher bits",
    "alpn": "ALPN",
    "ja3s": "JA3S",
    "jarm": "JARM",
}
SSL_SKIP = {"chain", "chain_sha256", "acceptable_cas", "dhparams.prime", "dhparams.public_key"}
SSL_MONO = {"cert.serial", "cert.fingerprint.sha1", "cert.fingerprint.sha256", "ja3s", "jarm"}
SSL_DATES = {"cert.issued", "cert.expires"}

SSH_LABELS = {
    "type": "Key type",
    "fingerprint": "Key fingerprint",
    "hassh": "HASSH",
    "mac": "MAC",
    "cipher": "Cipher",
    "key": "Public key",
    "kex.kex_algorithms": "Key exchange algorithms",
    "kex.server_host_key_algorithms": "Host key algorithms",
    "kex.encryption_algorithms": "Encryption algorithms",
    "kex.mac_algorithms": "MAC algorithms",
    "kex.compression_algorithms": "Compression algorithms",
}
SSH_MONO = {"fingerprint", "hassh", "mac", "key"}


def _dict(value: Any) -> dict:
    return value if isinstance(value, dict) else {}


def _technologies(components: Any) -> Optional[str]:
    """Le tecnologie web rilevate ("jQuery 3.5.1, Nginx")."""
    items = []
    for name, info in _dict(components).items():
        versions = _strings(_dict(info).get("versions"))
        items.append(" ".join([str(name), ", ".join(versions)]).strip())
    return ", ".join(items[:MAX_ITEMS]) or None


def _redirects(redirects: Any) -> Optional[str]:
    if not isinstance(redirects, list):
        return None
    hops = [_text(r.get("location")) or _text(r.get("host")) for r in redirects if isinstance(r, dict)]
    return ", ".join(h for h in hops[:MAX_ITEMS] if h) or None


def _vuln_details(banner: dict) -> dict[str, dict]:
    """Le CVE di un servizio con i dettagli di Shodan (CVSS, riassunto, verificata, altri campi)."""
    out: dict[str, dict] = {}
    raw = banner.get("vulns")
    if isinstance(raw, dict):
        for vid, info in raw.items():
            if isinstance(vid, str) and _CVE.fullmatch(vid.strip()):
                out[vid.strip().upper()] = _dict(info)
    else:
        for vid in _cves(raw):
            out[vid] = {}
    return out


def _service(banner: dict) -> dict:
    port = banner.get("port")
    ports = _ports([port])
    sections = []

    core = _rows(banner, SERVICE_LABELS, SERVICE_SKIP, mono={"hash", "asn"}, dates={"timestamp"})
    if core:
        sections.append({"title": "Service", "rows": core})

    http = _dict(banner.get("http"))
    if http:
        rows = _rows(http, HTTP_LABELS, HTTP_SKIP, mono=HTTP_MONO)
        if tech := _technologies(http.get("components")):
            rows.append({"label": "Technologies", "value": tech, "mono": False})
        if hops := _redirects(http.get("redirects")):
            rows.append({"label": "Redirects", "value": hops, "mono": False})
        if rows:
            sections.append({"title": "HTTP", "rows": rows})

    ssl = _dict(banner.get("ssl"))
    if ssl:
        if rows := _rows(ssl, SSL_LABELS, SSL_SKIP, mono=SSL_MONO, dates=SSL_DATES):
            sections.append({"title": "TLS", "rows": rows})

    ssh = _dict(banner.get("ssh"))
    if ssh:
        if rows := _rows(ssh, SSH_LABELS, mono=SSH_MONO):
            sections.append({"title": "SSH", "rows": rows})

    data = banner.get("data")
    text = data.strip() if isinstance(data, str) else ""
    banner_text = (text if len(text) <= MAX_BANNER else text[:MAX_BANNER] + "\n…") or None

    return {
        "port": ports[0] if ports else None,
        "transport": _text(banner.get("transport")),
        "module": _text(_dict(banner.get("_shodan")).get("module")),
        "product": _text(banner.get("product")),
        "version": _text(banner.get("version")),
        "timestamp": _when(t) if (t := _text(banner.get("timestamp"))) else None,
        "tags": _strings(banner.get("tags")),
        "vulns": list(_vuln_details(banner)),
        "sections": sections,
        "banner": banner_text,
    }


def _cvss(value: Any) -> Optional[float]:
    try:
        return float(value) if value is not None and not isinstance(value, bool) else None
    except (TypeError, ValueError):
        return None


def _normalize_vulns(host: dict, banners: list[dict]) -> tuple[list[str], list[dict]]:
    """Gli ID delle CVE e i loro dettagli, dalla più grave (CVSS) alla meno."""
    details: dict[str, dict] = {}
    for vid in _cves(host.get("vulns")):
        details[vid] = {"id": vid, "cvss": None, "summary": None, "verified": None, "ports": [], "extra": None}
    for banner in banners:
        port = banner.get("port") if isinstance(banner.get("port"), int) else None
        for vid, info in _vuln_details(banner).items():
            d = details.setdefault(vid, {"id": vid, "cvss": None, "summary": None, "verified": None, "ports": [], "extra": None})
            d["cvss"] = d["cvss"] if d["cvss"] is not None else _cvss(info.get("cvss"))
            d["summary"] = d["summary"] or _text(info.get("summary"))
            if isinstance(info.get("verified"), bool):
                d["verified"] = d["verified"] or info["verified"]
            if port is not None and port not in d["ports"]:
                d["ports"].append(port)
            rest = {k: v for k, v in info.items() if k not in ("cvss", "summary", "verified", "references")}
            d["extra"] = d["extra"] or _item(rest)
    ordered = sorted(details.values(), key=lambda d: (-(d["cvss"] if d["cvss"] is not None else -1), tuple(-n for n in _cve_key(d["id"]))))
    for d in ordered:
        d["ports"].sort()
    return [d["id"] for d in ordered], ordered


HOST_SKIP = {
    "data", "vulns", "ports", "hostnames", "domains", "tags", "ip", "ip_str", "org", "isp", "asn", "os", "last_update",
    "country_name", "country_code", "city", "region_code", "postal_code", "latitude", "longitude", "location",
}


def _first(*values: Any) -> Any:
    return next((v for v in values if v not in (None, "")), None)


def _normalize_api(ip: str, body: dict | None) -> dict:
    """La risposta di /shodan/host/{ip}. `body` è None quando Shodan non ha dati sull'IP (HTTP 404)."""
    if body is None:
        return _empty(ip, found=False, source="api")
    host = body
    loc = _dict(host.get("location"))
    banners = [b for b in host.get("data", []) if isinstance(b, dict)] if isinstance(host.get("data"), list) else []
    services = [_service(b) for b in banners]
    services.sort(key=lambda s: (s["port"] is None, s["port"] or 0, s["transport"] or ""))
    vuln_ids, vuln_details = _normalize_vulns(host, banners)

    cpes: dict[str, None] = {}
    for b in banners:
        for c in _strings(b.get("cpe")) + _strings(b.get("cpe23")):
            cpes.setdefault(c, None)
    hostnames = list(dict.fromkeys(_strings(host.get("hostnames")) + [h for b in banners for h in _strings(b.get("hostnames"))]))
    domains = list(dict.fromkeys(_strings(host.get("domains")) + [d for b in banners for d in _strings(b.get("domains"))]))
    tags = list(dict.fromkeys(_strings(host.get("tags")) + [t for b in banners for t in _strings(b.get("tags"))]))

    last_update = _text(host.get("last_update"))
    return {
        **_empty(ip, found=True, source="api"),
        "ports": _ports(_list(host.get("ports")) + [b.get("port") for b in banners]),
        "hostnames": hostnames,
        "domains": domains,
        "tags": tags,
        "vulns": vuln_ids,
        "cpes": list(cpes),
        "org": _text(host.get("org")),
        "isp": _text(host.get("isp")),
        "asn": _text(host.get("asn")),
        "os": _text(host.get("os")),
        "lastUpdate": _when(last_update) if last_update else None,
        "location": {
            "country": _text(_first(host.get("country_name"), loc.get("country_name"))),
            "countryCode": _text(_first(host.get("country_code"), loc.get("country_code"))),
            "city": _text(_first(host.get("city"), loc.get("city"))),
            "region": _text(_first(host.get("region_code"), loc.get("region_code"))),
            "postalCode": _text(_first(host.get("postal_code"), loc.get("postal_code"))),
            "lat": _first(host.get("latitude"), loc.get("latitude")),
            "lon": _first(host.get("longitude"), loc.get("longitude")),
        },
        "services": services,
        "vulnDetails": vuln_details,
        "extra": _rows(host, {}, HOST_SKIP),
    }


def _list(value: Any) -> list:
    return value if isinstance(value, list) else []


# ── InternetDB ─────────────────────────────────────────────


def _empty(ip: str, *, found: bool, source: str) -> dict:
    return {
        "ip": ip,
        "found": found,
        "source": source,
        "warning": None,
        "ports": [],
        "hostnames": [],
        "domains": [],
        "tags": [],
        "vulns": [],
        "cpes": [],
        "org": None,
        "isp": None,
        "asn": None,
        "os": None,
        "lastUpdate": None,
        "location": None,
        "services": [],
        "vulnDetails": [],
        "extra": [],
    }


def _normalize(ip: str, body: dict | None) -> dict:
    """`body` è None quando Shodan non ha dati sull'IP (HTTP 404)."""
    if body is None:
        return _empty(ip, found=False, source="internetdb")
    return {
        **_empty(ip, found=True, source="internetdb"),
        "ports": _ports(body.get("ports")),
        "hostnames": _strings(body.get("hostnames")),
        "tags": _strings(body.get("tags")),
        "vulns": _cves(body.get("vulns")),
        "cpes": _strings(body.get("cpes")),
    }


async def _get(url: str, **params: Any) -> httpx.Response:
    try:
        async with httpx.AsyncClient() as client:
            return await client.get(url, params=params or None, timeout=20.0)
    except httpx.TimeoutException:
        raise HTTPException(status_code=504, detail="Shodan timed out.")
    except httpx.RequestError as e:
        # solo il tipo dell'errore: il messaggio potrebbe contenere l'URL con la chiave
        raise HTTPException(status_code=502, detail=f"Shodan error: {type(e).__name__}")


def _json_object(resp: httpx.Response) -> dict:
    try:
        body = resp.json()
    except ValueError:
        raise HTTPException(status_code=502, detail="Shodan returned an unreadable response.")
    if not isinstance(body, dict):
        raise HTTPException(status_code=502, detail="Shodan returned an unexpected response.")
    return body


def _error_text(resp: httpx.Response) -> str:
    try:
        body = resp.json()
    except ValueError:
        return f"HTTP {resp.status_code}"
    message = body.get("error") if isinstance(body, dict) else None
    return _text(message) or f"HTTP {resp.status_code}"


async def _fetch_internetdb(ip: str) -> dict | None:
    resp = await _get(INTERNETDB_URL.format(ip=ip))
    if resp.status_code == 404:
        return None
    if resp.status_code == 429:
        raise HTTPException(status_code=429, detail="Shodan InternetDB rate limit reached.")
    if resp.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"Shodan InternetDB responded with HTTP {resp.status_code}.")
    return _json_object(resp)


async def _fetch_api(ip: str, key: str) -> dict | None:
    resp = await _get(API_HOST_URL.format(ip=ip), key=key)
    if resp.status_code == 404:
        return None
    if resp.status_code == 401:
        raise HTTPException(status_code=401, detail="Invalid Shodan API key.")
    if resp.status_code in (402, 403):
        raise _NotAllowed(_error_text(resp))
    if resp.status_code == 429:
        raise HTTPException(status_code=429, detail="Shodan rate limit reached (1 request per second).")
    if resp.status_code >= 400:
        raise HTTPException(status_code=502, detail=f"Shodan responded with {_error_text(resp)}.")
    return _json_object(resp)


async def _internetdb(ip: str) -> dict:
    cached = _cache_get(ip)
    if cached is None:
        cached = _normalize(ip, await _fetch_internetdb(ip))
        _cache_set(ip, cached)
    return cached


@router.post("")
async def shodan(request: IPRequest, http_request: Request):
    ip = require_public(parse_ip(request.ip))
    key = request_api_key(http_request)
    if not key:
        return await _internetdb(ip)
    try:
        return _normalize_api(ip, await _fetch_api(ip, key))
    except _NotAllowed as e:
        result = await _internetdb(ip)
        return {**result, "warning": f"Your Shodan API plan does not allow host lookups ({e}). Showing InternetDB data instead."}
