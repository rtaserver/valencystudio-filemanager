#!/bin/sh
# ─────────────────────────────────────────────────────────────
# ValencyStudio — container entrypoint
#   1. Sinkronisasi skema SQLite (prisma db push — idempotent)
#   2. Realtime fan-out service (socket.io :3003, auto-restart)
#   3. Next.js standalone server (:3000, foreground/PID-utama)
# ─────────────────────────────────────────────────────────────
set -e

PORT="${PORT:-3000}"
DB_FILE="${REALTIME_DB_PATH:-/app/db/custom.db}"
export DATABASE_URL="${DATABASE_URL:-file:${DB_FILE}}"
export REALTIME_DB_PATH="$DB_FILE"
export REALTIME_URL="${REALTIME_URL:-http://127.0.0.1:3004}"

mkdir -p /app/db /app/storage/parts

echo "[valency] sinkronisasi skema database…"
bunx prisma db push --accept-data-loss --skip-generate --schema /app/prisma/schema.prisma

echo "[valency] menyalakan telethon core service (loopback :3005)…"
(
  cd /app/mini-services/telethon-core
  while true; do
    /app/mini-services/telethon-core/.venv/bin/python main.py \
      || echo "[valency] telethon core berhenti — restart dalam 3 detik…"
    sleep 3
  done
) &

# Tunggu telethon core siap
for i in $(seq 1 15); do
  if bun -e "const r = await fetch('http://127.0.0.1:3005/health').catch(()=>null); process.exit(r && r.ok ? 0 : 1)" 2>/dev/null; then
    echo "[valency] telethon core siap."
    break
  fi
  sleep 1
done

echo "[valency] menyalakan realtime fan-out service (loopback :3003)…"
(
  while true; do
    bun /app/mini-services/realtime-service/index.ts \
      || echo "[valency] realtime service berhenti — restart dalam 3 detik…"
    sleep 3
  done
) &

echo "[valency] ValencyStudio berjalan di port ${PORT}"
exec bun /app/server.js
