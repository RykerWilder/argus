#!/usr/bin/env bash
# Moves into ./data the data of an install that kept it in Docker volumes (Argus versions
# before the ./data folder): the Argus database (users, encrypted API keys) and the
# Authelia one (second-factor devices).
#
# Usage:  docker compose down
#         ./scripts/migrate-volumes.sh [--argus-volume NAME] [--authelia-volume NAME]
#         docker compose up -d --build
#
# It neither modifies nor deletes the volumes: they stay where they are until you remove them.
set -euo pipefail

ARGUS_VOLUME=""
AUTHELIA_VOLUME=""

usage() {
    cat <<'USAGE'
Copies the data of an earlier Argus install from its Docker volumes into ./data.

Usage: ./scripts/migrate-volumes.sh [options]
  --argus-volume NAME     volume with the Argus database (default: <project>_argus-data)
  --authelia-volume NAME  volume with the Authelia database (default: <project>_authelia-data)

Stop Argus first (docker compose down). The volumes are copied, not removed.
USAGE
    exit "${1:-0}"
}

while [ $# -gt 0 ]; do
    case "$1" in
        --argus-volume)    ARGUS_VOLUME="${2:-}"; shift 2 ;;
        --authelia-volume) AUTHELIA_VOLUME="${2:-}"; shift 2 ;;
        -h|--help)         usage 0 ;;
        *)                 echo "Unknown option: $1" >&2; usage 1 ;;
    esac
done

die() { echo "Error: $*" >&2; exit 1; }

command -v docker >/dev/null 2>&1 || die "docker is required."
docker info >/dev/null 2>&1 || die "Docker is not running. Start it and run this script again."

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Compose project name: COMPOSE_PROJECT_NAME or the folder name, as Compose does
PROJECT="${COMPOSE_PROJECT_NAME:-$(basename "$ROOT" | tr 'A-Z' 'a-z' | tr -cd 'a-z0-9_-')}"
VOLUMES="$(docker volume ls -q)"

# The volume with the expected name, or the only one ending with that name
find_volume() {
    local suffix="$1" found
    if printf '%s\n' "$VOLUMES" | grep -qx "${PROJECT}_${suffix}"; then
        echo "${PROJECT}_${suffix}"
        return 0
    fi
    found="$(printf '%s\n' "$VOLUMES" | grep -E "(^|_)${suffix}\$" || true)"
    if [ "$(printf '%s' "$found" | grep -c .)" -gt 1 ]; then
        echo "Several volumes end with '$suffix':" >&2
        printf '%s\n' "$found" | sed 's/^/  /' >&2
        die "pick one with --${suffix%-data}-volume NAME."
    fi
    printf '%s' "$found"
}

[ -n "$ARGUS_VOLUME" ] || ARGUS_VOLUME="$(find_volume argus-data)"
[ -n "$AUTHELIA_VOLUME" ] || AUTHELIA_VOLUME="$(find_volume authelia-data)"

[ -n "$ARGUS_VOLUME" ] || die "no Docker volume with the Argus database was found (looked for ${PROJECT}_argus-data). Nothing to move: start Argus normally."
printf '%s\n' "$VOLUMES" | grep -qx "$ARGUS_VOLUME" || die "the volume '$ARGUS_VOLUME' does not exist."
if [ -n "$AUTHELIA_VOLUME" ]; then
    printf '%s\n' "$VOLUMES" | grep -qx "$AUTHELIA_VOLUME" || die "the volume '$AUTHELIA_VOLUME' does not exist."
fi

# With Argus running the database may be in the middle of a write
if [ -n "$(docker compose ps -q 2>/dev/null || true)" ]; then
    die "Argus is running. Stop it first: docker compose down"
fi

if [ -e data/argus/argus.db ]; then
    die "data/argus/argus.db already exists, and this script never overwrites a database. If it is the empty one created by a first start, delete it (rm data/argus/argus.db) and run this script again."
fi
if [ -n "$AUTHELIA_VOLUME" ] && [ -e data/authelia/db.sqlite3 ]; then
    die "data/authelia/db.sqlite3 already exists. If it is the one created by a first start, delete it (rm -r data/authelia) and run this script again."
fi

# User the backend runs as: the one in .env (Linux) or 1000, as in docker-compose.yml
env_value() { [ -f .env ] && sed -n "s/^$1=//p" .env | head -n 1 || true; }
UID_IN="$(env_value ARGUS_UID)"; UID_IN="${UID_IN:-1000}"
GID_IN="$(env_value ARGUS_GID)"; GID_IN="${GID_IN:-1000}"

mkdir -p data/argus data/authelia

echo "Copying $ARGUS_VOLUME -> ./data/argus"
docker run --rm -v "$ARGUS_VOLUME":/from:ro -v "$ROOT/data/argus":/to alpine \
    sh -c "cp -a /from/. /to/ && { chown -R $UID_IN:$GID_IN /to 2>/dev/null || true; }"
[ -f data/argus/argus.db ] || die "the volume '$ARGUS_VOLUME' has no argus.db: is it the right one? Use --argus-volume NAME."

if [ -n "$AUTHELIA_VOLUME" ]; then
    echo "Copying $AUTHELIA_VOLUME -> ./data/authelia"
    docker run --rm -v "$AUTHELIA_VOLUME":/from:ro -v "$ROOT/data/authelia":/to alpine sh -c 'cp -a /from/. /to/'
else
    echo "No Authelia volume found: skipping it (Authelia creates a new database; registered second-factor devices, if any, have to be registered again)."
fi

cat <<DONE

Done. The old volumes were not touched.
  Argus database:  ./data/argus/argus.db
  Authelia data:   ./data/authelia

Start Argus again with:  docker compose up -d --build
Check that you can sign in and your API keys are in place, then you can delete the old volumes:
  docker volume rm $ARGUS_VOLUME${AUTHELIA_VOLUME:+ $AUTHELIA_VOLUME}
DONE
