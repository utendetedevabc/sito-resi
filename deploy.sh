#!/usr/bin/env bash
# Applica le modifiche del codice al sito di PRODUZIONE (:3003).
#
# Uso:
#   ./deploy.sh              → build completo + riavvio + smoke test
#   ./deploy.sh --veloce     → riavvio SENZA build (solo modifiche ai file
#                              server/*.js — l'UI di prod non cambia)
#
# Sicurezza: riavvia SOLO il servizio systemd "sito-resi" (mai kill generici,
# mai tocca ABC HUB :3000/:3001 o il bot). Le email restano REALI in prod.
set -euo pipefail
cd "$(dirname "$0")"

PORT=3003
export XDG_RUNTIME_DIR="/run/user/$(id -u)"

BUILD=1
if [ "${1:-}" = "--veloce" ]; then
  BUILD=0
  echo "==> Modalità veloce: build saltata (solo modifiche backend)"
fi

if [ "$BUILD" = "1" ]; then
  echo "==> Build Next.js (~1 min)..."
  npm run build
fi

echo "==> Riavvio sito-resi.service..."
systemctl --user restart sito-resi.service

echo "==> Attesa avvio..."
# NB: con la socket activation le connessioni si mettono in coda invece di
# essere rifiutate → curl senza --max-time resterebbe appeso se il servizio
# non riparte. Il timeout fa fallire in fretta e riprovare al secondo dopo.
ok=""
for _ in $(seq 1 30); do
  code=$(curl -s --max-time 3 -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PORT}/" || true)
  case "$code" in
    200|302|307) ok=1; break ;;
  esac
  sleep 1
done
if [ -z "$ok" ]; then
  echo "✘ Il sito non risponde entro 30s — controlla: journalctl --user -u sito-resi -e"
  exit 1
fi

# Smoke: la pagina risponde e l'API senza token è protetta (401 atteso).
pagina=$(curl -s --max-time 20 -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PORT}/")
api=$(curl -s --max-time 20 -o /dev/null -w '%{http_code}' "http://127.0.0.1:${PORT}/api/resi")
echo "Home: HTTP ${pagina} (200/302/307 ok) — API senza token: HTTP ${api} (atteso 401)"
if [ "$api" = "401" ]; then
  echo "✔ Modifiche applicate in produzione."
else
  echo "✘ Smoke fallito (API risponde ${api} invece di 401) — controlla i log."
  exit 1
fi