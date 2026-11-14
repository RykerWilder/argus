"""BGP prefix (CIDR) of an IP through Team Cymru's DNS service.

A single TXT query, free and keyless:
  1.2.3.4      -> 4.3.2.1.origin.asn.cymru.com
  2001:db8::1  -> <reversed nibbles>.origin6.asn.cymru.com
Answer: "ASN | prefix | country | registry | allocation date".
If several prefixes announce the same IP, the most specific one is chosen.
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
    """None if the prefix is not found or DNS does not answer: it is extra data, it does not block."""
    try:
        answer = await dns.asyncresolver.resolve(cymru_name(addr), "TXT", lifetime=TIMEOUT)
    except (dns.exception.DNSException, OSError):
        return None
    records = ["".join(s.decode() for s in r.strings) for r in answer]
    return parse_cymru(records)
