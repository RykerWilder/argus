"""Lettura di un'email: header incollati, file .eml (RFC 5322) o .msg (Outlook).

Tutto avviene in memoria: niente viene scritto su disco o conservato dopo la
risposta. Il risultato è una struttura neutra (header, corpo, allegati) che
email_analyzer.py trasforma nel report.
"""
from __future__ import annotations

import hashlib
import ipaddress
import re
from dataclasses import dataclass, field
from email import message_from_bytes, message_from_string
from email.header import decode_header, make_header
from email.message import Message
from email.policy import compat32
from email.utils import getaddresses, parseaddr, parsedate_to_datetime
from typing import Optional

import olefile

MAX_ATTACHMENTS = 50
MAX_URLS = 200

# Prima riga tipica di un blocco di header: serve a scartare quello che precede
# (per esempio il riepilogo di "Mostra originale" di Gmail copiato con la pagina).
# Prima gli header che stanno solo in cima a un messaggio vero (un riepilogo
# copiato può contenere "From:" ma non "Received:"), poi quelli più generici.
FIRST_HEADER_STRONG = re.compile(
    r"^(Delivered-To|Received|Return-Path|ARC-Seal|ARC-Message-Signature|ARC-Authentication-Results|"
    r"X-Received|Authentication-Results|DKIM-Signature|Received-SPF|X-Google-Smtp-Source|"
    r"X-MS-Exchange-[A-Za-z-]+|X-Forefront-Antispam-Report)\s*:",
    re.I | re.M,
)
FIRST_HEADER_WEAK = re.compile(r"^(MIME-Version|Message-ID|From|Date|Subject|To)\s*:", re.I | re.M)
HEADER_LINE = re.compile(r"^[!-9;-~]+:[ \t]?", re.M)


@dataclass
class Attachment:
    filename: str
    content_type: Optional[str]
    size: int
    sha256: str
    md5: str
    sha1: str


@dataclass
class ParsedEmail:
    source: str  # headers | eml | msg
    headers: list[tuple[str, str]]
    text: str = ""
    html: str = ""
    attachments: list[Attachment] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)

    def get(self, name: str) -> Optional[str]:
        name = name.lower()
        return next((v for k, v in self.headers if k.lower() == name), None)

    def get_all(self, name: str) -> list[str]:
        name = name.lower()
        return [v for k, v in self.headers if k.lower() == name]


class EmailParseError(ValueError):
    pass


# ── Header ─────────────────────────────────────────────────

def decode_value(value) -> str:
    """Decodifica le parole codificate RFC 2047 (=?utf-8?b?...?=) e unisce le righe."""
    if value is None:
        return ""
    raw = str(value)
    try:
        text = str(make_header(decode_header(raw)))
    except Exception:  # header malformato: meglio il testo grezzo che un errore
        text = raw
    return re.sub(r"\s*\r?\n[ \t]+", " ", text).strip()


def _headers(msg: Message) -> list[tuple[str, str]]:
    return [(k, decode_value(v)) for k, v in msg.items()]


def _clean_pasted(text: str) -> str:
    text = text.replace("﻿", "").replace("\r\n", "\n").replace("\r", "\n")
    # righe vuote iniziali, e un eventuale testo prima del primo header riconoscibile
    stripped = text.lstrip("\n ")
    if not HEADER_LINE.match(stripped):
        m = FIRST_HEADER_STRONG.search(stripped) or FIRST_HEADER_WEAK.search(stripped)
        if not m:
            raise EmailParseError("No email headers found. Paste the headers starting from the first line (e.g. Received: or Delivered-To:).")
        stripped = stripped[m.start():]
    return stripped


# ── Corpo e allegati di un messaggio MIME ─────────────────

def _hashes(data: bytes) -> tuple[str, str, str]:
    return hashlib.sha256(data).hexdigest(), hashlib.md5(data).hexdigest(), hashlib.sha1(data).hexdigest()


def _part_text(part: Message) -> str:
    payload = part.get_payload(decode=True) or b""
    charset = part.get_content_charset() or "utf-8"
    try:
        return payload.decode(charset, errors="replace")
    except LookupError:
        return payload.decode("utf-8", errors="replace")


