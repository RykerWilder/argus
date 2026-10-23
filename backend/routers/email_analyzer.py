"""Email header analyzer: POST /api/email/analyze.

Riceve header incollati, un file .eml o un file .msg (in base64), li analizza e
risponde con il report. Niente viene salvato né registrato: l'email esiste
solo in memoria per la durata della richiesta.

I controlli di autenticazione (SPF, DKIM, DMARC, ARC) sono quelli scritti negli
header dai server che hanno ricevuto il messaggio: non vengono rifatti in tempo
reale. L'unica richiesta esterna è la geolocalizzazione degli IP pubblici dei
server attraversati (ip-api.com), per la mappa del percorso.
"""
from __future__ import annotations

import base64
import binascii
import ipaddress
import re
from datetime import datetime, timezone
from typing import Optional

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from . import email_parse as ep
from .domain_common import _extract

router = APIRouter()

MAX_FILE_BYTES = 25 * 1024 * 1024
MAX_TEXT_CHARS = 2_000_000
IP_API_BATCH = "http://ip-api.com/batch"
GEO_FIELDS = "status,query,country,countryCode,regionName,city,lat,lon,isp,org,as"


class EmailRequest(BaseModel):
    text: Optional[str] = Field(default=None, max_length=MAX_TEXT_CHARS, description="Header (o messaggio intero) incollati")
    filename: Optional[str] = Field(default=None, max_length=255)
    content: Optional[str] = Field(default=None, description="File .eml o .msg in base64")


def registrable(domain: Optional[str]) -> Optional[str]:
    if not domain:
        return None
    domain = domain.strip().strip(".").lower()
    ext = _extract(domain)
    return f"{ext.domain}.{ext.suffix}" if ext.domain and ext.suffix else domain


def iso(d: Optional[datetime]) -> Optional[str]:
    return d.isoformat() if d else None


# ── Autenticazione ─────────────────────────────────────────

def authentication(parsed: ep.ParsedEmail) -> dict:
    results = [ep.parse_auth_results(v) for v in parsed.get_all("Authentication-Results")]
    arc_results = [ep.parse_auth_results(v) for v in parsed.get_all("ARC-Authentication-Results")]

    def first(method):
        # il primo Authentication-Results è quello aggiunto dal server che ha consegnato la mail
        for r in results:
            for m in r["methods"]:
                if m["method"] == method:
                    return {**m, "server": r["server"]}
        return None

    spf = first("spf")
    if not spf:
        rspf = parsed.get("Received-SPF")
        if rspf:
            res = rspf.split()[0].lower().strip("()") if rspf.split() else None
            ip_m = re.search(r"client-ip=([^\s;]+)", rspf)
            mf = re.search(r"envelope-from=<?([^\s;>]+)", rspf)
            spf = {"method": "spf", "result": res, "comment": rspf, "props": {"smtp.mailfrom": mf.group(1) if mf else None, "client-ip": ip_m.group(1) if ip_m else None}, "server": "Received-SPF"}

    dkims = []
    for r in results[:1] or []:
        dkims = [{**m, "server": r["server"]} for m in r["methods"] if m["method"] == "dkim"]
    signatures = []
    for v in parsed.get_all("DKIM-Signature"):
        tags = ep.parse_tags(v)
        signatures.append({"domain": (tags.get("d") or "").lower() or None, "selector": tags.get("s"), "algorithm": tags.get("a"),
                           "headers": [h.strip() for h in (tags.get("h") or "").split(":") if h.strip()]})

    arc = first("arc")
    seals = [ep.parse_tags(v) for v in parsed.get_all("ARC-Seal")]
    if not arc and seals:
        top = max(seals, key=lambda t: int(t.get("i", "0") or 0))
        arc = {"method": "arc", "result": (top.get("cv") or "").lower() or None, "comment": "chain validation of the last ARC-Seal", "props": {}, "server": top.get("d")}

    return {
        "spf": spf,
        "dkim": dkims[0] if dkims else first("dkim"),
        "dkimAll": dkims,
        "dmarc": first("dmarc"),
        "arc": arc,
        "compauth": first("compauth"),
        "signatures": signatures,
        "results": results,
        "arcResults": arc_results,
    }


