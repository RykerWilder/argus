"""Shared functions to read and classify IP addresses.

They do not depend on FastAPI: both the routers (through common.py) and the email parser
use them. This is the only place that decides what a valid IP and what a public IP is.
"""
import ipaddress

IPAddress = ipaddress.IPv4Address | ipaddress.IPv6Address


def as_ip(raw: str | None) -> IPAddress | None:
    """The IP address contained in `raw` (spaces and square brackets ignored), or None if it is not one."""
    try:
        return ipaddress.ip_address((raw or "").strip().strip("[]"))
    except ValueError:
        return None


def is_public_ip(value: "str | IPAddress | None") -> bool:
    """True for a global address (routable on the Internet), even when passed as a string.
    Invalid strings and None give False.
    """
    addr = as_ip(value) if isinstance(value, str) or value is None else value
    return addr is not None and addr.is_global
