# Argus

![License](https://img.shields.io/badge/license-MIT-blue)
![React](https://img.shields.io/badge/React-61DAFB?logo=react&logoColor=black&labelColor=61DAFB)
![Python](https://img.shields.io/badge/Python-3776AB?style=flat&logo=python&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-2496ED?style=flat&logo=docker&logoColor=white)

<img src="https://github.com/RykerWilder/static_files/blob/main/argus.webp" alt="Splunk SOC Lab">

**Argus** is a self-hosted IP intelligence tool. Type an IP address into a single search field: the sources are queried in parallel, and once they have all answered you are taken to a report with the key facts highlighted, an interactive world map that highlights the country the address comes from, and one panel per source.

## Sources

| Source | Endpoint | What it contributes | Key |
| --- | --- | --- | --- |
| **ip-api.com** | `POST /api/iptracker` | Location (country, region, city, coordinates, time zone) and connection (ISP, organization, ASN, reverse DNS, mobile/proxy/hosting flags) | none |
| **RDAP WHOIS** (`ipwhois`) — *currently not shown in the report* | `POST /api/whois` | Who owns the address block: CIDR, range, network name and handle, registry, registration dates, registrant, abuse contacts | none |
| **AbuseIPDB** | `POST /api/abuseipdb` | Abuse confidence score, reports, report categories, usage type, Tor flag | `ABUSEIPDB_API_KEY` |
| **ProxyCheck.io** (v3) | `POST /api/proxycheck` | VPN / proxy / Tor / hosting / scraper / compromised detection, risk score, anonymizing service operator | `PROXYCHECK_API_KEY` (optional) |

RDAP WHOIS is disabled in the frontend (`enabled: false` in `frontend/src/lib/lookup.js`): the backend endpoint and the panel code are kept for later use, set it back to `true` to bring it back. The **Sources** page (`/sources`) lists every service Argus uses, with links to their websites.

Every endpoint takes the same body: `{"ip": "8.8.8.8"}`. Private and reserved addresses are rejected with HTTP 422.

### How the report is organized

The frontend (`frontend/src/lib/report.js`) builds the report from the four responses:

- **Key facts**, highlighted in the accent colour (mint, #3DFFC5) at the top: location, ISP, connection type (Fixed Line ISP, Mobile ISP, Data Center… from AbuseIPDB) and VPN, including the VPN provider when ProxyCheck.io identifies it. The same rows are highlighted inside the source panels.
- **Interactive map**: drag to pan, Ctrl/⌘ + scroll or pinch to zoom, double-click to zoom in, click a country to zoom to it, hover to see its name. Keyboard: `+`, `-`, arrows, `0` to reset.
- **One panel per source**, in this order: ip-api.com, ProxyCheck.io, AbuseIPDB. A value already shown in an earlier panel is not repeated; if a later source reports a different value, the row appears marked "Differs from …".
- If a source fails, its panel says why and the rest of the report still works.
- The report contains no links to external sites; only the backend talks to the APIs.
- The home page background is an animated canvas map with random connections between points: hover lights up nearby dots, clicking an empty area sends connections from the nearest point. It pauses when the tab is hidden and stays still if the system asks for reduced motion.

## Run with Docker

```bash
cp .env.example .env        # add your AbuseIPDB key (ProxyCheck key is optional)
docker compose up -d --build
```

- Frontend: http://localhost:5173
- Backend API: http://localhost:8000 (docs at `/docs`, health check at `/health`)

The frontend image downloads the country boundaries for the map (`world-atlas`, Natural Earth 1:110m, public domain) at build time, so the map works without calling a CDN at runtime.

## Run without Docker

```bash
# backend
cd backend && pip install -r requirements.txt && uvicorn main:app --reload --port 8000

# frontend (Vite proxies /api to localhost:8000; map data is loaded from jsDelivr)
cd frontend && npm install && npm run dev
```

## Project layout

```
backend/
  main.py                 FastAPI app, mounts the four routers
  routers/common.py       shared IP validation
  routers/iptracker.py    ip-api.com
  routers/whois.py        RDAP
  routers/abuseipdb.py    AbuseIPDB
  routers/proxycheck.py   ProxyCheck.io v3
frontend/src/
  pages/Home.jsx          search field + live progress, redirects when all sources answered
  pages/Result.jsx        report (/ip/:ip)
  pages/Sources.jsx       list of services with links (/sources)
  components/NetworkBackground.jsx  animated canvas map on the home page
  components/WorldMap.jsx dot-matrix world map with highlighted country and marker
  lib/lookup.js           parallel queries + session cache
  lib/report.js           de-duplication and merge logic
  lib/geo.js              TopoJSON decoding and Natural Earth projection (no dependencies)
```

## Notes

- Only investigate IP addresses you are authorized to look into.
- ip-api.com's free tier allows 45 requests per minute; AbuseIPDB and ProxyCheck have daily limits that depend on your plan.
