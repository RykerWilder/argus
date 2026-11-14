// Recognizes what was typed into the search field: IP, domain or URL.

import type { ClassifiedTarget, TargetRef } from "../../types";
import { refang } from "./defang";
import { isValidIp, normalizeIp, privateReason } from "./ip";

const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

function toAsciiHost(host: string): string | null {
  try {
    return new URL(`http://${host}`).hostname;  // punycode for international domains
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

/** Recognizes what was typed: IP, domain, URL or an invalid text (with the reason). */
export function classify(raw: string | null | undefined): ClassifiedTarget {
  // also accepts "defanged" indicators: 8.8.8[.]8, hxxps[://]example[.]com
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

  // scheme, path, query, fragment or port (example.com:8080) indicate a URL
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
    // a URL that is just an IP (e.g. http://8.8.8.8/) is analyzed as an IP
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

// Path of the results page for each lookup type.
export function resultPath(target: TargetRef): string {
  if (target.kind === "ip") return `/ip/${encodeURIComponent(target.value)}`;
  if (target.kind === "domain") return `/domain/${encodeURIComponent(target.value)}`;
  return `/url?target=${encodeURIComponent(target.value)}`;
}