def _mime_content(msg: Message, parsed: ParsedEmail) -> None:
    texts, htmls = [], []
    for part in msg.walk():
        if part.is_multipart():
            continue
        ctype = (part.get_content_type() or "").lower()
        disposition = (part.get("Content-Disposition") or "").lower()
        filename = part.get_filename()
        if filename:
            filename = decode_value(filename)
        is_attachment = "attachment" in disposition or (filename and ctype not in ("text/plain", "text/html"))
        if not is_attachment and ctype == "text/plain":
            texts.append(_part_text(part))
        elif not is_attachment and ctype == "text/html":
            htmls.append(_part_text(part))
        elif is_attachment or ctype not in ("text/plain", "text/html"):
            data = part.get_payload(decode=True) or b""
            if not data and not filename:
                continue
            if len(parsed.attachments) >= MAX_ATTACHMENTS:
                continue
            sha256, md5, sha1 = _hashes(data)
            parsed.attachments.append(
                Attachment(filename=filename or f"unnamed ({ctype})", content_type=ctype or None, size=len(data),
                           sha256=sha256, md5=md5, sha1=sha1)
            )
    parsed.text = "\n".join(texts)
    parsed.html = "\n".join(htmls)


# ── .msg (Outlook, formato OLE / MS-OXMSG) ────────────────

def _msg_string(ole: olefile.OleFileIO, prefix: str, prop: str) -> Optional[str]:
    for suffix, encoding in (("001F", "utf-16-le"), ("001E", "cp1252")):
        name = f"{prefix}__substg1.0_{prop}{suffix}"
        if ole.exists(name):
            return ole.openstream(name).read().decode(encoding, errors="replace").rstrip("\x00")
    return None


def _msg_binary(ole: olefile.OleFileIO, prefix: str, prop: str) -> Optional[bytes]:
    name = f"{prefix}__substg1.0_{prop}0102"
    return ole.openstream(name).read() if ole.exists(name) else None


def parse_msg(data: bytes) -> ParsedEmail:
    try:
        ole = olefile.OleFileIO(data)
    except Exception:
        raise EmailParseError("This doesn't look like an Outlook .msg file.")
    try:
        if not ole.exists("__properties_version1.0"):
            raise EmailParseError("This doesn't look like an Outlook .msg file.")
        transport = _msg_string(ole, "", "007D")  # PR_TRANSPORT_MESSAGE_HEADERS
        parsed: ParsedEmail
        if transport and transport.strip():
            msg = message_from_string(_clean_pasted(transport), policy=compat32)
            parsed = ParsedEmail(source="msg", headers=_headers(msg))
        else:
            # messaggio mai passato da un server (bozza, interno a Exchange):
            # si ricostruiscono gli header essenziali dalle proprietà
            name = _msg_string(ole, "", "0C1A") or ""
            address = _msg_string(ole, "", "5D01") or _msg_string(ole, "", "0C1F") or ""
            headers = [("From", f"{name} <{address}>" if address else name)]
            for header, prop in (("To", "0E04"), ("Cc", "0E03"), ("Subject", "0037")):
                value = _msg_string(ole, "", prop)
                if value:
                    headers.append((header, value))
            parsed = ParsedEmail(source="msg", headers=[(k, v) for k, v in headers if v.strip("<> ")])
            parsed.notes.append(
                "This .msg file has no internet headers: it may be a draft or a message that never left the "
                "mail server. Sender, recipients and subject come from the Outlook properties, so there is no "
                "route or authentication to show."
            )

        parsed.text = _msg_string(ole, "", "1000") or ""
        html = _msg_binary(ole, "", "1013")
        if html:
            parsed.html = html.decode("utf-8", errors="replace")

        storages = sorted({e[0] for e in ole.listdir(streams=True, storages=True) if e and e[0].startswith("__attach_version1.0_#")})
        for storage in storages[:MAX_ATTACHMENTS]:
            prefix = f"{storage}/"
            filename = _msg_string(ole, prefix, "3707") or _msg_string(ole, prefix, "3704") or _msg_string(ole, prefix, "3001")
            mime = _msg_string(ole, prefix, "370E")
            blob = _msg_binary(ole, prefix, "3701")
            if blob is None:
                if ole.exists(f"{prefix}__substg1.0_3701000D"):
                    parsed.notes.append(f"“{filename or 'An attachment'}” is an embedded Outlook item: save it separately to analyze it.")
                continue
            sha256, md5, sha1 = _hashes(blob)
            parsed.attachments.append(
                Attachment(filename=filename or "unnamed", content_type=mime, size=len(blob), sha256=sha256, md5=md5, sha1=sha1)
            )
        return parsed
    finally:
        ole.close()


# ── Ingresso ───────────────────────────────────────────────

