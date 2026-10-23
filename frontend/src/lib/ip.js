const IPV4 = /^(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(\.(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$/;

export function normalizeIp(raw) {
  return (raw || "").trim().replace(/^\[|\]$/g, "");
}

export function isIPv4(ip) {
  return IPV4.test(ip);
}

export function isIPv6(ip) {
  if (!ip.includes(":") || /[^0-9a-fA-F:.]/.test(ip)) return false;
  try {
    new URL(`http://[${ip}]/`);
    return true;
  } catch {
    return false;
  }
}

export function isValidIp(ip) {
  return isIPv4(ip) || isIPv6(ip);
}

// Controllo rapido lato client per evitare quattro chiamate inutili.
export function privateReason(ip) {
  if (isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number);
    if (a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return "a private network address";
    if (a === 127) return "a loopback address";
    if (a === 169 && b === 254) return "a link-local address";
    if (a === 100 && b >= 64 && b <= 127) return "a carrier-grade NAT address";
    if (a === 0 || a >= 224) return "a reserved address";
    return null;
  }
  const lower = ip.toLowerCase();
  if (lower === "::1") return "a loopback address";
  if (/^f[cd]/.test(lower)) return "a private network address";
  if (/^fe[89ab]/.test(lower)) return "a link-local address";
  return null;
}
