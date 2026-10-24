from fastapi import FastAPI, Request
from fastapi.responses import HTMLResponse
from dotenv import load_dotenv

load_dotenv()

from docs_theme import render_docs  # noqa: E402
from routers import abuseipdb, domain_whois, email_analyzer, fqdn, iptracker, proxycheck, virustotal  # noqa: E402

# /docs è servito da docs_theme.py, con lo stesso stile del frontend.
app = FastAPI(title="Argus API", version="2.1.0", docs_url=None)

# Nessun CORS: il frontend chiama /api sulla propria origine (nginx in Docker,
# proxy di Vite in sviluppo), quindi i siti terzi non possono usare le chiavi API
# di Argus dal browser dell'utente.


@app.get("/health")
def health():
    return {"status": "ok"}


@app.get("/docs", include_in_schema=False)
def docs(request: Request) -> HTMLResponse:
    root_path = request.scope.get("root_path", "").rstrip("/")
    return HTMLResponse(render_docs(root_path + app.openapi_url, title="API docs"))


# IP: ogni sorgente riceve {"ip": "..."}. Il frontend le interroga in parallelo
# e unisce i risultati eliminando i campi duplicati.
app.include_router(iptracker.router, prefix="/api/iptracker", tags=["IP"])
app.include_router(abuseipdb.router, prefix="/api/abuseipdb", tags=["IP"])
app.include_router(proxycheck.router, prefix="/api/proxycheck", tags=["IP"])

# Domini e URL
app.include_router(domain_whois.router, prefix="/api/domain-whois", tags=["Domain"])
app.include_router(virustotal.router, prefix="/api/virustotal", tags=["Domain"])
app.include_router(fqdn.router, prefix="/api/fqdn", tags=["Domain"])

# Tools
app.include_router(email_analyzer.router, prefix="/api/email", tags=["Tools"])
