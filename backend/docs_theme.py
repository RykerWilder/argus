"""Pagina /docs con lo stesso stile del frontend di Argus.

FastAPI genera la pagina Swagger UI con i colori di default. Qui la si costruisce
a mano con gli stessi script (Swagger UI da jsDelivr, come fa FastAPI) e si
aggiunge il foglio di stile `docs_theme.css`, più header e footer uguali a quelli
del frontend. Le opzioni di Swagger sono quelle predefinite di FastAPI, tranne
`syntaxHighlight`, disattivato perché i colori della sintassi non fanno parte
della palette di Argus.
"""
import json
from datetime import datetime, timezone
from html import escape
from pathlib import Path
from urllib.parse import quote

SWAGGER_CSS = "https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css"
SWAGGER_JS = "https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"
FONTS_CSS = (
    "https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500"
    "&family=Geist+Mono:wght@400;500&display=swap"
)

_THEME_CSS = (Path(__file__).with_name("docs_theme.css")).read_text(encoding="utf-8")

# Stessa icona del frontend (frontend/public/favicon.svg), incorporata nella pagina.
_FAVICON_SVG = (
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="#151515"/>'
    '<g fill="#9a9a95"><circle cx="7" cy="7" r="3"/><circle cx="16" cy="7" r="3"/><circle cx="25" cy="7" r="3"/>'
    '<circle cx="7" cy="16" r="3"/><circle cx="25" cy="16" r="3"/><circle cx="7" cy="25" r="3"/>'
    '<circle cx="16" cy="25" r="3"/><circle cx="25" cy="25" r="3"/></g>'
    '<circle cx="16" cy="16" r="4.4" fill="#3dffc5"/></svg>'
)
_FAVICON = "data:image/svg+xml," + quote(_FAVICON_SVG)

# Il logo del frontend (components/Header.jsx): otto punti e un occhio centrale.
_LOGO = """<span class="logo" aria-label="Argus">
        <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true" class="logo__mark">
          <g fill="currentColor">
            <circle cx="4" cy="4" r="2.2"/><circle cx="12" cy="4" r="2.2"/><circle cx="20" cy="4" r="2.2"/>
            <circle cx="4" cy="12" r="2.2"/><circle cx="20" cy="12" r="2.2"/>
            <circle cx="4" cy="20" r="2.2"/><circle cx="12" cy="20" r="2.2"/><circle cx="20" cy="20" r="2.2"/>
          </g>
          <circle cx="12" cy="12" r="3.4" fill="#3dffc5"/>
        </svg>
        <span>Argus</span>
      </span>"""


def render_docs(openapi_url: str, title: str = "API docs") -> str:
    """HTML della pagina /docs. `openapi_url` è il percorso dello schema OpenAPI."""
    year = datetime.now(timezone.utc).year
    # json.dumps non protegge da "</script>" dentro la stringa
    url_js = json.dumps(openapi_url).replace("</", "<\\/")
    return f"""<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <meta name="theme-color" content="#151515">
    <title>{escape(title)} · Argus</title>
    <link rel="icon" type="image/svg+xml" href="{_FAVICON}">
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link rel="stylesheet" href="{FONTS_CSS}">
    <link rel="stylesheet" href="{SWAGGER_CSS}">
    <style>
{_THEME_CSS}
    </style>
  </head>
  <body>
    <div class="page">
      <header class="site-header">
        {_LOGO}
        <nav class="site-header__nav">
          <a class="bracket" href="{escape(openapi_url, quote=True)}"><span aria-hidden="true">[</span><span class="bracket__label">OpenAPI JSON</span><span aria-hidden="true">]</span></a>
        </nav>
      </header>

      <main>
        <div id="swagger-ui"></div>
      </main>

      <footer class="site-footer">
        <span>© {year} RykerWilder</span>
        <span class="site-footer__credit">Developed by <strong>RykerWilder</strong></span>
        <span class="site-footer__motto">From a SOC analyst, for SOC analysts</span>
      </footer>
    </div>

    <script src="{SWAGGER_JS}"></script>
    <script>
      window.ui = SwaggerUIBundle({{
        url: {url_js},
        dom_id: "#swagger-ui",
        layout: "BaseLayout",
        deepLinking: true,
        showExtensions: true,
        showCommonExtensions: true,
        syntaxHighlight: false,
        presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset],
      }});
    </script>
  </body>
</html>
"""
