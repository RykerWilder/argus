# ---- Dipendenze ----
FROM node:20-alpine AS base
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

# ---- Sviluppo: server Vite con hot-reload ----
FROM base AS dev
COPY . .
EXPOSE 5173
CMD ["npm", "run", "dev", "--", "--host", "0.0.0.0", "--port", "5173"]

# ---- Build statica ----
FROM base AS build
COPY . .
RUN npm run build

# ---- Produzione: nginx ----
FROM nginx:1.27-alpine AS production

COPY --from=build /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY nginx-snippets/ /etc/nginx/snippets/

# Confini dei paesi (Natural Earth 1:110m, pubblico dominio) per la mappa:
# scaricati in fase di build così il sito non dipende da una CDN a runtime.
ADD --chmod=644 https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-110m.json /usr/share/nginx/html/geo/countries-110m.json

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -qO- http://localhost:80 || exit 1

CMD ["nginx", "-g", "daemon off;"]
