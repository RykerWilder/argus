"""Prefisso BGP (CIDR) di un IP tramite il servizio DNS di Team Cymru.

Una sola query TXT, gratuita e senza chiave:
  1.2.3.4      -> 4.3.2.1.origin.asn.cymru.com
  2001:db8::1  -> <nibble invertiti>.origin6.asn.cymru.com
Risposta: "ASN | prefisso | paese | registro | data di allocazione".
Se più prefissi annunciano lo stesso IP si sceglie il più specifico.
"""
import ipaddress
from typing import Optional

import dns.asyncresolver
import dns.exception
import dns.resolver

TIMEOUT = 3.0


def cymru_name(addr: ipaddress.IPv4Address | ipaddress.IPv6Address) -> str:
    if addr.version == 4:
        return ".".join(reversed(str(addr).split("."))) + ".origin.asn.cymru.com"
    nibbles = addr.exploded.replace(":", "")
    return ".".join(reversed(nibbles)) + ".origin6.asn.cymru.com"


def parse_cymru(records: list[str]) -> Optional[dict]:
    best = None
    for record in records:
        parts = [p.strip() for p in record.strip('"').split("|")]
        if len(parts) < 2:
            continue
        try:
            network = ipaddress.ip_network(parts[1], strict=False)
        except ValueError:
            continue
        if best is None or network.prefixlen > best[0].prefixlen:
            best = (network, parts)
    if not best:
        return None
    network, parts = best
    asn = parts[0].split()[0] if parts[0] else None
    return {
        "cidr": str(network),
        "asn": f"AS{asn}" if asn and asn.isdigit() else None,
        "country": parts[2] if len(parts) > 2 and parts[2] else None,
        "registry": parts[3].upper() if len(parts) > 3 and parts[3] else None,
        "allocated": parts[4] if len(parts) > 4 and parts[4] else None,
        "firstAddress": str(network.network_address),
        "lastAddress": str(network.broadcast_address),
        "size": network.num_addresses,
        "source": "BGP (Team Cymru)",
    }


async def bgp_prefix(addr) -> Optional[dict]:
    """None se il prefisso non si trova o il DNS non risponde: è un dato in più, non blocca."""
    try:
        answer = await dns.asyncresolver.resolve(cymru_name(addr), "TXT", lifetime=TIMEOUT)
    except (dns.exception.DNSException, OSError):
        return None
    records = ["".join(s.decode() for s in r.strings) for r in answer]
    return parse_cymru(records)
