# ValencyStudio — Panduan Deploy Produksi

Panduan lengkap men-deploy ValencyStudio File Manager dengan Docker,
dari VPS kosong sampai situs hidup dengan HTTPS otomatis, plus alur
CI/CD GitHub Actions.

---

## 1. Arsitektur

```
                        ┌─────────────────────────────────────┐
 [browser] ─── :80/:443 │  caddy (reverse proxy + TLS auto)   │
                        └───────┬─────────────────────┬───────┘
                                │                     │  ?XTransformPort=3003
                                ▼                     ▼
                     ┌──────────────────────────────────────┐
                     │  app (1 image, non-root)             │
                     │  • Next.js standalone      :3000     │
                     │  • realtime fan-out socket :3003     │
                     │  • entrypoint: prisma db push        │
                     └───────┬───────────────────┬──────────┘
                             │                   │
                    volume app-data        volume app-storage
                      /app/db                /app/storage
                     (SQLite)              (backend penyimpanan lokal)

                     + Telegram Bot API sebagai storage backend utama
```

- **Satu image** berisi aplikasi dan realtime service — keduanya dibawakan
  oleh `docker/entrypoint.sh`; SQLite disinkronkan otomatis saat start.
- **Caddy** meneruskan request biasa ke `:3000` dan request socket.io
  (`/?XTransformPort=3003`) ke `:3003`, sekaligus menangani HTTPS otomatis.
- Semua state (database + file lokal) hidup di **volume** — upgrade image
  tidak pernah menyentuh data.

---

## 2. Prasyarat

| Kebutuhan        | Nilai                                            |
| ---------------- | ------------------------------------------------ |
| Server / VPS     | Linux 64-bit (Debian/Ubuntu/Rocky), min. 1 vCPU  |
| RAM              | Min. 1 GB                                        |
| Software         | Docker Engine 24+ **dengan compose plugin**      |
| Port terbuka     | 80 & 443 (opsional 22 untuk SSH deploy)          |
| Telegram         | Token bot (@BotFather) + grup penyimpanan        |

Cek instalasi Docker:

```bash
docker --version && docker compose version
```

---

## 3. Deploy cepat (build di server)

```bash
# 1) Ambil kode
git clone <url-repo-anda>.git valencystudio
cd valencystudio

# 2) Siapkan konfigurasi
cp .env.example .env
nano .env          # isi minimal: TELEGRAM_BOT_TOKEN & TELEGRAM_STORAGE_CHAT_ID

# 3) Build & jalankan (pertama kali ±2–5 menit)
docker compose up -d --build

# 4) Pantau boot pertama
docker compose logs -f app
```

Saat database masih kosong, container otomatis:

1. `prisma db push` — membuat semua tabel;
2. men-seed akun **owner** dari `WEB_DEFAULT_ADMIN_EMAIL` /
   `WEB_DEFAULT_ADMIN_PASSWORD`;
3. menyalakan Next.js + realtime service.

Buka `http://IP-SERVER` → login sebagai owner → **segera ganti password**
dari menu Profil.

---

## 4. Deploy dengan image dari GHCR (tanpa build di server)

Bila pipeline CD sudah jalan (bagian 8), image tersedia di
`ghcr.io/<user>/<repo>:latest`. Di server cukup:

```bash
# di .env
APP_IMAGE=ghcr.io/<user>/<repo>:latest
```

```bash
docker compose pull && docker compose up -d
```

> Agar `docker compose pull` bisa mengakses image privat: buat PAT GitHub
> dengan scope `read:packages`, lalu `docker login ghcr.io -u <user> -p <PAT>`.

---

## 5. Konfigurasi (`.env`)

