# Technical Specification: Telethon Core & Low-Storage Streaming

**Project:** ValencyStudio FileManager  
**Date:** 2026-10-16  
**Status:** Approved for Implementation Planning  
**Target:** Replace Bot API 16 MB multipart splitting with persistent Telethon MTProto streaming core for up to 2,000,000,000 byte single-document uploads/downloads with near-zero temporary disk and bounded RAM.

---

## 1. Executive Summary & Goals

### 1.1 Objectives
1. **Primary Core**: Use Telethon (`TelegramClient` over MTProto) as the central transfer and storage engine for Telegram operations.
2. **End-to-End Streaming**: Stream data continuously (`Browser ↔ Next.js ↔ Telethon Core ↔ Telegram MTProto`) without buffering entire files in memory or spooling complete files to temporary disk.
3. **Single Telegram Document**: Every newly uploaded file corresponds to exactly **one Telegram message/document**, removing the legacy 16 MB chunking algorithm for new uploads.
4. **Hard Size Limit**: Enforce `MAX_UPLOAD_BYTES = 2_000_000_000` (2,000,000,000 bytes) across all users and layers.
5. **Full Feature & Backward Compatibility**: Preserve existing features (previews with Range requests, share links, zero-copy duplicates, trash/restore, permanent deletion with shared reference tracking) and maintain seamless download compatibility for legacy files stored as multiple `parts`.

---

## 2. Architecture & Components

```
┌────────────────────────────────────────────────────────────────────────┐
│ Client (Browser)                                                       │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ HTTP Stream (octet-stream / range)
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ Next.js App (:3000, Bun runtime)                                       │
│ • Auth & User Session Verification (JWT cookie)                        │
│ • Quota & 2,000,000,000 byte limit enforcement                         │
│ • SQLite / Prisma metadata manager                                     │
│ • Backward-compatible dispatcher (Telethon vs Legacy Parts)            │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ HTTP Stream (Loopback :3005)
                                    │ Headers: X-Internal-Key, Content-Length
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ Telethon Core Service (:3005, Python 3 / asyncio / FastAPI)            │
│ • Persistent TelegramClient (Singleton MTProto connection)             │
│ • AsyncStreamReader with backpressure & chunked read(size)             │
│ • Incremental SHA-256 calculation                                      │
│ • Semaphore-governed upload concurrency (TELETHON_MAX_CONCURRENT_UPLOADS)
│ • Streaming iter_download with byte-range support                      │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │ MTProto protocol
                                    ▼
┌────────────────────────────────────────────────────────────────────────┐
│ Telegram Cloud (Storage Chat / Channel)                                │
│ • 1 Document per Message (up to 2,000,000,000 bytes)                   │
└────────────────────────────────────────────────────────────────────────┘
```

### 2.1 Component Breakdown

#### A. Telethon Core Service (`mini-services/telethon-core/`)
- **Runtime**: Python 3.10+ running in a persistent virtual environment (`.venv`).
- **Framework**: FastAPI + Uvicorn (standard async event loop).
- **Network Interface**: Binds strictly to `127.0.0.1:3005` (loopback only, never exposed to internet).
- **Authentication**: Secured via `X-Internal-Key: <TELETHON_INTERNAL_KEY>`.
- **Core Modules**:
  - `main.py`: REST routes (`/health`, `/upload`, `/download/{message_id}`, `/message/{message_id}`).
  - `client_manager.py`: Manages persistent `TelegramClient` lifecycle, MTProto reconnects, entity caching, and graceful shutdown.
  - `stream_reader.py`: Custom `AsyncStreamReader` providing async `read(size)` over incoming HTTP request body stream for Telethon's `client.upload_file()`.
  - `config.py`: Configuration validation and environment parsing.

