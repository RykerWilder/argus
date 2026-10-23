"""Helper condivisi dai router IP."""
import ipaddress

from fastapi import HTTPException
from pydantic import BaseModel, Field


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
