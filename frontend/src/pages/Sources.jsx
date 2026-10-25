import { useEffect } from "react";
import Header, { Bracket, Footer } from "../components/Header";

const DATA_SOURCES = [
  {
    name: "ip-api.com",
    role: "Geolocation and connection",
    provides: "Country, region, city, coordinates, time zone, ISP, organization, autonomous system, reverse DNS, and mobile, proxy and hosting flags.",
    access: "Free, no API key. 45 requests per minute.",
    links: [
      { label: "Website", href: "https://ip-api.com" },
      { label: "API docs", href: "https://ip-api.com/docs" },
    ],
  },
  {
    name: "ProxyCheck.io",
    role: "VPN, proxy and Tor detection",
    provides: "VPN, proxy, Tor, hosting, scraper and compromised-host detection, risk score, the VPN or anonymizing service operator, and network details.",
    access: "API key optional. Without a key the daily limit is lower.",
    links: [
      { label: "Website", href: "https://proxycheck.io" },
      { label: "API docs", href: "https://proxycheck.io/api/" },
    ],
  },
  {
    name: "AbuseIPDB",
    role: "Abuse reports and connection type",
    provides: "Abuse confidence score, reports and their categories, connection type (Fixed Line ISP, Mobile ISP, Data Center…), ISP, domain and Tor flag.",
    access: "Requires a free API key.",
    links: [
      { label: "Website", href: "https://www.abuseipdb.com" },
      { label: "API docs", href: "https://docs.abuseipdb.com" },
    ],
  },
  {
    name: "Team Cymru",
    role: "Network block (CIDR)",
    provides: "The BGP prefix an IP address belongs to, with its size, first and last address and regional registry. One DNS query per lookup.",
    access: "Free, no API key.",
    links: [{ label: "Website", href: "https://www.team-cymru.com/ip-asn-mapping" }],
  },
  {
    name: "WHOIS",
    role: "Domain registration",
    provides: "Registrar, registration and expiry dates, status, name servers, DNSSEC, registrant and abuse contact. Queried over RDAP, the registries' official JSON service, with classic WHOIS as fallback for TLDs that have no RDAP.",
    access: "Free, no API key.",
    links: [
      { label: "RDAP", href: "https://about.rdap.org" },
      { label: "IANA", href: "https://www.iana.org/whois" },
    ],
  },
  {
    name: "VirusTotal",
    role: "Domain and URL reputation",
    provides: "Verdicts from 90+ security engines, reputation and community votes, categories, DNS records, HTTPS certificate, popularity and, for URLs, the redirect chain.",
    access: "Requires a free API key. Free plan: 4 lookups per minute, 500 per day.",
    links: [
      { label: "Website", href: "https://www.virustotal.com" },
      { label: "API docs", href: "https://docs.virustotal.com/reference/overview" },
    ],
  },
];

function ExternalLinks({ links }) {
  return (
    <div className="source-links">
      {links.map((l) => (
        <Bracket key={l.href} as="a" href={l.href} target="_blank" rel="noreferrer noopener">
          {l.label}
        </Bracket>
      ))}
    </div>
  );
}

export default function Sources() {
  useEffect(() => {
    document.title = "Sources · Argus";
    return () => {
      document.title = "Argus";
    };
  }, []);

  return (
    <div className="page page--sources">
      <Header />

      <main className="sources">
        <h1>Sources</h1>
        <p className="sources__lead muted">
          Argus queries these services in parallel through its backend: ip-api.com, Team Cymru, ProxyCheck.io and AbuseIPDB for IP addresses, WHOIS and VirusTotal for domains and URLs.
        </p>

        <ul className="source-list">
          {DATA_SOURCES.map((s) => (
            <li key={s.name}>
              <div className="source-list__name">
                <h2>{s.name}</h2>
                <p className="muted">{s.role}</p>
              </div>
              <div className="source-list__body">
                <p>{s.provides}</p>
                <p className="muted">{s.access}</p>
              </div>
              <ExternalLinks links={s.links} />
            </li>
          ))}
        </ul>
      </main>
      <Footer />
    </div>
  );
}