def spam_verdicts(parsed: ep.ParsedEmail) -> list[dict]:
    out = []
    fr = parsed.get("X-Forefront-Antispam-Report")
    if fr:
        f = dict(p.split(":", 1) for p in fr.split(";") if ":" in p)
        scl = f.get("SCL")
        sfv = f.get("SFV")
        labels = {"SPM": "spam", "SKS": "marked as spam by a rule", "SKB": "blocked sender", "BLK": "blocked sender", "NSPM": "not spam", "SKN": "marked as not spam by a rule", "SKA": "allowed sender", "SFE": "allowed by user", "SKI": "intra-organisation"}
        if scl is not None or sfv:
            out.append({
                "engine": "Microsoft 365",
                "value": f"SCL {scl}" if scl is not None else sfv,
                "detail": ", ".join(filter(None, [labels.get(sfv, sfv) if sfv else None, f"country {f['CTRY']}" if f.get("CTRY") else None, f"client IP {f['CIP']}" if f.get("CIP") else None])),
                "spam": (scl is not None and scl.lstrip("-").isdigit() and int(scl) >= 5) or sfv in ("SPM", "SKS", "SKB", "BLK"),
            })
    status = parsed.get("X-Spam-Status")
    if status:
        m = re.search(r"score=(-?[\d.]+)\s+required=(-?[\d.]+)", status)
        tests = re.search(r"tests=([^\s]+(?:\s*,\s*[^\s]+)*)", status)
        out.append({
            "engine": "SpamAssassin",
            "value": f"{m.group(1)} / {m.group(2)}" if m else status.split(",")[0],
            "detail": f"tests: {tests.group(1)}"[:400] if tests else None,
            "spam": status.strip().lower().startswith("yes"),
        })
    elif parsed.get("X-Spam-Flag"):
        out.append({"engine": "Spam filter", "value": parsed.get("X-Spam-Flag"), "detail": parsed.get("X-Spam-Score"), "spam": parsed.get("X-Spam-Flag").strip().lower() == "yes"})
    return out


# ── Percorso ───────────────────────────────────────────────

def route(parsed: ep.ParsedEmail) -> list[dict]:
    hops = [ep.parse_received(v) for v in parsed.get_all("Received")]
    hops.reverse()  # dal primo server (origine) all'ultimo (consegna)
    previous = None
    for i, hop in enumerate(hops, start=1):
        hop["index"] = i
        hop["delaySeconds"] = None
        if hop["date"] and previous:
            hop["delaySeconds"] = int((hop["date"] - previous).total_seconds())
        if hop["date"]:
            previous = hop["date"]
    return hops


def origin_ip(hops: list[dict], parsed: ep.ParsedEmail) -> Optional[dict]:
    for hop in hops:
        f = hop.get("from") or {}
        if f.get("ip") and f.get("public"):
            return {"ip": f["ip"], "host": f.get("rdns") or f.get("host"), "hop": hop["index"], "source": "Received"}
    for name in ("X-Originating-IP", "X-Sender-IP", "X-Client-IP"):
        ip = ep.find_ip(parsed.get(name) or "")
        if ep.is_public(ip):
            return {"ip": str(ip), "host": None, "hop": None, "source": name}
    return None


async def geolocate(ips: list[str]) -> tuple[dict, Optional[str]]:
    if not ips:
        return {}, None
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(IP_API_BATCH, params={"fields": GEO_FIELDS}, json=ips[:100], timeout=10.0)
        if resp.status_code == 429:
            return {}, "The map is not available right now: ip-api.com rate limit reached."
        resp.raise_for_status()
        out = {}
        for row in resp.json():
            if row.get("status") == "success":
                out[row["query"]] = {
                    "country": row.get("country"), "countryCode": row.get("countryCode"), "region": row.get("regionName"),
                    "city": row.get("city"), "lat": row.get("lat"), "lon": row.get("lon"),
                    "isp": row.get("isp"), "org": row.get("org"), "as": row.get("as"),
                }
        return out, None
    except (httpx.HTTPError, ValueError):
        return {}, "The map is not available: the servers' locations could not be looked up."


# ── Controlli ──────────────────────────────────────────────

GOOD = {"pass"}
BAD = {"fail", "hardfail"}
WEAK = {"softfail", "neutral", "none", "temperror", "permerror", "policy"}