def parse_input(*, text: Optional[str] = None, data: Optional[bytes] = None, filename: Optional[str] = None) -> ParsedEmail:
    name = (filename or "").lower()
    if data is not None:
        if name.endswith(".msg") or data[:8] == b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1":
            return parse_msg(data)
        msg = message_from_bytes(data, policy=compat32)
        if not msg.keys():
            raise EmailParseError("No email headers found in this file.")
        parsed = ParsedEmail(source="eml", headers=_headers(msg))
        _mime_content(msg, parsed)
        return parsed

    if not text or not text.strip():
        raise EmailParseError("Paste the email headers or choose a file.")
    msg = message_from_string(_clean_pasted(text), policy=compat32)
    if not msg.keys():
        raise EmailParseError("No email headers found.")
    parsed = ParsedEmail(source="headers", headers=_headers(msg))
    # incollato un messaggio intero (header + corpo): si legge anche il corpo
    if msg.get_payload():
        parsed.source = "eml"
        _mime_content(msg, parsed)
    return parsed


# ── Indirizzi, IP, date ────────────────────────────────────

def parse_address(value: Optional[str]) -> Optional[dict]:
    if not value:
        return None
    name, address = parseaddr(value)
    address = address.strip().strip("<>")
    if not address and not name:
        return None
    domain = address.rsplit("@", 1)[1].lower() if "@" in address else None
    return {"name": name.strip().strip('"') or None, "address": address or None, "domain": domain}


def parse_addresses(values: list[str]) -> list[dict]:
    out = []
    for name, address in getaddresses(values):
        if address or name:
            domain = address.rsplit("@", 1)[1].lower() if "@" in address else None
            out.append({"name": name.strip() or None, "address": address or None, "domain": domain})
    return out


def parse_date(value: Optional[str]):
    if not value:
        return None
    try:
        d = parsedate_to_datetime(value.strip())
    except (TypeError, ValueError, IndexError):
        return None
    if d is None:
        return None
    if d.tzinfo is None:
        from datetime import timezone
        d = d.replace(tzinfo=timezone.utc)
    return d


IPV4 = r"(?:25[0-5]|2[0-4]\d|1?\d?\d)(?:\.(?:25[0-5]|2[0-4]\d|1?\d?\d)){3}"
IP_CANDIDATES = re.compile(rf"\[(?:IPv6:)?([0-9A-Fa-f:.]+)\]|\(([0-9A-Fa-f:.]{{3,}})\)|\b({IPV4})\b|((?:[0-9a-fA-F]{{1,4}}:){{2,7}}[0-9a-fA-F]{{0,4}})")


def find_ip(text: str, prefer_parentheses: bool = False) -> Optional[ipaddress.IPv4Address | ipaddress.IPv6Address]:
    text = text or ""
    if prefer_parentheses:
        # "from HELO (rdns [IP])": il nome dopo "from" è quello dichiarato dal client
        # (HELO), l'IP reale della connessione è quello tra parentesi
        for inner in re.findall(r"\(([^()]*)\)", text):
            ip = find_ip(inner)
            if ip:
                return ip
    for m in IP_CANDIDATES.finditer(text):
        raw = next(g for g in m.groups() if g)
        try:
            return ipaddress.ip_address(raw.strip("[]"))
        except ValueError:
            continue
    return None


def is_public(ip) -> bool:
    return bool(ip) and ip.is_global


# ── Received ───────────────────────────────────────────────

_CLAUSE = r"(?=\s+(?:by|via|with|id|for|from)\s|\s*;|$)"


def parse_received(value: str) -> dict:
    body, _, date_part = value.rpartition(";")
    if not body:  # nessun ';': nessuna data
        body, date_part = value, ""
    flat = " ".join(body.split())

    def clause(word):
        m = re.search(rf"(?:^|\s){word}\s+(.+?){_CLAUSE}", flat, re.I)
        return m.group(1).strip() if m else None

    from_raw, by_raw, with_raw = clause("from"), clause("by"), clause("with")
    id_m = re.search(r"\bid\s+<?([^\s;>]+)", flat, re.I)
    for_m = re.search(r"\bfor\s+<?([^\s;>]+@[^\s;>]+)>?", flat, re.I)

    def host_of(raw):
        if not raw:
            return None
        token = raw.split()[0].strip("()[]")
        return token.rstrip(".") or None

    def rdns_of(raw):
        m = re.search(r"\(([^()]*)\)", raw or "")
        if not m:
            return None
        inner = m.group(1)
        names = [t.rstrip(".") for t in re.findall(r"[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+\.?", inner) if not re.fullmatch(IPV4, t.rstrip("."))]
        return names[0] if names else None

    from_ip = find_ip(from_raw or "", prefer_parentheses=True)
    by_ip = find_ip(by_raw.split()[0] if by_raw else "")
    protocol = None
    if with_raw:
        protocol = re.split(r"\s*\(|\s+id\s", with_raw)[0].strip() or None
    tls_m = re.search(r"version=(TLS\S*?)[,;)\s]|\b(TLSv?1\.?[0-3])\b", flat, re.I)
    tls = bool(tls_m) or bool(protocol and re.match(r"(E?SMTPS|ESMTPSA|UTF8SMTPS|LMTPS)", protocol, re.I))
    if not tls_m and re.search(r"cipher=", flat, re.I):
        tls = True
    date = parse_date(date_part)
    return {
        "from": {
            "host": host_of(from_raw),
            "rdns": rdns_of(from_raw),
            "ip": str(from_ip) if from_ip else None,
            "public": is_public(from_ip),
        } if from_raw else None,
        "by": {"host": host_of(by_raw), "ip": str(by_ip) if by_ip else None} if by_raw else None,
        "protocol": protocol,
        "tls": tls,
        "tlsVersion": (tls_m.group(1) or tls_m.group(2)).upper().replace("TLSV", "TLS") if tls_m else None,
        "id": id_m.group(1) if id_m else None,
        "for": for_m.group(1) if for_m else None,
        "date": date,
        "raw": value,
    }