| Variabel                    | Wajib | Keterangan                                                                 |
| --------------------------- | ----- | -------------------------------------------------------------------------- |
| `TELEGRAM_BOT_TOKEN`        | ✅    | Token bot dari @BotFather; bot harus ada di grup penyimpanan               |
| `TELEGRAM_STORAGE_CHAT_ID`  | ✅    | ID grup/channel storage (negatif, contoh `-1001234567890`)                 |
| `WEB_DEFAULT_ADMIN_EMAIL`   | ✅    | Email akun owner yang di-seed saat boot pertama                            |
| `WEB_DEFAULT_ADMIN_PASSWORD`| ✅    | Password awal owner — **ganti setelah login pertama**                      |
| `APP_IMAGE`                 | ➖    | Image GHCR untuk mode CD (kosong = build lokal)                            |
| `DATABASE_URL`              | ➖    | Ditimpa compose menjadi `file:/app/db/custom.db`                           |
| `REALTIME_URL`              | ➖    | Default `http://127.0.0.1:3004` (komunikasi internal container)            |
| `REALTIME_INTERNAL_KEY`     | ➖    | Key internal broadcast — ganti bila menambah hardening                     |
| `COOKIE_SECURE`             | ➖    | `1` bila dilayani via HTTPS (Caddy juga terdeteksi otomatis)               |
| `TZ`                        | ➖    | Zona waktu container, default `Asia/Jakarta`                               |

Kredensial Telegram juga bisa diatur/diubah kapan pun dari dalam aplikasi:
**Admin → Storage** (tersimpan di database).

---

## 6. HTTPS dengan domain

Edit `docker/Caddyfile`, ubah baris alamat:

```
:80  →  files.example.com
```

lalu:

```bash
docker compose restart caddy
```

Caddy menerbitkan & memperbarui sertifikat Let's Encrypt otomatis
(syarat: DNS A/AAAA domain mengarah ke server, port 80/443 terbuka).
Setelah HTTPS aktif, cookie aman terdeteksi otomatis dari
`X-Forwarded-Proto` — tidak perlu mengubah apa pun lagi.

---

## 7. Operasional harian

```bash
# Log
docker compose logs -f app        # aplikasi + realtime
docker compose logs -f caddy      # akses & TLS

# Status & health (GET /api → { ok, db, storageBackend, uptimeSec })
docker compose ps
curl -s http://localhost/api | head

# Restart
docker compose restart app

# Update ke versi terbaru
git pull && docker compose up -d --build      # mode build lokal
docker compose pull && docker compose up -d   # mode GHCR

# Matikan / mulai
docker compose down            # data di volume TETAP aman
docker compose up -d
```

### Backup

```bash
# Database (SQLite) — aman dibackup kapan pun, plus file storage lokal
docker run --rm -v valencystudio_app-data:/data -v $(pwd):/backup \
  alpine tar czf /backup/valency-db-$(date +%F).tar.gz -C /data .

docker run --rm -v valencystudio_app-storage:/data -v $(pwd):/backup \
  alpine tar czf /backup/valency-storage-$(date +%F).tar.gz -C /data .
```

> Catatan: bila backend storage adalah **Telegram** (default), file asli
> tersimpan di grup Telegram — volume `app-storage` hanya menyimpan file
> ketika backend diubah ke lokal.

### Restore

```bash
docker compose down
docker run --rm -v valencystudio_app-data:/data -v $(pwd):/backup \
  alpine sh -c "cd /data && tar xzf /backup/valency-db-TANGGAL.tar.gz"
docker compose up -d
```

---

## 8. Setup CI/CD GitHub Actions

### Yang otomatis (tanpa konfigurasi)

| Workflow    | Pemicu                    | Yang dilakukan                                             |
| ----------- | ------------------------- | ---------------------------------------------------------- |
| `ci.yml`    | push/PR ke `main`         | `bun lint` → `tsc --noEmit` → build produksi               |
| `cd.yml`    | push ke `main` / tag `v*` | build image → **smoke test** (boot fresh + probe `/api`) → push ke GHCR |

Tag versi menghasilkan image `ghcr.io/<user>/<repo>:1.2.3` (plus
`1.2` dan `latest` untuk default branch).

### Aktifkan deploy otomatis (opsional)

Tambahkan di **Settings → Secrets and variables → Actions**:

**Secrets**

