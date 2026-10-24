"""Helper condivisi dai router IP."""
import ipaddress
import os
import re

from fastapi import HTTPException, Request
from pydantic import BaseModel, Field

# Intestazione con cui il frontend invia la chiave salvata nelle impostazioni.
API_KEY_HEADER = "X-Argus-Api-Key"
_KEY_FORMAT = re.compile(r"[A-Za-z0-9._~+/=-]{8,256}")


def request_api_key(http_request: Request, env_name: str) -> str:
    """Chiave API per la richiesta: quella impostata nel browser (Settings) se
    c'è, altrimenti quella di .env. Stringa vuota se non ce n'è nessuna."""
    sent = (http_request.headers.get(API_KEY_HEADER) or "").strip()
    if sent:
        if not _KEY_FORMAT.fullmatch(sent):
            raise HTTPException(status_code=400, detail="The API key saved in Settings has an invalid format.")
        return sent
    return os.getenv(env_name, "").strip()


class IPRequest(BaseModel):
    ip: str = Field(..., description="Indirizzo IPv4/IPv6 da analizzare, es. 8.8.8.8")


def parse_ip(raw: str) -> ipaddress.IPv4Address | ipaddress.IPv6Address:
    """Valida l'IP e restituisce l'oggetto ipaddress, oppure 400."""
    try:
        return ipaddress.ip_address((raw or "").strip())
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid IP address.")


def require_public(addr) -> str:
    """Le sorgenti esterne lavorano solo su IP pubblici: 422 negli altri casi."""
    if not addr.is_global:
        raise HTTPException(
            status_code=422,
            detail="Private or reserved address: no public data available.",
        )
    return str(addr)
