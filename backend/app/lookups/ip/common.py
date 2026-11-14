"""Helpers shared by the IP routers."""
from fastapi import HTTPException
from pydantic import BaseModel, Field

from app.lookups.net import IPAddress, as_ip


class IPRequest(BaseModel):
    ip: str = Field(..., description="IPv4/IPv6 address to analyze, e.g. 8.8.8.8")


def parse_ip(raw: str) -> IPAddress:
    """Validates the IP and returns the ipaddress object, or 400."""
    addr = as_ip(raw)
    if addr is None:
        raise HTTPException(status_code=400, detail="Invalid IP address.")
    return addr


def require_public(addr: IPAddress) -> str:
    """External sources only work on public IPs: 422 otherwise."""
    if not addr.is_global:
        raise HTTPException(
            status_code=422,
            detail="Private or reserved address: no public data available.",
        )
    return str(addr)