#### B. Next.js Backend & API Routes (`src/app/api/`)
- `/api/files/upload-stream`: Accepts streaming raw `application/octet-stream` upload, creates `PENDING` DB row, and pipes the stream directly to Telethon Core.
- `/api/files/[id]/download`: Checks file reference type:
  - If `ref` starts with `telethon:`, pipes streaming response from Telethon Core to client (supporting `Range` headers for seeking).
  - If `ref` starts with `tg:` or `local:`, invokes legacy `buildFileResponse` (iterating over parts).
- `/api/files/[id]/route.ts`: On permanent delete, checks shared references in SQLite; if unshared, signals Telethon Core to delete the Telegram message.

#### C. Database & Schema Compatibility
- The `File.parts` column in SQLite stores a JSON array:
  - **New Files**: `[{"ref": "telethon:<chatId>:<messageId>", "size": <bytes>}]` (always length 1).
  - **Legacy Files**: `[{"ref": "tg:<fileId>:<messageId>", "size": 16777216}, ...]` or `[{"ref": "local:...", "size": ...}]`.
- Zero-copy duplication creates a new `File` row with identical `parts` string, avoiding redundant storage.
- Permanent deletion scans all `File.parts` rows to prevent deleting messages still referenced by duplicate copies.

---

## 3. Streaming Data Pipeline & Low-Storage Design

### 3.1 Upload Pipeline
1. **Initiation**: Browser streams file via `POST /api/files/upload-stream` with headers:
   - `x-file-name`: URI-encoded original file name.
   - `x-file-size`: Total file size in bytes.
   - `x-folder-id`: Optional target folder ID.
   - `content-type`: MIME type (or `application/octet-stream`).
2. **Next.js Validation**:
   - Validates user auth (`getSessionUser`).
   - Checks size: must be `> 0` and `<= 2_000_000_000`.
   - Checks user quota: `usedBytes + fileSize <= quota`.
   - Creates `File` record with `status: 'PENDING'`.
3. **Piping to Telethon Core**:
   - Next.js issues `POST http://127.0.0.1:3005/upload` with `req.body` (web `ReadableStream`) passed as fetch body (`duplex: 'half'`).
   - Incremental transform streams through Next.js without saving to disk or buffering into memory.
4. **Telethon Core Handling**:
   - `AsyncStreamReader` receives stream chunks with an async bounded queue (depth = 4 chunks, chunk size 512 KiB).
   - Telethon calls `reader.read(size)` to construct MTProto file parts.
   - Telethon pushes parts to Telegram DC using MTProto protocol.
   - Concurrently computes SHA-256 hash.
   - Returns JSON: `{ ok: true, messageId: int, documentId: string, size: int, checksum: string }`.
5. **Finalization**:
   - Next.js updates DB record: `status = 'READY'`, `parts = JSON.stringify([{ ref: "telethon:" + chatId + ":" + messageId, size }])`.
   - Triggers `emitChanged(['files'])` via Socket.io.
   - If stream is aborted or fails, Next.js marks file `FAILED` or deletes orphan records and requests Telethon to delete any dangling message.

### 3.2 Download & Range Request Pipeline
1. **Request**: Browser requests file or range (e.g. `Range: bytes=1048576-2097151`).
2. **Dispatch**:
   - Next.js reads `file.parts`. If `ref.startsWith('telethon:')`, extracts `chatId` and `messageId`.
   - Calls `GET http://127.0.0.1:3005/download/{message_id}` passing `Range` and query parameters.
3. **Telethon Streaming**:
   - Telethon fetches message document.
   - Uses `client.iter_download(document, offset=start, limit=length, request_size=512*1024)`.
   - Yields chunks as a FastAPI `StreamingResponse`.
4. **Delivery**:
   - Next.js pipes stream to Browser with HTTP `206 Partial Content` (or `200 OK`), `Content-Range`, `Content-Length`, `Content-Disposition`, and `Accept-Ranges: bytes`.
   - If client disconnects, async cancellation cascades and stops Telegram download immediately.

---

## 4. Configuration & Environment Variables