def findings(summary: dict, auth: dict, hops: list[dict], spam: list[dict], parsed: ep.ParsedEmail) -> list[dict]:
    out = []

    def add(level, title, detail=None):
        out.append({"level": level, "title": title, "detail": detail})

    frm = summary.get("from") or {}
    from_dom = registrable(frm.get("domain"))

    spf, dkim, dmarc, comp = auth.get("spf"), auth.get("dkim"), auth.get("dmarc"), auth.get("compauth")
    if not any([spf, dkim, dmarc, comp]) and not auth["signatures"]:
        add("info", "No authentication results", "The headers contain no SPF, DKIM or DMARC results: the receiving server didn't record them, or only part of the headers was pasted.")

    if dmarc:
        r = dmarc["result"]
        if r in BAD:
            add("high", "DMARC failed", f"The receiving server checked the policy of {dmarc['props'].get('header.from') or from_dom or 'the sender domain'} and the message did not pass it.")
        elif r in GOOD:
            add("ok", "DMARC passed", f"Aligned with {dmarc['props'].get('header.from') or from_dom}.")
        else:
            add("medium", f"DMARC {r}", "The sender domain has no DMARC policy or it could not be evaluated." if r == "none" else None)
    if comp:
        if comp["result"] in BAD:
            add("high", "Microsoft composite authentication failed", f"compauth=fail{', reason ' + comp['props']['reason'] if comp['props'].get('reason') else ''}: Microsoft 365 considers the sender not authenticated.")
        elif comp["result"] == "softpass":
            add("medium", "Microsoft composite authentication: softpass", None)

    if spf:
        r = spf["result"]
        mailfrom = spf["props"].get("smtp.mailfrom") or ""
        mf_dom = registrable(mailfrom.rsplit("@", 1)[-1]) if mailfrom else None
        if r in BAD:
            add("high" if not (dkim and dkim["result"] in GOOD) else "medium", "SPF failed", f"The sending server is not allowed to send for {mailfrom or 'the envelope domain'}.")
        elif r in WEAK:
            add("medium", f"SPF {r}", f"No clear SPF answer for {mailfrom or 'the envelope domain'}.")
        elif r in GOOD and from_dom and mf_dom and mf_dom != from_dom:
            add("info", "SPF passed for another domain", f"SPF checked {mf_dom} (envelope sender), not {from_dom} (From). Common with mailing services; DMARC alignment decides.")
        elif r in GOOD:
            add("ok", "SPF passed", f"For {mf_dom or mailfrom}.")

    if dkim:
        r = dkim["result"]
        d = (dkim["props"].get("header.d") or dkim["props"].get("header.i", "").lstrip("@").split("@")[-1] or "").lower()
        d_dom = registrable(d) if d else None
        if r in BAD:
            add("medium", "DKIM signature failed", f"The signature of {d or 'the message'} did not verify: the message may have been altered.")
        elif r in GOOD and from_dom and d_dom and d_dom != from_dom:
            add("info", "DKIM signed by another domain", f"Signed by {d_dom}, while the sender is {from_dom}.")
        elif r in GOOD:
            add("ok", "DKIM passed", f"Signed by {d_dom or d}.")
        elif r in WEAK:
            add("medium", "Not DKIM-signed" if r == "none" else f"DKIM {r}",
                "The message carries no valid DKIM signature, so its content and sender can't be verified." if r == "none" else None)
    elif auth["signatures"] and not dmarc:
        add("info", "DKIM signature present, result not recorded", ", ".join(s["domain"] or "?" for s in auth["signatures"]))

    # mittente
    name = frm.get("name") or ""
    m = re.search(r"[\w.+-]+@([\w-]+(?:\.[\w-]+)+)", name)
    if m and from_dom and registrable(m.group(1)) != from_dom:
        add("high", "Display name shows another address", f"The name reads “{name}” but the message comes from {frm.get('address')}.")
    elif name and from_dom:
        dm = re.search(r"\b([a-z0-9-]+\.(?:com|net|org|it|de|fr|co\.uk|io|gov|edu))\b", name.lower())
        if dm and registrable(dm.group(1)) != from_dom:
            add("medium", "Display name mentions another domain", f"“{name}” but the sender domain is {from_dom}.")

    for rt in summary.get("replyTo") or []:
        if rt.get("domain") and from_dom and registrable(rt["domain"]) != from_dom:
            add("medium", "Reply-To goes to another domain", f"Replies go to {rt['address']}, not to {from_dom}.")
            break

    rp = summary.get("returnPath")
    if rp and rp.get("domain") and from_dom and registrable(rp["domain"]) != from_dom:
        add("info", "Return-Path differs from the sender", f"Bounces go to {rp['address']}. Normal for newsletters and mailing services.")

    mid = summary.get("messageId")
    if not mid:
        add("info", "No Message-ID", "Legitimate mail servers almost always add one.")
    else:
        md = re.search(r"@([^>\s]+)", mid)
        if md and from_dom and registrable(md.group(1)) not in (from_dom,) and "." in md.group(1):
            add("info", "Message-ID from another domain", f"Generated by {md.group(1)}.")

    if not summary.get("date"):
        add("info", "No Date header", None)
    else:
        sent = ep.parse_date(summary["date"])
        first = next((h["date"] for h in hops if h["date"]), None)
        now = datetime.now(timezone.utc)
        if sent and sent > now.replace(microsecond=0) and (sent - now).total_seconds() > 3600:
            add("medium", "Date in the future", f"The message claims to be sent on {sent.isoformat()}.")
        elif sent and first and abs((first - sent).total_seconds()) > 86400:
            add("info", "Date far from the first server", "The Date header and the first Received timestamp are more than a day apart.")

    for hop in hops:
        d = hop.get("delaySeconds")
        if d is not None and d < -300:
            add("info", f"Hop {hop['index']}: clock out of order", "This server's timestamp is earlier than the previous one (clock skew).")
        elif d is not None and d > 3600:
            add("medium", f"Hop {hop['index']}: delayed", f"{d // 3600} h {(d % 3600) // 60} min after the previous server.")

    if hops and not any(h.get("tls") for h in hops if h.get("from") and h["from"].get("public")):
        if any(h.get("from") and h["from"].get("public") for h in hops):
            add("info", "No TLS recorded between public servers", None)

    for s in spam:
        if s["spam"]:
            add("high", f"{s['engine']} marked it as spam", f"{s['value']}{' · ' + s['detail'] if s.get('detail') else ''}")

    if parsed.attachments:
        risky = [a.filename for a in parsed.attachments if re.search(r"\.(exe|scr|js|jse|vbs|vbe|wsf|hta|bat|cmd|ps1|lnk|iso|img|msi|jar|docm|xlsm|pptm|one|html?)$", a.filename or "", re.I)]
        if risky:
            add("medium", "Risky attachment type", ", ".join(risky[:5]))
    return out