# ── Authentication-Results e simili ───────────────────────

def _split_semicolons(value: str) -> list[str]:
    parts, depth, cur, quote = [], 0, [], False
    for ch in value:
        if ch == '"':
            quote = not quote
        elif not quote and ch == "(":
            depth += 1
        elif not quote and ch == ")":
            depth = max(0, depth - 1)
        if ch == ";" and depth == 0 and not quote:
            parts.append("".join(cur).strip())
            cur = []
        else:
            cur.append(ch)
    if "".join(cur).strip():
        parts.append("".join(cur).strip())
    return [p for p in parts if p]


def parse_auth_results(value: str) -> dict:
    """'mx.google.com; spf=pass (…) smtp.mailfrom=x; dkim=pass header.d=x' → server e metodi."""
    parts = _split_semicolons(value)
    instance = None
    if parts and re.fullmatch(r"i\s*=\s*\d+", parts[0], re.I):  # ARC-Authentication-Results
        instance = int(parts.pop(0).split("=")[1])
    server = None
    if parts and not re.match(r"^[A-Za-z0-9_.-]+\s*=", parts[0]):
        server = parts.pop(0).split()[0]
    methods = []
    for part in parts:
        # più metodi sulla stessa parte (es. Microsoft senza ';' tra dmarc e compauth) restano separati
        for chunk in re.split(r"\s+(?=(?:spf|dkim|dmarc|arc|compauth|bimi|auth|iprev|dkim-atps)\s*=)", part, flags=re.I):
            m = re.match(r"^\s*([A-Za-z0-9_.-]+)\s*=\s*([A-Za-z]+)", chunk)
            if not m:
                continue
            comment = " ".join(re.findall(r"\(([^()]*)\)", chunk)) or None
            props = {k.lower(): v.strip('"') for k, v in re.findall(r"([A-Za-z]+\.[A-Za-z0-9_.-]+|reason|action|policy\.\w+)\s*=\s*(\"[^\"]*\"|[^\s;()]+)", chunk)}
            extra = {k.lower(): v for k, v in re.findall(r"\b(p|sp|dis|pct)\s*=\s*([A-Za-z0-9]+)", comment or "")}
            methods.append({
                "method": m.group(1).lower(),
                "result": m.group(2).lower(),
                "comment": comment,
                "props": props,
                **({"policy": extra} if extra else {}),
            })
    return {"server": server, "instance": instance, "methods": methods, "raw": value}


def parse_tags(value: str) -> dict:
    """Tag k=v separati da ';' (DKIM-Signature, ARC-Seal)."""
    out = {}
    for part in value.split(";"):
        if "=" in part:
            k, v = part.split("=", 1)
            out[k.strip().lower()] = re.sub(r"\s+", "", v) if k.strip().lower() in ("b", "bh", "h") else v.strip()
    return out


URL_RE = re.compile(r"""\bhttps?://[^\s<>"'\])}]+""", re.I)
HREF_RE = re.compile(r"""href\s*=\s*["']\s*(https?://[^"'\s]+)""", re.I)


def extract_urls(text: str, html: str) -> list[str]:
    seen, out = set(), []
    for url in [*HREF_RE.findall(html or ""), *URL_RE.findall(html or ""), *URL_RE.findall(text or "")]:
        url = url.rstrip(".,;:!?)&")
        url = url.replace("&amp;", "&")
        if url.lower() not in seen:
            seen.add(url.lower())
            out.append(url)
        if len(out) >= MAX_URLS:
            break
    return out
