"""Helper condivisi dai router IP."""
import re

from fastapi import HTTPException, Request
from pydantic import BaseModel, Field

from .ip_utils import IPAddress, as_ip

# Intestazione con cui il frontend invia la chiave salvata nelle impostazioni.
API_KEY_HEADER = "X-Argus-Api-Key"
_KEY_FORMAT = re.compile(r"[A-Za-z0-9._~+/=-]{8,256}")


def request_api_key(http_request: Request) -> str:
    """Chiave API inviata dal browser (impostata in Settings). Il server non ne
    conserva: stringa vuota se la richiesta non ne porta una."""
    sent = (http_request.headers.get(API_KEY_HEADER) or "").strip()
    if sent and not _KEY_FORMAT.fullmatch(sent):
        raise HTTPException(status_code=400, detail="The API key saved in Settings has an invalid format.")
    return sent


class IPRequest(BaseModel):
    ip: str = Field(..., description="Indirizzo IPv4/IPv6 da analizzare, es. 8.8.8.8")


def parse_ip(raw: str) -> IPAddress:
    """Valida l'IP e restituisce l'oggetto ipaddress, oppure 400."""
    addr = as_ip(raw)
    if addr is None:
        raise HTTPException(status_code=400, detail="Invalid IP address.")
    return addr


def require_public(addr: IPAddress) -> str:
    """Le sorgenti esterne lavorano solo su IP pubblici: 422 negli altri casi."""
    if not addr.is_global:
        raise HTTPException(
            status_code=422,
            detail="Private or reserved address: no public data available.",
        )
    return str(addr)
