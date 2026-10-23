// Pagina di analisi sul sito del servizio, per ogni riquadro (dove esiste).

export function sourceLink(sourceId, target) {
  const v = encodeURIComponent(target.value);
  switch (sourceId) {
    case "abuseipdb":
      return { label: "Open on AbuseIPDB", href: `https://www.abuseipdb.com/check/${v}` };
    case "proxycheck":
      return { label: "Open on ProxyCheck.io", href: `https://proxycheck.io/threats/${v}` };
    case "iptracker":
      // ip-api.com non ha una pagina per IP: si apre la risposta ufficiale per quell'IP
      return { label: "Open on ip-api.com", href: `http://ip-api.com/json/${v}` };
    case "virustotal":
      if (target.kind === "domain") return { label: "Open on VirusTotal", href: `https://www.virustotal.com/gui/domain/${v}` };
      return { label: "Open on VirusTotal", href: `https://www.virustotal.com/gui/search/${encodeURIComponent(v)}` };
    case "domainwhois": {
      const host = target.kind === "url" ? target.host : target.value;
      return { label: "Open on ICANN Lookup", href: `https://lookup.icann.org/whois/en?q=${encodeURIComponent(host)}` };
    }
    default:
      return null;
  }
}