def verdict(found: list[dict], auth: dict) -> dict:
    highs = [f["title"] for f in found if f["level"] == "high"]
    meds = [f["title"] for f in found if f["level"] == "medium"]
    has_auth = any(auth.get(k) for k in ("spf", "dkim", "dmarc", "compauth"))
    if highs:
        level, title = "high", "High risk"
    elif meds:
        level, title = "medium", "Suspicious"
    elif has_auth:
        level, title = "low", "No red flags"
    else:
        level, title = "unknown", "Not assessed"
    return {"level": level, "title": title, "reasons": highs + meds}


# ── Report ─────────────────────────────────────────────────

def build_report(parsed: ep.ParsedEmail) -> dict:
    g = parsed.get
    summary = {
        "subject": g("Subject"),
        "from": ep.parse_address(g("From")),
        "sender": ep.parse_address(g("Sender")),
        "replyTo": ep.parse_addresses(parsed.get_all("Reply-To")),
        "returnPath": ep.parse_address(g("Return-Path")),
        "to": ep.parse_addresses(parsed.get_all("To")),
        "cc": ep.parse_addresses(parsed.get_all("Cc")),
        "date": g("Date"),
        "dateIso": iso(ep.parse_date(g("Date"))),
        "messageId": g("Message-ID"),
        "mailer": g("X-Mailer") or g("User-Agent"),
    }
    auth = authentication(parsed)
    hops = route(parsed)
    spam = spam_verdicts(parsed)
    found = findings(summary, auth, hops, spam, parsed)
    origin = origin_ip(hops, parsed)

    first_date = next((h["date"] for h in hops if h["date"]), None)
    last_date = next((h["date"] for h in reversed(hops) if h["date"]), None)

    # indicatori: IP pubblici dei server, domini del mittente, URL nel corpo
    ips, seen = [], set()
    for hop in hops:
        f = hop.get("from") or {}
        if f.get("ip") and f.get("public") and f["ip"] not in seen:
            seen.add(f["ip"])
            ips.append({"value": f["ip"], "role": "origin" if origin and origin["ip"] == f["ip"] else f"hop {hop['index']}", "host": f.get("rdns") or f.get("host")})
    if origin and origin["ip"] not in seen:
        ips.insert(0, {"value": origin["ip"], "role": "origin", "host": None})

    domains, dseen = [], set()

    def add_domain(value, role):
        if value and "." in value:
            value = value.lower().strip(".")
            if value not in dseen:
                dseen.add(value)
                domains.append({"value": value, "role": role})

    add_domain((summary["from"] or {}).get("domain"), "From")
    for rt in summary["replyTo"]:
        add_domain(rt.get("domain"), "Reply-To")
    add_domain((summary["returnPath"] or {}).get("domain"), "Return-Path")
    add_domain((summary["sender"] or {}).get("domain"), "Sender")
    for s in auth["signatures"]:
        add_domain(s.get("domain"), "DKIM signer")
    if summary["messageId"]:
        md = re.search(r"@([^>\s]+)", summary["messageId"])
        add_domain(md.group(1) if md else None, "Message-ID")

    emails, eseen = [], set()
    for role, addr in [("From", summary["from"]), ("Sender", summary["sender"]), ("Return-Path", summary["returnPath"]),
                       *[("Reply-To", a) for a in summary["replyTo"]]]:
        if addr and addr.get("address") and addr["address"].lower() not in eseen:
            eseen.add(addr["address"].lower())
            emails.append({"value": addr["address"], "role": role})

    for hop in hops:
        hop["date"] = iso(hop["date"])

    return {
        "source": parsed.source,
        "summary": summary,
        "authentication": auth,
        "spam": spam,
        "hops": hops,
        "origin": origin,
        "transitSeconds": int((last_date - first_date).total_seconds()) if first_date and last_date else None,
        "findings": found,
        "verdict": verdict(found, auth),
        "indicators": {"ips": ips, "domains": domains, "emails": emails, "urls": ep.extract_urls(parsed.text, parsed.html)},
        "attachments": [a.__dict__ for a in parsed.attachments],
        "headers": [{"name": k, "value": v} for k, v in parsed.headers],
        "notes": list(parsed.notes),
        "bodyIncluded": bool(parsed.text or parsed.html),
    }


