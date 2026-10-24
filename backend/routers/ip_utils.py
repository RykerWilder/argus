"""Funzioni condivise per leggere e classificare gli indirizzi IP.

Non dipendono da FastAPI: le usano sia i router (tramite common.py) sia il
parser delle email. Questo è l'unico posto in cui si decide che cosa è un IP
valido e che cosa è un IP pubblico.
"""
import ipaddress

IPAddress = ipaddress.IPv4Address | ipaddress.IPv6Address


def as_ip(raw: str | None) -> IPAddress | None:
    """L'indirizzo IP contenuto in `raw` (spazi e parentesi quadre ignorati),
    oppure None se non lo è."""
    try:
        return ipaddress.ip_address((raw or "").strip().strip("[]"))
    except ValueError:
        return None


def is_public_ip(value: "str | IPAddress | None") -> bool:
    """True per un indirizzo globale (instradabile su Internet), anche se
    passato come stringa. Stringhe non valide e None danno False."""
    addr = as_ip(value) if isinstance(value, str) or value is None else value
    return addr is not None and addr.is_global
