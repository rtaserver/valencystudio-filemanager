# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Quick Start

```bash
bun install                    # Install deps
bun run dev                    # Dev mode: Next.js :3000 + realtime service :3003
bun run build                  # Build standalone
bun run start                  # Production mode (after build)
bun run lint                   # ESLint
bun db:push                    # Sync schema to SQLite (with data loss warning)
bun db:generate                # Regenerate Prisma Client
bun db:migrate                 # Create migration
bun db:reset                   # Reset DB completely
```

## Architecture

**ValencyStudio File Manager**: Telegram-backed cloud storage console with real-time web UI, admin analytics, and public sharing.

### Core Stack
- **Frontend**: Next.js 16 (App Router), React 19, TypeScript, shadcn/ui (Radix + Tailwind)
- **Backend**: Next.js API routes (REST), Prisma ORM + SQLite, Bun runtime
- **Realtime**: Socket.io service (separate mini-service on :3003) with fingerprint-based DB change detection
- **Storage**: Dual backend — Telegram Bot API (primary) + local filesystem fallback
- **Auth**: JWT tokens (HMAC-signed), session cookies, next-auth compatible

### Key Services

**Next.js App** (:3000)
- Page router: public share view, app shell (authenticated UI)
- API routes under `/api/*` — admin, auth, files, folders, share, public links, user management
- Session retrieval via `getSessionUser()` — checks cookie + verifies JWT

**Realtime Service** (:3003, mini-services/realtime-service/)
- Socket.io broadcast server with rooms: `user:<id>`, `admins`, `slug:<slug>`
- Emits `{domains, at, source}` on data changes (no sensitive data)
- Sources: (1) instrumented API POST /broadcast, (2) SQLite fingerprint poller (safety net)
- Used by UI for live updates — file lists, storage meter, admin panels, public counters

### Data Model

**Prisma Schema** (sqlite):
- `User` — email/hash, role (OWNER/ADMIN/USER), quota, soft-delete aware
- `Folder` — hierarchical tree, emoji/color metadata, parent cascade-delete
- `File` — name/size/mime, Telegram message IDs, download counter, share password
- `ActivityLog` — audit trail (logins, uploads, admin actions)
- `ApiToken`, `DownloadToken` — programmatic access + share links
- `PublicShare` — time-limited read-only links with optional password

Indexes on `(ownerId, parentId)` for folder hierarchy queries.

### Storage Backend

**Telegram (primary)**
- Each file part stored as a message in a bot's private channel
- Metadata (message IDs, part count) in SQLite
- Unlimited free storage; requires valid `TELEGRAM_BOT_TOKEN` + `TELEGRAM_STORAGE_CHAT_ID`
- Fallback: local files in `/app/storage/parts/` if Telegram fails

