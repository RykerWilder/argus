import logging
from contextlib import asynccontextmanager

from fastapi import Depends, FastAPI, Request
from fastapi.responses import HTMLResponse

from app.accounts import router as accounts, store
from app.accounts.auth import require_user
from app.accounts.db import init_db
from app.api_docs import render_docs
from app.config import get_settings
from app.email_analyzer import analyzer as email_analyzer
from app.lookups.domain import fqdn, virustotal, whois_rdap
from app.lookups.ip import abuseipdb, iptracker, proxycheck, shodan

log = logging.getLogger("argus")


@asynccontextmanager
async def lifespan(_: FastAPI):
    # A wrong configuration means the backend does not start (see config.py).
    settings = get_settings()
    init_db()
    # Authelia reads users from a file generated from the database: keep it aligned at
    # startup, even with zero users, so Authelia finds the file instead of creating its own.
    store.write_authelia_users()
    if settings.dev_user:
        log.warning("ARGUS_DEV_USER is set (%s): requests without Remote-User are accepted. Never use this in production.", settings.dev_user)
    yield


# /docs is served by api_docs.py, styled like the frontend.
app = FastAPI(title="Argus API", version="2.3.0", docs_url=None, lifespan=lifespan)

# No CORS: the frontend calls /api on its own origin (nginx in Docker, Vite's proxy in
# development). Sign-in is done by Authelia in front of nginx; every /api route requires
# the user nginx authenticated (auth.py), and API keys are stored encrypted per user
# in the database (store.py).
protected = [Depends(require_user)]


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/docs", include_in_schema=False)
def docs(request: Request) -> HTMLResponse:
    root_path = request.scope.get("root_path", "").rstrip("/")
    return HTMLResponse(render_docs(root_path + app.openapi_url, title="API docs"))


# Account: profile, password, second factor, API keys and search preferences
app.include_router(accounts.router, prefix="/api", tags=["Account"], dependencies=protected)

# IP: each source receives {"ip": "..."}. The frontend queries them in parallel
# and merges the results, dropping duplicate fields.
app.include_router(iptracker.router, prefix="/api/iptracker", tags=["IP"], dependencies=protected)
app.include_router(abuseipdb.router, prefix="/api/abuseipdb", tags=["IP"], dependencies=protected)
app.include_router(proxycheck.router, prefix="/api/proxycheck", tags=["IP"], dependencies=protected)
app.include_router(shodan.router, prefix="/api/shodan", tags=["IP"], dependencies=protected)

# Domains and URLs
app.include_router(whois_rdap.router, prefix="/api/domain-whois", tags=["Domain"], dependencies=protected)
app.include_router(virustotal.router, prefix="/api/virustotal", tags=["Domain"], dependencies=protected)
app.include_router(fqdn.router, prefix="/api/fqdn", tags=["Domain"], dependencies=protected)

# Tools
app.include_router(email_analyzer.router, prefix="/api/email", tags=["Tools"], dependencies=protected)
