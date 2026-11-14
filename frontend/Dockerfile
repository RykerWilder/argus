# ---- Dependencies ----
FROM node:20-alpine AS base
WORKDIR /app
COPY package.json package-lock.json ./
# npm ci installs exactly what package-lock.json says, but stops if the lockfile is out
# of step with package.json (a dependency added without running `npm install`).
# In that case fall back to npm install so the build does not break.
RUN npm ci || npm install --no-audit --no-fund

# ---- Development: Vite server with hot reload ----
FROM base AS dev
COPY . .
EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "5173"]

# ---- Static build ----
FROM base AS build
COPY . .
RUN npm run build

# ---- Production: nginx ----
FROM nginx:1.27-alpine AS production

COPY --from=build /app/dist /usr/share/nginx/html

# The nginx config is a template: at startup the image replaces the ARGUS_* variables
# (domain and secret shared with the backend) and writes the result to
# /etc/nginx/conf.d/default.conf. The filter leaves nginx's own variables ($host, $uri...) alone.
RUN rm -f /etc/nginx/conf.d/default.conf
COPY nginx/default.conf.template /etc/nginx/templates/default.conf.template
COPY nginx/snippets/ /etc/nginx/snippets/
ENV NGINX_ENVSUBST_FILTER=^ARGUS_

# Country borders for the map (Natural Earth 1:110m, public domain), downloaded at build
# time so the site does not depend on a CDN at runtime.
ADD --chmod=644 https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-110m.json /usr/share/nginx/html/geo/countries-110m.json
# nginx must be able to traverse the folder, and the file must really be there
RUN chmod 755 /usr/share/nginx/html/geo && test -s /usr/share/nginx/html/geo/countries-110m.json

# The TLS certificate (fullchain.pem and privkey.pem) is mounted at /etc/nginx/certs (see docker-compose.yml)
EXPOSE 443

# The check runs on an internal port that is not published: it goes through neither Authelia nor TLS
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -qO- http://127.0.0.1:8081/healthz || exit 1

CMD ["nginx", "-g", "daemon off;"]
