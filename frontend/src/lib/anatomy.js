// Scompone un dominio o un URL nelle sue parti, con una spiegazione per ognuna.
// La divisione tra sottodominio, nome registrato e suffisso pubblico arriva dal
// backend (/api/fqdn, Public Suffix List); se non risponde si usa una stima.

import { countryName } from "./countries";

// stima senza Public Suffix List: suffissi a due livelli più comuni
const TWO_LEVEL = /^(co|com|net|org|gov|edu|ac|or|ne|go|gob|nic|mil|ltd|plc|sch)\.[a-z]{2}$/;

export function guessParts(host) {
  const labels = host.split(".");
  const lastTwo = labels.slice(-2).join(".");
  const suffixLen = labels.length > 2 && TWO_LEVEL.test(lastTwo) ? 2 : 1;
  const suffix = labels.slice(-suffixLen).join(".");
  const domain = labels[labels.length - suffixLen - 1] || null;
  const subdomain = labels.slice(0, Math.max(0, labels.length - suffixLen - 1)).join(".") || null;
  return { host, subdomain, domain, suffix, registrable: domain ? `${domain}.${suffix}` : null, guessed: true };
}

function tldNote(suffix) {
  const tld = suffix.split(".").pop();
  if (/^xn--/.test(tld)) return `.${tld} is an internationalised top-level domain.`;
  if (tld.length === 2) {
    const country = countryName(tld.toUpperCase());
    return `.${tld} is a country-code top-level domain${country && country !== tld.toUpperCase() ? ` (${country})` : ""}.`;
  }
  return `.${tld} is a generic top-level domain.`;
}

function hostSegments(parts) {
  const segs = [];
  const sep = () => segs.push({ text: ".", type: "sep" });
  if (parts.subdomain) {
    parts.subdomain.split(".").forEach((label, i, arr) => {
      segs.push({
        text: label,
        type: "subdomain",
        title: arr.length > 1 ? `Subdomain, level ${i + 1} of ${arr.length}` : "Subdomain",
        body: `Chosen freely by whoever controls ${parts.registrable}. It says nothing about who owns the site: “paypal.com.example.net” belongs to example.net.`,
      });
      sep();
    });
  }
  if (parts.domain) {
    segs.push({
      text: parts.domain,
      type: "domain",
      title: "Registered name",
      body: `The part bought from a registrar. With the suffix it forms ${parts.registrable}, the domain the WHOIS panel describes.`,
    });
    sep();
  }
  segs.push({
    text: parts.suffix,
    type: "suffix",
    title: parts.suffix.includes(".") ? "Public suffix" : "Top-level domain (TLD)",
    body: `${parts.suffix.includes(".") ? `Anyone can register names directly under ${parts.suffix}. ` : ""}${tldNote(parts.suffix)}`,
  });
  return segs;
}

export function buildAnatomy(target, parts) {
  if (target.kind === "domain") return hostSegments(parts);

  const url = new URL(target.value);
  const segs = [];
  const scheme = url.protocol.replace(":", "");
  segs.push({
    text: scheme,
    type: "scheme",
    title: "Scheme",
    body: scheme === "https" ? "The protocol. https encrypts the connection, but phishing sites use it too." : "The protocol. http sends everything unencrypted.",
  });
  segs.push({ text: "://", type: "sep" });
  if (url.username) {
    segs.push({
      text: `${url.username}${url.password ? `:${url.password}` : ""}`,
      type: "userinfo",
      title: "Credentials in the URL",
      body: "Text before @ is a username (and password), not the site. Attackers use it to make a link look like another domain.",
    });
    segs.push({ text: "@", type: "sep" });
  }
  if (target.hostIsIp) {
    segs.push({ text: url.hostname, type: "ip", title: "IP address", body: "The URL points straight to an IP address instead of a name, which is unusual for legitimate sites." });
  } else {
    segs.push(...hostSegments(parts));
  }
  if (url.port) {
    segs.push({ text: ":", type: "sep" });
    segs.push({
      text: url.port,
      type: "port",
      title: "Port",
      body: `The service on the host. Without it the browser uses ${scheme === "https" ? "443" : "80"}.`,
    });
  }
  const pathParts = url.pathname.split("/").slice(1);
  if (url.pathname !== "/" || url.search || url.hash) {
    pathParts.forEach((p, i) => {
      segs.push({ text: "/", type: "sep" });
      if (!p) return;
      const last = i === pathParts.length - 1;
      segs.push({
        text: p,
        type: "path",
        title: last && /\.[a-z0-9]{1,5}$/i.test(p) ? "Path, file" : "Path segment",
        body: `Part of the resource requested from the server${last && /\.(php|asp|aspx|jsp|cgi)$/i.test(p) ? ", a server-side script" : ""}.`,
      });
    });
  }
  if (url.search) {
    segs.push({ text: "?", type: "sep" });
    url.search
      .slice(1)
      .split("&")
      .forEach((pair, i) => {
        if (i) segs.push({ text: "&", type: "sep" });
        const [rawName, ...rest] = pair.split("=");
        let value = rest.join("=");
        try {
          value = decodeURIComponent(value.replace(/\+/g, " "));
        } catch {
          // valore non decodificabile: si mostra com'è
        }
        const name = rawName || "(unnamed)";
        const isUrl = /^(https?:)?\/\//i.test(value) || /^[a-z0-9-]+(\.[a-z0-9-]+)+\//i.test(value);
        segs.push({
          text: pair,
          type: "query",
          title: `Query parameter “${name}”`,
          body: value
            ? `Value: ${value.length > 120 ? `${value.slice(0, 120)}…` : value}${isUrl ? ". It contains another address: a possible redirect to a different site." : "."}`
            : "Passed to the page without a value.",
        });
      });
  }
  if (url.hash) {
    segs.push({ text: "#", type: "sep" });
    segs.push({
      text: url.hash.slice(1),
      type: "fragment",
      title: "Fragment",
      body: "Read only by the browser and never sent to the server.",
    });
  }
  return segs;
}
