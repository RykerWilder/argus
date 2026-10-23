# Argus

![License](https://img.shields.io/badge/license-MIT-blue)
![React](https://img.shields.io/badge/React-61DAFB?logo=react&logoColor=black&labelColor=61DAFB)
![Python](https://img.shields.io/badge/Python-3776AB?style=flat&logo=python&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-2496ED?style=flat&logo=docker&logoColor=white)

<img src="https://github.com/RykerWilder/static_files/blob/main/argus.webp" alt="Argus">

Argus is a self-hosted threat intelligence lookup tool. It queries several public sources in parallel and merges the answers into a single report.

- **IP addresses**: location, ISP and network block, VPN/proxy/Tor detection, abuse reports and connection type, with an interactive world map.
- **Domains and URLs**: registration data, DNS records and reputation from 90+ security engines.
- **Email headers**: analysis of a pasted header or an `.eml` / `.msg` file, with the route of the message on a map. Nothing is stored.
- **History**: the latest searches, kept only in your browser.

Only the backend talks to the external services. The report contains no links to third-party sites.

## Sources and limits

| Source | Used for | API key | Limit (free tier) |
| --- | --- | --- | --- |
| [ip-api.com](https://ip-api.com/docs) | IP geolocation and connection details; geolocation of the hops in the email analyzer | None | 45 requests/minute per IP address. Batch endpoint (email analyzer): 15 requests/minute, up to 100 IPs each |
| [ProxyCheck.io](https://proxycheck.io/api/) | VPN, proxy, Tor, hosting and risk score | Optional (`PROXYCHECK_API_KEY`) | 100 queries/day without a key, 1,000 queries/day with a free key |
| [AbuseIPDB](https://docs.abuseipdb.com) | Abuse confidence score, reports, connection type | Required (`ABUSEIPDB_API_KEY`) | 1,000 requests/day (checks and reports combined) |
| [Team Cymru](https://www.team-cymru.com/ip-asn-mapping) | BGP prefix (CIDR) of an IP, via DNS | None | No published limit. One DNS query per lookup |
| [RDAP / WHOIS](https://about.rdap.org) | Domain registration, name servers, registrar | None | No fixed limit. Set by each registry |
| [VirusTotal](https://docs.virustotal.com/reference/public-vs-premium-api) | Domain and URL reputation | Required (`VIRUSTOTAL_API_KEY`) | 4 requests/minute, 500 requests/day |

Notes on the limits:

- A single IP search sends one request to ip-api.com, ProxyCheck.io and AbuseIPDB. The lowest limit applies: in practice 1,000 IP searches per day with free keys.
- A single domain or URL search can use up to 4 VirusTotal requests, so the per-minute limit can be reached by one search.
- When a source answers HTTP 429 its panel reports the error and the rest of the report is still shown.
- Results are cached for 10 minutes in the browser session, and repeated searches in that window do not consume quota. Failed sources are retried on the next search.
- The free ip-api.com endpoint is HTTP only and not allowed for commercial use. The free VirusTotal API is not allowed for commercial use either.
- Limits are set by the providers and may change. Check their documentation before relying on them.

## Installation

Requirements: Docker with the Compose plugin.

```bash
git clone https://github.com/RykerWilder/argus.git
cd argus
cp .env.example .env
```

Edit `.env` and set the API keys (see [Configuration](#configuration)), then start the stack:

```bash
docker compose up -d --build
```

| Service | URL |
| --- | --- |
| Web interface | http://localhost:5173 |
| API | http://localhost:8000 |
| API docs | http://localhost:8000/docs |

To stop it: `docker compose down`.

## Configuration

Set these variables in `.env`:

| Variable | Required | Where to get it |
| --- | --- | --- |
| `ABUSEIPDB_API_KEY` | For IP searches | [abuseipdb.com](https://www.abuseipdb.com) (free account) |
| `PROXYCHECK_API_KEY` | No | [proxycheck.io](https://proxycheck.io) (raises the daily limit) |
| `VIRUSTOTAL_API_KEY` | For domain and URL searches | [virustotal.com](https://www.virustotal.com) (free account) |

A missing key disables only the source that needs it. Never commit `.env`: it is already listed in `.gitignore`.

## API

Each source is a separate endpoint. IP endpoints accept `{"ip": "8.8.8.8"}`.

| Endpoint | Source |
| --- | --- |
| `POST /api/iptracker` | ip-api.com and Team Cymru |
| `POST /api/proxycheck` | ProxyCheck.io |
| `POST /api/abuseipdb` | AbuseIPDB |
| `POST /api/whois` | RDAP for IP addresses (disabled in the interface) |
| `POST /api/domain-whois` | RDAP / WHOIS for domains |
| `POST /api/virustotal` | VirusTotal |
| `POST /api/email/analyze` | Email header analyzer |

Private and reserved IP addresses are rejected with HTTP 422. The full schema is available at `/docs`.

## Usage notes

Only investigate IP addresses, domains and messages you are authorized to look into.

## License

Released under the MIT License. See [LICENSE](LICENSE).