| Nama              | Isi                                                      |
| ----------------- | -------------------------------------------------------- |
| `DEPLOY_SSH_HOST` | IP / hostname server                                     |
| `DEPLOY_SSH_USER` | User SSH (punya izin docker; contoh `deploy`)            |
| `DEPLOY_SSH_KEY`  | Private key Ed25519 (`cat ~/.ssh/id_ed25519`)            |
| `DEPLOY_SSH_PORT` | (opsional) port SSH, default 22                          |

**Variables**

| Nama             | Isi                                                            |
| ---------------- | -------------------------------------------------------------- |
| `DEPLOY_ENABLED` | `true`                                                         |
| `DEPLOY_PATH`    | Path folder compose di server, contoh `/opt/valencystudio`     |

Siapkan server (sekali):

```bash
# buat khusus deploy (disarankan)
sudo adduser --disabled-password deploy
sudo usermod -aG docker deploy
sudo mkdir -p /opt/valencystudio
sudo chown deploy:deploy /opt/valencystudio
```

Clone/copy repo ke `/opt/valencystudio` (docker-compose.yml + docker/ +
.env wajib ada), lalu set `APP_IMAGE` di `.env` server agar step deploy
menarik image terbaru, bukan build ulang.

Setiap push ke `main`: CI → build → smoke test → push GHCR → SSH ke
server → `docker compose pull && up -d`. Selesai dalam ±1 menit.

---

## 9. Menjalankan tanpa Caddy (proxy sendiri)

```bash
# buka hanya port aplikasi
docker compose up -d app
# di compose: buka komentar "ports: - 3000:3000"
```

Aplikasi tetap berfungsi penuh; **realtime akan fallback ke polling**
(badge LIVE berubah OFFLINE) karena socket.io tidak terproxy. Untuk
mengaktifkan realtime lewat Nginx, tambahkan rule:

```nginx
location / {
    if ($arg_XTransformPort = "3003") {
        proxy_pass http://127.0.0.1:3003;
    }
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

(`docker run` setara: `docker run -d -p 3000:3000 -p 3003:3003
--env-file .env -v valencystudio_app-data:/app/db
-v valencystudio_app-storage:/app/storage valencystudio:local`)

---

## 10. Troubleshooting

| Gejala                                          | Sebab & solusi                                                                                 |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| `docker compose logs app` → error skema         | `prisma db push` mendeteksi perubahan destruktif — periksa skema, jangan paksa `--accept-data-loss` |
| Badge realtime OFFLINE                          | Socket tidak terproxy — pastikan lewat Caddy (`?XTransformPort=3003`) atau rule Nginx di atas   |
| Upload gagal ke Telegram                        | Bot dikeluarkan dari grup / token salah → cek **Admin → Storage → Uji koneksi**                 |
| Telegram: 409 webhook conflict                  | Jalankan `https://api.telegram.org/bot<TOKEN>/deleteWebhook` sekali                             |
| `curl /api` → 503                               | Database bermasalah — cek volume & log; SQLite perlu akses tulis (user `valency` uid 1001)      |
| Image GHCR tidak bisa ditarik                   | `docker login ghcr.io` dengan PAT `read:packages`; image privat perlu login                     |
| Sertifikat tidak terbit                         | DNS belum mengarah ke server / port 80 terblokir — cek `docker compose logs caddy`              |

---

## 11. Checklist go-live

- [ ] `.env` terisi, password owner awal kuat, **sudah diganti** setelah login
- [ ] Bot Telegram ada di grup storage & **Uji koneksi** sukses di Admin → Storage
- [ ] Domain + HTTPS aktif (Caddyfile memakai domain, bukan `:80`)
- [ ] `curl /api` mengembalikan `{"ok":true,"db":"up",...}`
- [ ] Badge realtime di pojok atas aplikasi berstatus **LIVE**
- [ ] Backup otomatis terjadwal (cron host yang menarik volume `app-data`)
- [ ] CI hijau + CD men-deploy dengan sukses (bila diaktifkan)
