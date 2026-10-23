from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

load_dotenv()

from routers import abuseipdb, domain_whois, email_analyzer, fqdn, iptracker, proxycheck, virustotal, whois  # noqa: E402

app = FastAPI(title="Argus API", version="2.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health():
    return {"status": "ok"}


# IP: ogni sorgente riceve {"ip": "..."}. Il frontend le interroga in parallelo
# e unisce i risultati eliminando i campi duplicati.
app.include_router(iptracker.router, prefix="/api/iptracker", tags=["IP"])
app.include_router(abuseipdb.router, prefix="/api/abuseipdb", tags=["IP"])
app.include_router(whois.router, prefix="/api/whois", tags=["IP"])
app.include_router(proxycheck.router, prefix="/api/proxycheck", tags=["IP"])

# Domini e URL
app.include_router(domain_whois.router, prefix="/api/domain-whois", tags=["Domain"])
app.include_router(virustotal.router, prefix="/api/virustotal", tags=["Domain"])
app.include_router(fqdn.router, prefix="/api/fqdn", tags=["Domain"])

# Tools
app.include_router(email_analyzer.router, prefix="/api/email", tags=["Tools"])