**Environment** (set at runtime or docker-compose):
- `DATABASE_URL` — SQLite path, e.g., `file:/app/db/custom.db`
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_STORAGE_CHAT_ID` — Telegram integration
- `WEB_DEFAULT_ADMIN_EMAIL`, `WEB_DEFAULT_ADMIN_PASSWORD` — initial admin
- `REALTIME_URL`, `REALTIME_INTERNAL_KEY` — socket.io service endpoint

### API Patterns

**Authentication**
- POST `/api/auth/register` — create account (optional, if registration enabled)
- POST `/api/auth/login` — set `vs_token` cookie (JWT, 7-day TTL)
- GET `/api/auth/user` — return `{id, email, role, quota, used}` or 401
- GET `/api/auth/logout` — clear cookie

**Files & Folders**
- GET `/api/files?folderId=X&q=search` — list + search (paginated, 50 default)
- POST `/api/files/upload` — multipart, returns `{id, name, size, downloadUrl}`
- DELETE `/api/files/:id` — soft-delete (mark `deletedAt`)
- GET `/api/files/:id/download` — stream file from Telegram or disk
- GET `/api/folders` — tree view with size calculations
- POST `/api/folders` — create folder under parent

**Public Shares**
- GET `/api/public/:slug` — metadata (no auth), may need password
- POST `/api/public/:slug/verify` — check password, return temp token
- GET `/api/share/:slug/file/:id` — download from share (must verify password first)

**Admin** (requires `isPrivileged()` check)
- GET `/api/admin/overview` — stats (users, files, storage, daily/weekly/monthly)
- GET `/api/admin/files?q=search` — all files (300 results)
- GET `/api/admin/users` — user list with quotas
- POST `/api/admin/users/:id/role` — update role
- GET `/api/admin/logs?type=auth|upload|share|admin` — activity audit
- GET `/api/admin/logs/export?type=X` — CSV export (formula-injection safe)
- GET `/api/admin/settings` — current config (secrets masked)
- POST `/api/admin/settings` — update config, broadcast realtime event

### Frontend Structure

**Components**
- `App` — root shell, auth check, layout with sidebar + main
- `FileManager` — folder tree, file grid, search, upload dropzone
- `AdminPanel` — overview (charts), users, files, logs, settings
- `PublicShare` — read-only view of shared files, password form
- `ui/*` — shadcn/ui primitives (buttons, dialogs, forms, tables, etc.)

**Hooks**
- `useSession()` — get current user from context + check auth
- `useFiles()` — React Query (TanStack Query) for file list, mutations
- `useRealtime()` — socket.io listener for `user:*` or `admins` rooms, triggers refetch

**State Management**
- Context for auth session + user settings
- Zustand for UI state (sidebar open/close, theme, selected file)
- React Query for server state (files, folders, activity logs)

### Deployment

**Docker**: Single image, multi-stage build
- `deps` stage: install dependencies + Prisma generate
- `builder`: Next.js build (standalone mode, static + public bundled)
- `deps-prod`: production-only node_modules (no devDeps)
- `runner`: final image (Bun, non-root user `valency`, :3000 + :3003)

**Volumes**:
- `/app/db` — SQLite database (persisted)
- `/app/storage/parts` — local file storage fallback (persisted)

**Entrypoint**: `docker/entrypoint.sh`
- Runs `prisma db push` to sync schema on startup
- Launches Next.js server (:3000) + realtime service (:3003)
- Both stay alive; if either dies, container exits

**Reverse Proxy** (Caddy or nginx):
- `:80/:443` → app `:3000` (normal HTTP)
- `:80/?XTransformPort=3003` → app `:3003` (socket.io upgrade)

## Development Workflow

**Adding a new API route**:
1. Create `src/app/api/[domain]/[resource]/route.ts`
2. Check auth: `const session = await getSessionUser(); if (!session) return jsonError(...)`
3. Use Prisma: `db.model.findMany(...)`
4. Broadcast changes: `emitChanged(['domain:resource'])` to trigger UI realtime updates

**Adding a UI component**:
1. Use shadcn/ui components from `/src/components/ui` — copy from `shadcn` CLI if needed
2. Wrap with `useSession()` to check auth
3. Fetch data with React Query: `const {data} = useQuery({queryKey: ['files'], queryFn: ...})`
4. Listen for realtime: `useEffect(() => socket.on('changed', () => refetch()), [])`

**Database changes**:
1. Edit `/prisma/schema.prisma`
2. Run `bun db:migrate` (creates migration) or `bun db:push` (direct sync, data loss risk)
3. `bun db:generate` regenerates Prisma Client (auto-run on build)

**Testing**:
- No test framework currently installed; add Jest or Vitest if needed
- Manual testing via `bun run dev` and browser/curl

## Performance & Security Notes

**Auth**: Passwords hashed with scrypt (not bcrypt). JWT verified with HMAC-SHA256, 7-day expiry. Share passwords salted per-share, not stored directly.

**Storage Limits**: Per-user quota in DB (default 1GB, -1 = unlimited). Checked at upload time; broadcast meter updates to clients via socket.io.

**Realtime Safety Net**: Fingerprint poller detects schema changes unrelated to instrumented APIs (e.g., direct DB writes, future scripts). Broad `sync` signal sent if detected, UI refetches.

**Formula Injection**: CSV export escapes leading `=+\-@` to prevent Excel injection.

**Timing-Safe Comparison**: Password verification uses `timingSafeEqual` to prevent timing attacks.

## Common Gotchas

- Bun does not auto-run PostCSS / lifecycle scripts; Prisma generate must be explicit in Docker
- Socket.io rooms are scoped per namespace — ensure client joins correct room on login
- Telegram API rate limits ~30 req/sec; bulk uploads may need retry logic
- SQLite is single-writer — concurrent DB writes may lock; no issue at normal scale (<10 concurrent users)
- Build requires `NEXT_TELEMETRY_DISABLED=1` to avoid external calls; production uses build-time placeholders for secrets
