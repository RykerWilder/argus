# Argus

![License](https://img.shields.io/badge/license-MIT-blue)
![React](https://img.shields.io/badge/React-61DAFB?logo=react&logoColor=black&labelColor=61DAFB)
![Python](https://img.shields.io/badge/Python-3776AB?style=flat&logo=python&logoColor=white)
![Docker](https://img.shields.io/badge/Docker-2496ED?style=flat&logo=docker&logoColor=white)

<img src="https://github.com/RykerWilder/static_files/blob/main/argus.webp" alt="Argus">

Argus is a self-hosted threat intelligence lookup tool. It queries several public sources in parallel and merges the answers into a single report.

- **IP addresses**: location, ISP and network block, VPN/proxy/Tor detection, abuse reports with a pie chart of their categories, connection type, open ports, detected software and potential CVEs, with an interactive world map.
- **Domains and URLs**: registration data, DNS records and reputation from 90+ security engines.
- **Email headers**: analysis of a pasted header or an `.eml` / `.msg` file, with the route of the message on a map. Nothing is stored.
- **History**: the latest searches, kept only in your browser.

Argus sits behind a login ([Authelia](https://www.authelia.com)), with optional two-factor authentication. Users, passwords, the API keys of each user and their search preferences are stored in a SQLite database: a plain file, `data/argus/argus.db`, on your own server. Only the backend talks to the external services. The report contains no links to third-party sites.

## Sources and limits

| Source | Used for | API key | Limit (free tier) |
| --- | --- | --- | --- |
| [ip-api.com](https://ip-api.com/docs) | IP geolocation and connection details; geolocation of the hops in the email analyzer | None | 45 requests/minute per IP address. Batch endpoint (email analyzer): 15 requests/minute, up to 100 IPs each |
| [ProxyCheck.io](https://proxycheck.io/api/) | VPN, proxy, Tor, hosting and risk score | Optional | 100 queries/day without a key, 1,000 queries/day with a free key |
| [AbuseIPDB](https://docs.abuseipdb.com) | Abuse confidence score, reports, connection type | Required | 1,000 requests/day (checks and reports combined) |
| [Shodan InternetDB](https://internetdb.shodan.io) | Open ports, hostnames, tags, detected software and potential CVEs of an IP | None | No published limit. Free for non-commercial use only; data refreshed weekly |
| [Team Cymru](https://www.team-cymru.com/ip-asn-mapping) | BGP prefix (CIDR) of an IP, via DNS | None | No published limit. One DNS query per lookup |
| [RDAP / WHOIS](https://about.rdap.org) | Domain registration, name servers, registrar | None | No fixed limit. Set by each registry |
| [VirusTotal](https://docs.virustotal.com/reference/public-vs-premium-api) | Domain and URL reputation | Required | 4 requests/minute, 500 requests/day |

Notes on the limits:

- A single IP search sends one request to ip-api.com, ProxyCheck.io, AbuseIPDB and Shodan InternetDB. The lowest limit applies: in practice 1,000 IP searches per day with free keys.
- A single domain or URL search can use up to 4 VirusTotal requests, so the per-minute limit can be reached by one search.
- When a source answers HTTP 429 its panel reports the error and the rest of the report is still shown.
- Results are cached for 10 minutes in the browser session, and repeated searches in that window do not consume quota. Failed sources are retried on the next search.
- The free ip-api.com endpoint is HTTP only and not allowed for commercial use. Shodan InternetDB is free for non-commercial use only. The free VirusTotal API is not allowed for commercial use either.
- Limits are set by the providers and may change. Check their documentation before relying on them.

## Installation

Requirements: Docker with the Compose plugin, `openssl` and bash (macOS and Linux; on Windows use WSL or Git Bash).

```bash
git clone https://github.com/RykerWilder/argus.git
cd argus
./scripts/init.sh                                        # secrets (.env) and a local HTTPS certificate (certs/)
docker compose up -d --build
docker compose exec backend python -m app.cli add-user alice # asks for the password
```

Open **https://argus.localhost**, sign in and add your API keys in **Settings** (see [Configuration](#configuration)).

| Address | What |
| --- | --- |
| `https://argus.localhost` | Argus |
| `https://auth.argus.localhost` | Login page (Authelia). You are sent here when you are not signed in |

Both names point to your own computer: browsers resolve `*.localhost` by themselves. If yours does not (Safari, some Linux setups), add `127.0.0.1 argus.localhost auth.argus.localhost` to `/etc/hosts`.

To stop it: `docker compose down`. Your data stays in `./data` (see [Where the data lives](#where-the-data-lives)).
To update: `git pull && docker compose up -d --build`.

Coming from a version that kept the data in Docker volumes? Move it into `./data` once, with Argus stopped: `docker compose down && ./scripts/migrate-volumes.sh`, then `docker compose up -d --build`. The script copies the volumes and does not delete them.

`.env`, `certs/` and `data/` are not in git. If you unpack a fresh copy of the project instead of pulling, copy all three from the old folder first: a new `.env` has new secrets that do not fit the data already stored (see [Troubleshooting](#troubleshooting)).

### Trusting the local certificate

`init.sh` creates a small certificate authority in `certs/` and a certificate signed by it, so the first visit shows a warning. Install `certs/ca.pem` once as a trusted authority to remove it:

- **macOS**: `sudo security add-trusted-cert -d -r trustRoot -k /Library/Keychains/System.keychain certs/ca.pem`
- **Debian / Ubuntu**: `sudo cp certs/ca.pem /usr/local/share/ca-certificates/argus-ca.crt && sudo update-ca-certificates`. Chrome and Firefox keep their own list: import the file under Settings → Certificates → Authorities.
- **Windows** (administrator prompt): `certutil -addstore -f Root certs\ca.pem`

Keep `certs/ca.key` private: whoever has it can issue certificates that your computer trusts. Neither `certs/` nor `.env` is committed to git.

### Another domain or port

```bash
./scripts/init.sh --domain argus.example.com --port 8443 --policy two_factor
```

`init.sh` writes these choices to `.env` (see `.env.example` for every option). It never overwrites an existing `.env` or certificate. The domain needs a dot (Authelia does not accept a bare `localhost`), and both `<domain>` and `auth.<domain>` must reach the server.

To publish Argus on a real domain:

1. Point `argus.example.com` and `auth.argus.example.com` to the server.
2. Put a certificate valid for both names in `certs/fullchain.pem` and the key in `certs/privkey.pem` (for example from Let's Encrypt), and run `init.sh` with `--no-certs`.
3. Set `ARGUS_BIND=0.0.0.0` in `.env` (the default, `127.0.0.1`, accepts connections from this computer only) and run `docker compose up -d`.

To change the domain later, edit `.env`, delete `certs/fullchain.pem` and `certs/privkey.pem`, run `./scripts/init.sh` again and then `docker compose up -d`.

## Users and login

Argus keeps its users in the SQLite database. They are managed from the command line, inside the backend container:

| Command | What it does |
| --- | --- |
| `docker compose exec backend python -m app.cli add-user <name>` | Creates a user (options: `--name`, `--email`) |
| `docker compose exec backend python -m app.cli set-password <name>` | Sets a new password, for example when it is lost |
| `docker compose exec backend python -m app.cli list-users` | Lists the users |
| `docker compose exec backend python -m app.cli disable-user <name>` | Blocks a user without deleting them (`enable-user` undoes it) |
| `docker compose exec backend python -m app.cli set-mfa <name> on` | Requires a second factor from a user (`off` stops requiring it). Users can also do it themselves in Settings |
| `docker compose exec backend python -m app.cli delete-user <name>` | Deletes a user and their saved API keys |

Passwords have 12 to 128 characters. Each user changes their own in **Settings → Security**.

- **Authelia** handles the login page, the session cookie and the lock-out (5 wrong passwords in 2 minutes block the user for 10 minutes). Sessions last 12 hours, or 2 hours without activity, or 30 days with "Remember me".
- Authelia does not store users in SQLite, so after every change Argus writes the file Authelia reads (`users_database.yml`, in the `authelia-users` volume) from its own database. Authelia reloads it right away: no restart is needed, and a user added from the command line can sign in immediately. Passwords are stored once, as Argon2id hashes, and are used by both.

### Two-factor authentication

Authelia supports authenticator apps (TOTP: Google Authenticator, 1Password, Aegis...), security keys and passkeys (WebAuthn), and Duo push. Argus turns on TOTP and WebAuthn; Duo is not configured.

It is **off by default** and each user chooses for themselves: **Settings → Security → Ask for a second step when signing in**. The choice is stored in the database, and Argus writes it to the users file as the Authelia group `mfa`, for which the access rule requires two factors. It applies at once, without restarting anything.

To register the device:

1. Turn the toggle on. Argus sends you to the sign-in page, which says the resource needs two-factor authentication.
2. Click **Register device**. Authelia first asks for a one-time code to check it is you. There is no mail server, so the code is written to a file on the server: `data/authelia/notification.txt` (or `docker compose exec authelia cat /data/notification.txt`). With several users, point Authelia at an SMTP server instead (see the `notifier` comment in `authelia/configuration.yml`).
3. Enter the code, scan the QR code with the app and confirm with the 6-digit code it shows.

From then on, signing in asks for the password and then for the code. Turning the toggle off needs your password. **Manage devices** (shown while it is on) opens the Authelia page where devices are added and removed.

To require it from everybody, set `ARGUS_AUTH_POLICY=two_factor` in `.env` and run `docker compose up -d`: the toggle then shows as on and cannot be changed.

**Lost device or code?** An administrator lets the user in again with the password only and removes the old device, so that the next registration starts clean:

```bash
docker compose exec backend python -m app.cli set-mfa alice off
docker compose exec authelia authelia storage user totp delete alice --config /config/configuration.yml
docker compose exec authelia authelia storage user webauthn delete alice --all --config /config/configuration.yml   # only if they had a security key
```

## Configuration

The server needs no API keys in its configuration. You enter them in the web interface: **Settings**, in the header, opens a page with three sections.

- **Security**: the account you are signed in as, the two-factor toggle (see [above](#two-factor-authentication)), a form to change your password, and Sign out (also in the header).
- **Preferences**: a toggle for each service. A service that is turned off is not queried and its panel is left out of the report. For example, turn AbuseIPDB off to search IP addresses without it. Preferences are saved in your account, in the database, so they follow you to any browser.
- **API keys**: your own keys for AbuseIPDB and VirusTotal (required) and ProxyCheck.io (optional).

| Service | Key | Where to get it |
| --- | --- | --- |
| AbuseIPDB | Required for IP searches | [abuseipdb.com](https://www.abuseipdb.com) (free account) |
| VirusTotal | Required for domain and URL searches | [virustotal.com](https://www.virustotal.com) (free account) |
| ProxyCheck.io | Optional (raises the daily limit) | [proxycheck.io](https://proxycheck.io) |

A missing key disables only the source that needs it: its panel reports the error and the rest of the report is still shown.

Keys belong to the user who saves them. They are encrypted in the database (AES-256-GCM, with the key `ARGUS_SECRET_KEY` from `.env`) and decrypted only when the backend calls the matching service. They never go back to the browser: Settings shows only the last four characters. The search history is not in the database: it stays in each browser, shared by everyone who uses that browser profile.

Coming from a version that stored the keys or the preferences in the browser? On the first visit after signing in, Argus moves them to your account and removes them from the browser.

## Security model

- nginx is the only published service, and it speaks HTTPS only. Before it serves a page or forwards a request to `/api`, it asks Authelia whether the session is valid. The backend and Authelia are not published on the host.
- nginx tells the backend who is calling (`Remote-User`, replacing anything the browser sent) together with a secret shared with the backend (`ARGUS_PROXY_SECRET`). The backend refuses requests without the secret, and also users that Argus does not know or has disabled.
- Passwords are stored as Argon2id hashes. Changing a password, or turning two-factor off, needs the current one and allows 5 wrong attempts in 10 minutes.
- The registered second-factor devices belong to Authelia (`data/authelia/db.sqlite3`, encrypted with `AUTHELIA_STORAGE_ENCRYPTION_KEY`), not to Argus.
- The pages are served with a strict Content-Security-Policy and HSTS.
- `ARGUS_BIND=0.0.0.0` publishes the login on the network: use it only with a real domain and a valid certificate.

## Where the data lives

Everything Argus stores is in the `data/` folder of the project, outside git (`.gitignore` excludes it, and every `*.db` / `*.sqlite3` file as well):

| Path | What |
| --- | --- |
| `data/argus/argus.db` | The Argus database, one SQLite file: users, password hashes, API keys (encrypted), search preferences and the two-factor choice of each user. Open it with any SQLite tool, for example `sqlite3 data/argus/argus.db ".tables"` |
| `data/authelia/` | The Authelia database (registered two-factor devices, sessions) and `notification.txt`, where the verification codes are written |

The search history is not here: it stays in the browser.

The database uses SQLite's default journal, so when Argus is idle `argus.db` is the whole database: there are no `-wal` or `-shm` files next to it.

## Backup and moving Argus

Argus is the folder: to **back it up or move it to another computer** take three things.

- **`.env`**, above all `ARGUS_SECRET_KEY`. Without it the saved API keys cannot be decrypted (Settings shows them as not set and you have to enter them again). The other secrets in it are needed to open the Authelia database.
- **`certs/`**, unless you make new certificates.
- **`data/`**, with the databases.

```bash
docker compose down                                  # not strictly needed, but it guarantees a consistent copy
tar czf argus-backup.tgz .env certs data             # on Linux, the files in data/authelia belong to root: use sudo
```

On the new computer: unpack the project (`git clone`), put those three back, then `docker compose up -d --build`. No `init.sh` is needed (it would only recreate what is already there). If the domain or the port are different, change them in `.env` and make a new certificate (see [Another domain or port](#another-domain-or-port)).

Only the Argus database matters for users and keys: for a quick copy, `data/argus/argus.db` plus `.env` is enough, and the people who use two-factor will have to register their device again.

## Troubleshooting

If `docker compose up` stops with a message like "dependency failed to start" or "container ... is unhealthy", the log of that service says why:

```bash
docker compose ps
docker compose logs authelia      # or: backend, frontend
```

- **`required variable ... is missing a value`**: `.env` is missing or has empty secrets. Run `./scripts/init.sh`: it fills in only what is missing and never changes what is already set.
- **`the configured encryption key does not appear to be valid for this database`** (Authelia): `.env` was recreated, so its secrets no longer match `data/authelia`. Put the old `.env` back, or, if you can lose the registered second-factor devices, delete that folder (`docker compose down && rm -rf data/authelia`) and start again. Never change the secrets of a running installation.
- **`Cannot open the database ...` or `unable to open database file`** (backend): the user running the backend cannot write to `data/argus`. On Docker Desktop (macOS, Windows) this should not happen; on Linux `init.sh` sets `ARGUS_UID` and `ARGUS_GID` in `.env` to your user, and the folder must belong to it (`sudo chown -R $(id -u):$(id -g) data/argus`). If the folder was created by Docker as root, fix its owner the same way.
- **Users and API keys disappeared after an update**: the data was in Docker volumes and `./data` is new. Run `docker compose down && ./scripts/migrate-volumes.sh` (see [Installation](#installation)).
- **A user locked out by two-factor** (lost phone): see [Lost device or code?](#two-factor-authentication).
- **`chown: /config/configuration.yml: Read-only file system`** (Authelia): harmless, the configuration is mounted read-only on purpose.
- **Authelia does not start**: its log names the setting it rejects. The domain needs a dot (`argus.localhost`, not `localhost`), and `ARGUS_PORT_SUFFIX` must match `ARGUS_HTTPS_PORT` (empty for 443, `:8443` for 8443).
- **`port is already allocated` or `address already in use`**: another program uses the port. Set `ARGUS_HTTPS_PORT=8443` and `ARGUS_PORT_SUFFIX=:8443` in `.env`, then run `docker compose up -d` and open `https://argus.localhost:8443`.
- **The browser cannot find `argus.localhost`**: add the line printed by `init.sh` to `/etc/hosts`.
- **Start over, deleting users and saved keys**: `docker compose down -v && rm -rf data` (on Linux `sudo rm -rf data`, because Authelia creates files there as root), then `./scripts/init.sh` and `docker compose up -d --build`.

## Project structure

```
argus/
├── backend/                FastAPI application (Python)
│   ├── app/
│   │   ├── main.py         application factory, routers, security headers
│   │   ├── config.py       environment settings
│   │   ├── cli.py          user management: python -m app.cli
│   │   ├── accounts/       users, sessions, encrypted API keys, preferences (SQLite)
│   │   ├── lookups/        threat-intelligence sources
│   │   │   ├── ip/         IP sources (ip-api, AbuseIPDB, ProxyCheck.io, Shodan, BGP)
│   │   │   └── domain/     domain sources (RDAP/WHOIS, VirusTotal)
│   │   └── email_analyzer/ email header parser and analyzer
│   └── tests/
├── frontend/               React + Vite + TypeScript single-page app
│   ├── nginx/              nginx template and snippets (TLS, Authelia, API proxy)
│   └── src/
│       ├── pages/          one component per route
│       ├── components/     layout, report, settings, ui
│       ├── lib/            API client, lookups, reports, settings, exporters
│       ├── types/          shared TypeScript types
│       └── styles/         CSS split by section, imported in order by index.css
├── authelia/               Authelia configuration
├── scripts/                init.sh (secrets, certificate), migrate-volumes.sh
└── docker-compose.yml
```

## Development

Without Docker and Authelia, the backend can run for a single development user, which skips the login. **Never use this on a server.**

```bash
cd backend
pip install -r requirements.txt
export ARGUS_SECRET_KEY=$(openssl rand -base64 32) ARGUS_DEV_USER=dev ARGUS_DB_PATH=./argus-dev.db   # *.db files are ignored by git
python -m app.cli add-user dev
uvicorn app.main:app --reload
```

```bash
cd frontend
npm install
npm run dev        # http://localhost:5173, /api goes to localhost:8000
```

The backend tests run with `cd backend && python -m unittest discover -s tests -t .`. The frontend is type-checked with `npm run typecheck`.

The API documentation (`/docs`) is served by the backend, which is not published. To read it, add `ports: ["127.0.0.1:8000:8000"]` to the `backend` service: `/api` still refuses requests that do not come through nginx.

## API

Every `/api` request needs a signed-in session (the cookie set by Authelia): without one nginx answers `401` with `{"code": "login_required"}`. Each source is a separate endpoint. IP endpoints accept `{"ip": "8.8.8.8"}`.

| Endpoint | Source |
| --- | --- |
| `POST /api/iptracker` | ip-api.com and Team Cymru |
| `POST /api/proxycheck` | ProxyCheck.io |
| `POST /api/abuseipdb` | AbuseIPDB |
| `POST /api/shodan` | Shodan InternetDB |
| `POST /api/domain-whois` | RDAP / WHOIS for domains |
| `POST /api/virustotal` | VirusTotal |
| `POST /api/email/analyze` | Email header analyzer |

Private and reserved IP addresses are rejected with HTTP 422. The AbuseIPDB, ProxyCheck.io and VirusTotal endpoints use the key that the signed-in user saved in Settings (ProxyCheck.io works without one).

The account endpoints are `GET /api/me`, `POST /api/me/password`, `GET /api/keys`, `PUT /api/keys/{service}` and `DELETE /api/keys/{service}` (`abuseipdb`, `proxycheck`, `virustotal`).

## Usage notes

Only investigate IP addresses, domains and messages you are authorized to look into.

## License

Released under the MIT License. See [LICENSE](LICENSE).