def _is_public_ip(value: str) -> bool:
    try:
        return ipaddress.ip_address(value).is_global
    except ValueError:
        return False


@router.post("/analyze")
async def analyze(request: EmailRequest):
    try:
        if request.content is not None:
            try:
                data = base64.b64decode(request.content, validate=True)
            except (binascii.Error, ValueError):
                raise HTTPException(status_code=400, detail="The file could not be read.")
            if len(data) > MAX_FILE_BYTES:
                raise HTTPException(status_code=413, detail="The file is larger than 25 MB.")
            parsed = ep.parse_input(data=data, filename=request.filename)
        else:
            parsed = ep.parse_input(text=request.text)
    except ep.EmailParseError as e:
        raise HTTPException(status_code=422, detail=str(e))

    report = build_report(parsed)
    del parsed  # niente resta in memoria oltre la risposta

    hop_ips = []
    for hop in report["hops"]:
        for side in ("from", "by"):
            ip = (hop.get(side) or {}).get("ip")
            if ip and _is_public_ip(ip) and ip not in hop_ips:
                hop_ips.append(ip)
    if report["origin"] and report["origin"]["ip"] not in hop_ips:
        hop_ips.insert(0, report["origin"]["ip"])
    geo, geo_error = await geolocate(hop_ips)
    report["geo"] = geo
    if geo_error:
        report["notes"].append(geo_error)
    return report
