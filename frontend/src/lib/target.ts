// Riconosce cosa è stato scritto nel campo di ricerca: IP, dominio o URL.

import type { ClassifiedTarget, TargetRef } from "../types";
import { refang } from "./defang";
import { isValidIp, normalizeIp, privateReason } from "./ip";

const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

function toAsciiHost(host: string): string | null {
  try {
    return new URL(`http://${host}`).hostname; // punycode per i domini internazionali
  } catch {
    return null;
  }
}

export function isValidDomain(raw: string | null | undefined): boolean {
  const host = toAsciiHost((raw || "").trim().replace(/\.$/, "").toLowerCase());
  if (!host || host.length > 253) return false;
  const labels = host.split(".");
  if (labels.length < 2 || !labels.every((l) => LABEL.test(l))) return false;
  const tld = labels[labels.length - 1];
  return /^[a-z]{2,63}$/.test(tld) || /^xn--[a-z0-9-]{2,59}$/.test(tld);
}

function normalizeDomain(raw: string): string {
  const clean = raw.trim().replace(/\.$/, "").toLowerCase();
  return toAsciiHost(clean) ?? clean;
}

/** Riconosce cosa è stato scritto: IP, dominio, URL oppure un testo non valido (con il motivo). */
export function classify(raw: string | null | undefined): ClassifiedTarget {
  // accetta anche indicatori "defanged": 8.8.8[.]8, hxxps[://]example[.]com
  const input = refang(raw);
  if (!input) return { kind: "invalid", error: "Enter an IP address, a domain or a URL." };

  const ip = normalizeIp(input);
  if (isValidIp(ip)) {
    const reason = privateReason(ip);
    if (reason) {
      return { kind: "invalid", error: `${ip} is ${reason}, so no public source has data on it. Enter a public IP.` };
    }
    return { kind: "ip", value: ip };
  }

  // schema, percorso, query, frammento o porta (example.com:8080) indicano un URL
  const looksLikeUrl =
    /^[a-z][a-z0-9+.-]*:\/\//i.test(input) || /[/?#]/.test(input) || /^[^:]+:\d{1,5}$/.test(input);
  if (!looksLikeUrl && !/\s/.test(input) && isValidDomain(input)) {
    return { kind: "domain", value: normalizeDomain(input) };
  }

  if (looksLikeUrl && !/\s/.test(input)) {
    const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : `http://${input}`;
    let url: URL;
    try {
      url = new URL(withScheme);
    } catch {
      return { kind: "invalid", error: `“${input}” is not a valid URL.` };
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return { kind: "invalid", error: "Only http and https URLs can be analyzed." };
    }
    const host = url.hostname.replace(/^\[|\]$/g, "");
    const hostIsIp = isValidIp(host);
    if (!hostIsIp && !isValidDomain(host)) {
      return { kind: "invalid", error: `“${url.hostname}” is not a valid domain.` };
    }
    // un URL che è solo un IP (es. http://8.8.8.8/) si analizza come IP
    if (hostIsIp && (url.pathname === "/" || url.pathname === "") && !url.search) {
      return classify(host);
    }
    return { kind: "url", value: url.href, host, hostIsIp };
  }

  return {
    kind: "invalid",
    error: `“${input}” is not an IP address, a domain or a URL.`,
  };
}

// Percorso della pagina dei risultati per ogni tipo di ricerca.
export function resultPath(target: TargetRef): string {
  if (target.kind === "ip") return `/ip/${encodeURIComponent(target.value)}`;
  if (target.kind === "domain") return `/domain/${encodeURIComponent(target.value)}`;
  return `/url?target=${encodeURIComponent(target.value)}`;
}