| Variable | Description | Default / Required |
|---|---|---|
| `TELETHON_API_ID` | Telegram API ID from my.telegram.org | Required |
| `TELETHON_API_HASH` | Telegram API Hash from my.telegram.org | Required |
| `TELETHON_BOT_TOKEN` | Bot token fallback for non-interactive MTProto | Optional / Falls back to `TELEGRAM_BOT_TOKEN` |
| `TELETHON_SESSION_PATH` | Path to persistent sqlite session file | `/app/db/telethon.session` |
| `TELETHON_STORAGE_CHAT_ID` | Telegram channel/group chat ID for storage | Required (matches `TELEGRAM_STORAGE_CHAT_ID`) |
| `TELETHON_INTERNAL_KEY` | Shared secret between Next.js and Telethon Core | `vs-telethon-internal-key` |
| `TELETHON_CORE_URL` | Telethon Core internal HTTP URL | `http://127.0.0.1:3005` |
| `TELETHON_MAX_CONCURRENT_UPLOADS` | Maximum simultaneous MTProto uploads | `1` |
| `MAX_UPLOAD_BYTES` | Maximum file size in bytes | `2000000000` |

---

## 5. Security & Resource Protection

1. **Isolation**: Telethon Core only binds to loopback (`127.0.0.1`), never exposed to external ports.
2. **Authentication**: All endpoints require `X-Internal-Key` matching `TELETHON_INTERNAL_KEY`.
3. **Bounded Memory**:
   - No `Buffer.concat()`, `arrayBuffer()`, or unbounded arrays.
   - Memory per stream is strictly bounded (<= 16 MB peak per active upload/download).
4. **Concurrency Governance**:
   - Controlled via `asyncio.Semaphore(TELETHON_MAX_CONCURRENT_UPLOADS)` in Python.
   - Extra requests receive `HTTP 429` or queue with timeout.
5. **No Temporary Disk Usage**:
   - Temporary files on disk are completely avoided in standard streaming paths.
6. **Session Security**:
   - Session files stored in `/app/db/` with `0600` permissions owned by container user `valency`.
   - Never logged or exposed in client responses.

---

## 6. Docker & Deployment Updates

1. **Dockerfile**:
   - Install Python 3, `python3-venv`, and build prerequisites.
   - Build a virtualenv at `/app/mini-services/telethon-core/.venv` and install `telethon`, `fastapi`, `uvicorn`, `cryptography`.
   - Copy service files to `/app/mini-services/telethon-core/`.
2. **Entrypoint (`docker/entrypoint.sh`)**:
   - Activate `.venv`.
   - Launch Telethon Core in background:
     ```sh
     python /app/mini-services/telethon-core/main.py &
     ```
   - Healthcheck loop: poll `http://127.0.0.1:3005/health` until ready before starting Next.js.
   - Trap `SIGTERM` / `SIGINT` to gracefully stop Next.js, Realtime service, and Telethon Core.

---

## 7. Verification & Test Plan

A dedicated test suite (`tests/streaming-storage.test.ts` and `tests/telethon-core-test.py`) will be developed to verify:
1. **Zero-Spool Verification**:
   - Monitor disk usage in `/tmp` and working directory during 16 MB, 17 MB, and 100 MB uploads/downloads; assert 0 bytes temp disk allocated.
2. **2,000,000,000 Byte Exact Boundary**:
   - Send exactly 2,000,000,000 bytes: Accepted and processed.
   - Send 2,000,000,001 bytes: Rejected with HTTP 413, stream closed immediately.
3. **Checksum Verification**:
   - Compare SHA-256 of uploaded file with downloaded stream to verify bit-for-bit integrity.
4. **Client Disconnect & Abort**:
   - Abort stream halfway; verify Telethon releases resources and leaves no orphan message.
5. **Legacy Compatibility**:
   - Verify that downloading pre-existing multi-part files continues to work without regression.
6. **Zero-Copy Duplicate & Reference Deletion**:
   - Verify duplicating creates no new Telegram message.
   - Verify deleting one duplicate does not delete the shared Telegram message, while deleting the final copy deletes it from Telegram.
