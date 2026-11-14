FROM python:3.14-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app

# Mount points, created here so Docker copies owner and permissions into new volumes:
# /data holds the SQLite database (bind-mounted from ./data/argus); /authelia-users holds
# the users file Authelia reads (a Docker volume). The latter is world-writable (1777)
# because the container may run as the host user (ARGUS_UID), not always 1000 on Linux.
RUN useradd --create-home --shell /bin/bash appuser \
    && mkdir -p /data /authelia-users \
    && chown -R appuser:appuser /app /data \
    && chmod 1777 /authelia-users
USER appuser

ENV ARGUS_DB_PATH=/data/argus.db \
    ARGUS_AUTHELIA_USERS_FILE=/authelia-users/users_database.yml

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:8000/health', timeout=4)" || exit 1

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
