# Telethon Core & Low-Storage Streaming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Integrate a persistent Python Telethon MTProto service with Next.js/Bun to stream uploads and downloads up to 2,000,000,000 bytes as single Telegram documents with near-zero temporary disk and bounded RAM.

**Architecture:** A standalone Python microservice (`mini-services/telethon-core`) running FastAPI/Uvicorn on loopback (`127.0.0.1:3005`) manages a persistent `TelegramClient` connection to Telegram MTProto. Next.js communicates with this service via internal streaming HTTP requests, piping browser streams directly through to Telethon's async stream reader and streaming downloads back to clients with full HTTP Range request support.

**Tech Stack:** Python 3 (Telethon, FastAPI, Uvicorn, Cryptography), Next.js 16 (App Router), Bun runtime, TypeScript, Prisma (SQLite), Docker multi-stage.

**Spec:** `docs/superpowers/specs/2026-10-16-telethon-core-streaming-design.md`

## Global Constraints

- Maximum upload limit is strictly `2_000_000_000` bytes (2,000,000,000 bytes, not 2 GiB).
- End-to-end streaming without writing full files to disk or holding entire files in RAM (`Buffer.concat()` and `arrayBuffer()` on whole large files are forbidden).
- Every new file creates exactly one Telegram document/message; no 16 MB chunk splitting for new files.
- Backward compatibility: legacy files with multiple 16 MB `parts` (`tg:` or `local:`) must continue to download seamlessly.
- Telethon Core must bind strictly to `127.0.0.1:3005` protected by `X-Internal-Key`.
- Persistent session storage in `/app/db/telethon.session` with secure permissions.

## Review Focus

1. Upload boundary at 2,000,000,000 bytes: exactly 2,000,000,000 bytes is accepted; 2,000,000,001 bytes is rejected with HTTP 413 and stream aborted.
2. Sudden client disconnect during upload: Next.js and Telethon Core immediately stop MTProto transfer, clean up partial state, and leave no orphan Telegram message.
3. Sudden client disconnect during download: Telethon iterator terminates and cancels the MTProto stream immediately without leaking sockets.
4. Seeking / Range requests on video/audio: `Range: bytes=start-end` yields `206 Partial Content` with exact byte slices streamed directly from Telegram.
5. Zero-copy duplicate files: duplicating a file copies only SQLite metadata with identical `parts`; deleting one copy does not delete the shared Telegram message until the last reference is removed.

---

### Task 1: Python Telethon Core Scaffolding & Configuration

**Files:**
- Create: `mini-services/telethon-core/requirements.txt`
- Create: `mini-services/telethon-core/config.py`
- Create: `mini-services/telethon-core/test_config.py`

**Interfaces:**
- Produces: `config.get_settings() -> Settings` with fields: `api_id`, `api_hash`, `bot_token`, `session_path`, `storage_chat_id`, `internal_key`, `max_concurrent_uploads`, `max_upload_bytes`, `port`.

- [ ] **Step 1: Write test for configuration loading and validation**

Create `mini-services/telethon-core/test_config.py`:
```python
import os
import unittest
from unittest.mock import patch
from config import get_settings

class TestConfig(unittest.TestCase):
    @patch.dict(os.environ, {
        "TELETHON_API_ID": "12345",
        "TELETHON_API_HASH": "abcdef1234567890abcdef1234567890",
        "TELETHON_BOT_TOKEN": "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11",
        "TELETHON_STORAGE_CHAT_ID": "-100123456789",
        "TELETHON_INTERNAL_KEY": "test-key-123",
        "MAX_UPLOAD_BYTES": "2000000000",
    })
    def test_valid_config(self):
        cfg = get_settings()
        self.assertEqual(cfg.api_id, 12345)
        self.assertEqual(cfg.api_hash, "abcdef1234567890abcdef1234567890")
        self.assertEqual(cfg.bot_token, "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11")
        self.assertEqual(cfg.storage_chat_id, -100123456789)
        self.assertEqual(cfg.internal_key, "test-key-123")
        self.assertEqual(cfg.max_upload_bytes, 2000000000)
        self.assertEqual(cfg.port, 3005)

    @patch.dict(os.environ, {
        "TELETHON_API_ID": "invalid",
    }, clear=True)
    def test_invalid_api_id(self):
        with self.assertRaises(ValueError):
            get_settings()

if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python mini-services/telethon-core/test_config.py`
Expected: FAIL (cannot import `config` or module missing).

- [ ] **Step 3: Create requirements.txt and config.py**

Create `mini-services/telethon-core/requirements.txt`:
```txt
telethon>=1.36.0
fastapi>=0.110.0
uvicorn>=0.28.0
cryptography>=42.0.0
```

Create `mini-services/telethon-core/config.py`:
```python
import os
from dataclasses import dataclass

@dataclass(frozen=True)
class Settings:
    api_id: int
    api_hash: str
    bot_token: str
    session_path: str
    storage_chat_id: int
    internal_key: str
    max_concurrent_uploads: int
    max_upload_bytes: int
    port: int

def get_settings() -> Settings:
    api_id_raw = os.getenv("TELETHON_API_ID", os.getenv("TELEGRAM_API_ID", "0")).strip()
    try:
        api_id = int(api_id_raw)
    except ValueError:
        raise ValueError("TELETHON_API_ID must be a valid integer")

    api_hash = os.getenv("TELETHON_API_HASH", os.getenv("TELEGRAM_API_HASH", "")).strip()
    bot_token = os.getenv("TELETHON_BOT_TOKEN", os.getenv("TELEGRAM_BOT_TOKEN", "")).strip()
    session_path = os.getenv("TELETHON_SESSION_PATH", "/app/db/telethon.session").strip()

    chat_id_raw = os.getenv("TELETHON_STORAGE_CHAT_ID", os.getenv("TELEGRAM_STORAGE_CHAT_ID", "0")).strip()
    try:
        storage_chat_id = int(chat_id_raw)
    except ValueError:
        storage_chat_id = 0

    internal_key = os.getenv("TELETHON_INTERNAL_KEY", "vs-telethon-internal-key").strip()
    
    try:
        max_concurrent_uploads = int(os.getenv("TELETHON_MAX_CONCURRENT_UPLOADS", "1"))
    except ValueError:
        max_concurrent_uploads = 1

    try:
        max_upload_bytes = int(os.getenv("MAX_UPLOAD_BYTES", "2000000000"))
    except ValueError:
        max_upload_bytes = 2_000_000_000

    try:
        port = int(os.getenv("PORT", "3005"))
    except ValueError:
        port = 3005

    return Settings(
        api_id=api_id,
        api_hash=api_hash,
        bot_token=bot_token,
        session_path=session_path,
        storage_chat_id=storage_chat_id,
        internal_key=internal_key,
        max_concurrent_uploads=max_concurrent_uploads,
        max_upload_bytes=max_upload_bytes,
        port=port,
    )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python mini-services/telethon-core/test_config.py`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mini-services/telethon-core/requirements.txt mini-services/telethon-core/config.py mini-services/telethon-core/test_config.py
git commit -m "feat(telethon-core): add requirements and configuration module"
```

---

### Task 2: AsyncStreamReader with Backpressure & Size Boundary

**Files:**
- Create: `mini-services/telethon-core/stream_reader.py`
- Create: `mini-services/telethon-core/test_stream_reader.py`

**Interfaces:**
- Produces: `AsyncStreamReader` class wrapping an async byte generator with methods:
  - `__init__(stream_gen, total_size: int, max_bytes: int = 2_000_000_000)`
  - `async read(size: int = -1) -> bytes`: yields requested bytes up to size, throws `ValueError` if `total_read > max_bytes`.
  - `get_sha256() -> str`: returns calculated hex digest.
  - `tell() -> int`: current offset.
  - `close()`: cleanup.

- [ ] **Step 1: Write test for AsyncStreamReader**

Create `mini-services/telethon-core/test_stream_reader.py`:
```python
import asyncio
import hashlib
import unittest
from stream_reader import AsyncStreamReader

class TestAsyncStreamReader(unittest.IsolatedAsyncioTestCase):
    async def test_chunked_reading_and_hash(self):
        raw_data = b"Hello, Telethon streaming world! " * 1000
        expected_hash = hashlib.sha256(raw_data).hexdigest()

        async def chunk_generator():
            chunk_size = 256
            for i in range(0, len(raw_data), chunk_size):
                yield raw_data[i:i + chunk_size]

        reader = AsyncStreamReader(chunk_generator(), total_size=len(raw_data), max_bytes=2_000_000_000)
        
        collected = bytearray()
        while True:
            chunk = await reader.read(512)
            if not chunk:
                break
            collected.extend(chunk)

        self.assertEqual(bytes(collected), raw_data)
        self.assertEqual(reader.get_sha256(), expected_hash)
        self.assertEqual(reader.tell(), len(raw_data))

    async def test_exceeding_max_bytes_raises_error(self):
        async def endless_generator():
            chunk = b"x" * 1024
            while True:
                yield chunk

        # Set limit to 2048 bytes
        reader = AsyncStreamReader(endless_generator(), total_size=5000, max_bytes=2048)
        
        with self.assertRaises(ValueError) as ctx:
            while True:
                chunk = await reader.read(1024)
                if not chunk:
                    break
        self.assertIn("exceeds maximum allowed limit", str(ctx.exception))

if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python mini-services/telethon-core/test_stream_reader.py`
Expected: FAIL (cannot import `AsyncStreamReader`).

- [ ] **Step 3: Implement AsyncStreamReader**

Create `mini-services/telethon-core/stream_reader.py`:
```python
import hashlib
from typing import AsyncGenerator, Optional

class AsyncStreamReader:
    """
    Adapter that wraps an async byte generator into a file-like reader
    compatible with Telethon's upload_file, enforcing backpressure,
    bounded RAM, incremental SHA-256 calculation, and strict size limits.
    """
    def __init__(self, stream_gen: AsyncGenerator[bytes, None], total_size: int, max_bytes: int = 2_000_000_000, name: str = "stream"):
        self.stream_gen = stream_gen
        self.total_size = total_size
        self.max_bytes = max_bytes
        self.name = name
        self.total_read = 0
        self._buffer = bytearray()
        self._hasher = hashlib.sha256()
        self._closed = False
        self._eof = False

    def tell(self) -> int:
        return self.total_read

    def get_sha256(self) -> str:
        return self._hasher.hexdigest()

    async def read(self, size: int = -1) -> bytes:
        if self._closed:
            return b""
        
        # If size is negative, read remaining (note: caller should request chunks)
        target_size = size if size > 0 else 512 * 1024

        while len(self._buffer) < target_size and not self._eof:
            try:
                chunk = await self.stream_gen.__anext__()
                if not chunk:
                    continue
                self._buffer.extend(chunk)
            except StopAsyncIteration:
                self._eof = True
                break

        if not self._buffer:
            return b""

        to_return_len = min(len(self._buffer), target_size)
        out = bytes(self._buffer[:to_return_len])
        del self._buffer[:to_return_len]

        self.total_read += len(out)
        self._hasher.update(out)

        if self.total_read > self.max_bytes:
            self.close()
            raise ValueError(f"Upload size {self.total_read} exceeds maximum allowed limit of {self.max_bytes} bytes.")

        return out

    def close(self):
        self._closed = True
        self._buffer.clear()
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python mini-services/telethon-core/test_stream_reader.py`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mini-services/telethon-core/stream_reader.py mini-services/telethon-core/test_stream_reader.py
git commit -m "feat(telethon-core): implement AsyncStreamReader with backpressure and size boundary"
```

---

### Task 3: Telethon Client Manager & Lifecycle

**Files:**
- Create: `mini-services/telethon-core/client_manager.py`
- Create: `mini-services/telethon-core/test_client_manager.py`

**Interfaces:**
- Produces: `TelethonClientManager` class with:
  - `async start()`
  - `async stop()`
  - `async is_healthy() -> bool`
  - `async upload_stream(reader: AsyncStreamReader, filename: str, mime_type: str, caption: str) -> dict`
  - `async iter_download(message_id: int, offset: int = 0, limit: Optional[int] = None) -> AsyncGenerator[bytes, None]`
  - `async delete_message(message_id: int) -> bool`

- [ ] **Step 1: Write test for TelethonClientManager mocking MTProto client**

Create `mini-services/telethon-core/test_client_manager.py`:
```python
import unittest
from unittest.mock import AsyncMock, MagicMock, patch
from client_manager import TelethonClientManager
from config import Settings

class TestClientManager(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.settings = Settings(
            api_id=12345,
            api_hash="mock_hash",
            bot_token="123:mock_token",
            session_path="test.session",
            storage_chat_id=-100123,
            internal_key="key",
            max_concurrent_uploads=1,
            max_upload_bytes=2_000_000_000,
            port=3005
        )

    @patch("client_manager.TelegramClient")
    async def test_lifecycle_and_health(self, mock_client_cls):
        mock_client = MagicMock()
        mock_client.connect = AsyncMock()
        mock_client.is_user_authorized = AsyncMock(return_value=True)
        mock_client.get_entity = AsyncMock(return_value=MagicMock(id=100123))
        mock_client.disconnect = AsyncMock()
        mock_client_cls.return_value = mock_client

        mgr = TelethonClientManager(self.settings)
        await mgr.start()
        
        self.assertTrue(await mgr.is_healthy())
        await mgr.stop()
        mock_client.disconnect.assert_awaited_once()

if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python mini-services/telethon-core/test_client_manager.py`
Expected: FAIL (cannot import `TelethonClientManager`).

- [ ] **Step 3: Implement TelethonClientManager**

Create `mini-services/telethon-core/client_manager.py`:
```python
import asyncio
import os
from typing import AsyncGenerator, Optional
from telethon import TelegramClient
from telethon.tl.types import Message, Document
from config import Settings
from stream_reader import AsyncStreamReader

class TelethonClientManager:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.client: Optional[TelegramClient] = None
        self.chat_entity = None
        self._connected = False
        self._semaphore = asyncio.Semaphore(settings.max_concurrent_uploads)

    async def start(self):
        os.makedirs(os.path.dirname(os.path.abspath(self.settings.session_path)), exist_ok=True)
        self.client = TelegramClient(self.settings.session_path, self.settings.api_id, self.settings.api_hash)
        await self.client.connect()

        if not await self.client.is_user_authorized():
            if self.settings.bot_token:
                await self.client.start(bot_token=self.settings.bot_token)
            else:
                raise RuntimeError("Telethon session is not authorized and no bot token was provided.")

        if self.settings.storage_chat_id:
            try:
                self.chat_entity = await self.client.get_entity(self.settings.storage_chat_id)
            except Exception as e:
                raise RuntimeError(f"Could not resolve storage chat {self.settings.storage_chat_id}: {e}")

        self._connected = True

    async def stop(self):
        self._connected = False
        if self.client:
            await self.client.disconnect()

    async def is_healthy(self) -> bool:
        return self._connected and self.client is not None and self.client.is_connected()

    async def upload_stream(self, reader: AsyncStreamReader, filename: str, mime_type: str, caption: str) -> dict:
        if not await self.is_healthy():
            raise RuntimeError("Telethon client is not connected")

        async with self._semaphore:
            # Telethon upload_file handles file-like object with read(size) and total_size
            uploaded_file = await self.client.upload_file(
                file=reader,
                file_name=filename,
                file_size=reader.total_size,
            )

            target = self.chat_entity or self.settings.storage_chat_id
            msg: Message = await self.client.send_file(
                entity=target,
                file=uploaded_file,
                caption=caption or f"📦 {filename}",
                force_document=True,
            )

            doc: Optional[Document] = msg.document
            document_id = str(doc.id) if doc else ""

            return {
                "message_id": msg.id,
                "document_id": document_id,
                "size": reader.tell(),
                "checksum": reader.get_sha256(),
                "chat_id": self.settings.storage_chat_id,
            }

    async def iter_download(self, message_id: int, offset: int = 0, limit: Optional[int] = None) -> AsyncGenerator[bytes, None]:
        if not await self.is_healthy():
            raise RuntimeError("Telethon client is not connected")

        target = self.chat_entity or self.settings.storage_chat_id
        msg: Message = await self.client.get_messages(target, ids=message_id)
        if not msg or not msg.media or not msg.document:
            raise FileNotFoundError(f"Message {message_id} does not contain a document")

        doc: Document = msg.document
        total_size = doc.size

        if offset >= total_size:
            return

        bytes_to_read = min(limit, total_size - offset) if limit is not None else total_size - offset
        bytes_read = 0

        # Stream chunk size: 512 KiB
        chunk_size = 512 * 1024

        async for chunk in self.client.iter_download(
            msg.media,
            offset=offset,
            request_size=chunk_size
        ):
            if not chunk:
                break
            
            chunk_len = len(chunk)
            if bytes_read + chunk_len > bytes_to_read:
                slice_len = bytes_to_read - bytes_read
                if slice_len > 0:
                    yield chunk[:slice_len]
                    bytes_read += slice_len
                break

            yield chunk
            bytes_read += chunk_len
            if bytes_read >= bytes_to_read:
                break

    async def delete_message(self, message_id: int) -> bool:
        if not await self.is_healthy():
            return False
        target = self.chat_entity or self.settings.storage_chat_id
        await self.client.delete_messages(target, [message_id])
        return True
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python mini-services/telethon-core/test_client_manager.py`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mini-services/telethon-core/client_manager.py mini-services/telethon-core/test_client_manager.py
git commit -m "feat(telethon-core): implement persistent TelethonClientManager"
```

---

### Task 4: FastAPI Streaming Server (`main.py`)

**Files:**
- Create: `mini-services/telethon-core/main.py`
- Create: `mini-services/telethon-core/test_api.py`

**Interfaces:**
- Produces:
  - `GET /health` -> `{ "ok": bool, "connected": bool }`
  - `POST /upload` (headers: `X-Internal-Key`, `X-File-Name`, `X-File-Size`, `Content-Type`) -> JSON with message details.
  - `GET /download/{message_id}` (headers: `X-Internal-Key`, `Range`) -> `StreamingResponse`.
  - `DELETE /message/{message_id}` (headers: `X-Internal-Key`) -> `{ "ok": true }`.

- [ ] **Step 1: Write test for FastAPI endpoints**

Create `mini-services/telethon-core/test_api.py`:
```python
import unittest
from unittest.mock import AsyncMock, MagicMock
from fastapi.testclient import TestClient
from main import app, get_client_mgr, get_settings
from config import Settings

class TestAPI(unittest.TestCase):
    def setUp(self):
        self.mock_settings = Settings(
            api_id=123,
            api_hash="hash",
            bot_token="token",
            session_path="path",
            storage_chat_id=-100,
            internal_key="secret-key",
            max_concurrent_uploads=1,
            max_upload_bytes=2_000_000_000,
            port=3005
        )
        self.mock_mgr = MagicMock()
        self.mock_mgr.is_healthy = AsyncMock(return_value=True)
        self.mock_mgr.delete_message = AsyncMock(return_value=True)

        app.dependency_overrides[get_settings] = lambda: self.mock_settings
        app.dependency_overrides[get_client_mgr] = lambda: self.mock_mgr
        self.client = TestClient(app)

    def test_health(self):
        res = self.client.get("/health")
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.json()["connected"])

    def test_unauthorized(self):
        res = self.client.delete("/message/123")
        self.assertEqual(res.status_code, 401)

    def test_authorized_delete(self):
        res = self.client.delete("/message/123", headers={"X-Internal-Key": "secret-key"})
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.json()["ok"])

if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python mini-services/telethon-core/test_api.py`
Expected: FAIL (cannot import `main`).

- [ ] **Step 3: Implement main.py**

Create `mini-services/telethon-core/main.py`:
```python
import re
from contextlib import asynccontextmanager
from typing import Optional
from fastapi import FastAPI, Header, HTTPException, Request, Response, status
from fastapi.responses import JSONResponse, StreamingResponse
from config import Settings, get_settings
from client_manager import TelethonClientManager
from stream_reader import AsyncStreamReader

_settings = get_settings()
_client_mgr = TelethonClientManager(_settings)

def get_settings_dep() -> Settings:
    return _settings

def get_client_mgr() -> TelethonClientManager:
    return _client_mgr

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: attempt connection if credentials are configured
    if _settings.api_id and _settings.api_hash:
        try:
            await _client_mgr.start()
        except Exception as e:
            print(f"[telethon-core] Warning: could not connect on startup: {e}")
    yield
    # Shutdown
    await _client_mgr.stop()

app = FastAPI(title="ValencyStudio Telethon Core", lifespan=lifespan)

def verify_internal_key(x_internal_key: Optional[str] = Header(None), settings: Settings = None):
    expected = settings.internal_key if settings else _settings.internal_key
    if not x_internal_key or x_internal_key != expected:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid internal key")

@app.get("/health")
async def health(mgr: TelethonClientManager = None):
    manager = mgr or _client_mgr
    connected = await manager.is_healthy()
    return {"ok": True, "connected": connected}

@app.post("/upload")
async def upload(
    request: Request,
    x_file_name: str = Header(..., description="URI-encoded filename"),
    x_file_size: int = Header(..., description="Expected size in bytes"),
    x_internal_key: str = Header(...),
):
    verify_internal_key(x_internal_key)

    if x_file_size <= 0 or x_file_size > _settings.max_upload_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"File size {x_file_size} exceeds maximum { _settings.max_upload_bytes } bytes",
        )

    # decode filename
    import urllib.parse
    filename = urllib.parse.unquote(x_file_name)
    mime_type = request.headers.get("content-type", "application/octet-stream")

    reader = AsyncStreamReader(
        stream_gen=request.stream(),
        total_size=x_file_size,
        max_bytes=_settings.max_upload_bytes,
        name=filename,
    )

    try:
        result = await _client_mgr.upload_stream(
            reader=reader,
            filename=filename,
            mime_type=mime_type,
            caption=f"📦 {filename}"
        )
        return JSONResponse(result)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"Upload failed: {e}")
    finally:
        reader.close()

@app.get("/download/{message_id}")
async def download(
    message_id: int,
    request: Request,
    x_internal_key: str = Header(...),
):
    verify_internal_key(x_internal_key)

    range_header = request.headers.get("range")
    offset = 0
    limit = None

    if range_header:
        m = re.match(r"bytes=(\d+)-(\d*)", range_header)
        if m:
            offset = int(m.group(1))
            if m.group(2):
                end = int(m.group(2))
                limit = end - offset + 1

    try:
        generator = _client_mgr.iter_download(message_id=message_id, offset=offset, limit=limit)
        return StreamingResponse(generator, media_type="application/octet-stream")
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Message or document not found")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/message/{message_id}")
async def delete_message(
    message_id: int,
    x_internal_key: str = Header(...),
):
    verify_internal_key(x_internal_key)
    success = await _client_mgr.delete_message(message_id)
    return {"ok": success}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="127.0.0.1", port=_settings.port, log_level="info")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python mini-services/telethon-core/test_api.py`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add mini-services/telethon-core/main.py mini-services/telethon-core/test_api.py
git commit -m "feat(telethon-core): implement FastAPI HTTP streaming endpoints"
```

---

### Task 5: Next.js Telethon Client Helper & Settings

**Files:**
- Modify: `src/lib/settings.ts`
- Create: `src/lib/telethon.ts`
- Create: `src/lib/telethon.test.ts` (or node assert test)

**Interfaces:**
- Produces in `src/lib/telethon.ts`:
  - `uploadToTelethon(stream: ReadableStream<Uint8Array>, filename: string, size: number, mimeType: string): Promise<{ messageId: number; checksum: string; size: number }>`
  - `streamFromTelethon(messageId: number, range?: string): Promise<Response>`
  - `deleteFromTelethon(messageId: number): Promise<boolean>`
  - `isTelethonHealthy(): Promise<boolean>`

- [ ] **Step 1: Write test for telethon helper functions**

Create `src/lib/telethon.test.ts`:
```typescript
import assert from 'node:assert/strict'
import { isTelethonHealthy } from './telethon'

async function run() {
  // When service is not running, isTelethonHealthy should return false without crashing
  const healthy = await isTelethonHealthy()
  assert.equal(typeof healthy, 'boolean')
  console.log('telethon.test.ts: PASS')
}

run().catch(e => {
  console.error(e)
  process.exit(1)
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bun run src/lib/telethon.test.ts`
Expected: FAIL (module `./telethon` not found).

- [ ] **Step 3: Update settings.ts and implement telethon.ts**

Update `src/lib/settings.ts` to include Telethon configuration defaults:
Add `telethonCoreUrl: process.env.TELETHON_CORE_URL || 'http://127.0.0.1:3005'`, `telethonInternalKey: process.env.TELETHON_INTERNAL_KEY || 'vs-telethon-internal-key'`, and ensure `maxFileSize` defaults to `2000000000`.

Create `src/lib/telethon.ts`:
```typescript
import { getSettings } from '@/lib/settings'

export async function isTelethonHealthy(): Promise<boolean> {
  try {
    const settings = await getSettings()
    const url = `${settings.telethonCoreUrl || 'http://127.0.0.1:3005'}/health`
    const res = await fetch(url, { signal: AbortSignal.timeout(2000) })
    if (!res.ok) return false
    const body = (await res.json()) as { ok: boolean; connected: boolean }
    return !!body.connected
  } catch {
    return false
  }
}

export async function uploadToTelethon(
  stream: ReadableStream<Uint8Array>,
  filename: string,
  size: number,
  mimeType: string
): Promise<{ messageId: number; checksum: string; size: number }> {
  const settings = await getSettings()
  const url = `${settings.telethonCoreUrl || 'http://127.0.0.1:3005'}/upload`
  const key = settings.telethonInternalKey || 'vs-telethon-internal-key'

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'X-Internal-Key': key,
      'X-File-Name': encodeURIComponent(filename),
      'X-File-Size': String(size),
      'Content-Type': mimeType || 'application/octet-stream',
    },
    // @ts-expect-error - Bun/Node duplex streaming option
    duplex: 'half',
    body: stream,
  })

  if (!res.ok) {
    const err = await res.text().catch(() => '')
    throw new Error(`Telethon upload failed (${res.status}): ${err}`)
  }

  const data = (await res.json()) as { message_id: number; checksum: string; size: number }
  return {
    messageId: data.message_id,
    checksum: data.checksum,
    size: data.size,
  }
}

export async function streamFromTelethon(messageId: number, range?: string | null): Promise<Response> {
  const settings = await getSettings()
  const url = `${settings.telethonCoreUrl || 'http://127.0.0.1:3005'}/download/${messageId}`
  const key = settings.telethonInternalKey || 'vs-telethon-internal-key'

  const headers: Record<string, string> = {
    'X-Internal-Key': key,
  }
  if (range) {
    headers['Range'] = range
  }

  return fetch(url, { headers })
}

export async function deleteFromTelethon(messageId: number): Promise<boolean> {
  try {
    const settings = await getSettings()
    const url = `${settings.telethonCoreUrl || 'http://127.0.0.1:3005'}/message/${messageId}`
    const key = settings.telethonInternalKey || 'vs-telethon-internal-key'

    const res = await fetch(url, {
      method: 'DELETE',
      headers: { 'X-Internal-Key': key },
      signal: AbortSignal.timeout(5000),
    })
    return res.ok
  } catch {
    return false
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bun run src/lib/telethon.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/settings.ts src/lib/telethon.ts src/lib/telethon.test.ts
git commit -m "feat: add Next.js Telethon client adapter and settings"
```

---

### Task 6: Next.js Streaming Upload Route (`/api/files/upload-stream`)

**Files:**
- Create: `src/app/api/files/upload-stream/route.ts`
- Modify: `src/lib/uploader.ts`

**Interfaces:**
- Consumes: `uploadToTelethon` from `@/lib/telethon`, `getSessionUser` from `@/lib/auth`, `db` from `@/lib/db`.
- Produces: POST `/api/files/upload-stream` streaming endpoint.

- [ ] **Step 1: Create streaming upload route**

Create `src/app/api/files/upload-stream/route.ts`:
```typescript
import { db } from '@/lib/db'
import { getSessionUser, logActivity, getClientIp } from '@/lib/auth'
import { jsonError } from '@/lib/api-helpers'
import { getUsedBytes } from '@/lib/files'
import { ownedFolder } from '@/lib/folders'
import { emitChanged, ROOM } from '@/lib/realtime-emit'
import { uploadToTelethon } from '@/lib/telethon'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MAX_BYTES = 2_000_000_000

export async function POST(req: Request) {
  const user = await getSessionUser(req)
  if (!user) return jsonError('Unauthorized', 401)

  const rawName = req.headers.get('x-file-name')
  const rawSize = req.headers.get('x-file-size')
  const folderIdHeader = req.headers.get('x-folder-id')
  const mimeType = req.headers.get('content-type') || 'application/octet-stream'

  if (!rawName || !rawSize) {
    return jsonError('Missing x-file-name or x-file-size header.', 400)
  }

  const name = decodeURIComponent(rawName).trim().slice(0, 255)
  const size = parseInt(rawSize)

  if (isNaN(size) || size <= 0 || size > MAX_BYTES) {
    return jsonError(`File size must be between 1 and ${MAX_BYTES} bytes.`, 413)
  }

  let folderId: string | null = null
  if (folderIdHeader) {
    const f = await ownedFolder(folderIdHeader, user.id)
    if (!f) return jsonError('Target folder not found.', 404)
    folderId = f.id
  }

  if (user.quota !== -1) {
    const used = await getUsedBytes(user.id)
    if (used + size > user.quota) {
      return jsonError('Storage quota exceeded. Delete files or contact an admin.', 413)
    }
  }

  if (!req.body) {
    return jsonError('Missing request body stream.', 400)
  }

  // Create PENDING file record
  const file = await db.file.create({
    data: {
      ownerId: user.id,
      name,
      size,
      mimeType,
      status: 'PENDING',
      folderId,
    },
  })

  emitChanged(['files'], { rooms: [ROOM.user(user.id)] })

  try {
    const { messageId, checksum, size: uploadedBytes } = await uploadToTelethon(
      req.body,
      name,
      size,
      mimeType
    )

    const parts = JSON.stringify([{ ref: `telethon:${messageId}`, size: uploadedBytes }])

    const updated = await db.file.update({
      where: { id: file.id },
      data: {
        status: 'READY',
        size: uploadedBytes,
        parts,
      },
    })

    await logActivity(user.id, 'FILE_UPLOAD', `Uploaded "${name}" (${uploadedBytes} bytes via Telethon MTProto, SHA256: ${checksum})`, getClientIp(req))
    emitChanged(['files', 'activity'], { rooms: [ROOM.user(user.id), ROOM.admins] })

    return Response.json({ ok: true, file: { id: updated.id, name: updated.name, size: updated.size, status: updated.status } })
  } catch (err: any) {
    await db.file.update({
      where: { id: file.id },
      data: { status: 'FAILED' },
    }).catch(() => {})
    return jsonError(err.message || 'Streaming upload failed', 500)
  }
}
```

- [ ] **Step 2: Update frontend uploader (`src/lib/uploader.ts`)**

In `src/lib/uploader.ts`, adapt the upload loop to use direct streaming to `/api/files/upload-stream` via Fetch request with progress tracking where supported, falling back gracefully.

- [ ] **Step 3: Test syntax and type validity**

Run: `bun run lint`
Expected: PASS (or no new lint errors in `upload-stream` and `uploader`).

- [ ] **Step 4: Commit**

```bash
git add src/app/api/files/upload-stream/route.ts src/lib/uploader.ts
git commit -m "feat: add Next.js upload-stream route and update frontend uploader"
```

---

### Task 7: Streaming Download & Range Preview Integration

**Files:**
- Modify: `src/lib/download.ts`
- Modify: `src/app/api/files/[id]/download/route.ts`
- Modify: `src/lib/files.ts` (for permanent delete reference checking)

**Interfaces:**
- Consumes: `streamFromTelethon`, `deleteFromTelethon` from `@/lib/telethon`.
- Updates: `buildFileResponse` and `deleteFileCompletely` to support `telethon:` refs transparently.

- [ ] **Step 1: Update `src/lib/download.ts` to route `telethon:` refs**

Modify `src/lib/download.ts` to detect if `parts[0].ref.startsWith('telethon:')`.
If so, delegate directly to `streamFromTelethon(messageId, rangeHeader)` and forward the stream back with proper `Content-Disposition`, `Content-Type`, and `Accept-Ranges: bytes`.
If not, retain existing multi-part generator for legacy `tg:` / `local:` files.

- [ ] **Step 2: Update `deleteFileCompletely` in `src/lib/files.ts`**

In `src/lib/files.ts`:
```typescript
if (p.ref.startsWith('telethon:')) {
  const parts = p.ref.split(':')
  const messageId = parseInt(parts[1])
  if (!isNaN(messageId)) {
    await deleteFromTelethon(messageId)
  }
}
```

- [ ] **Step 3: Test download and delete routing logic**

Run: `bun run lint`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/lib/download.ts src/app/api/files/[id]/download/route.ts src/lib/files.ts
git commit -m "feat: integrate Telethon streaming downloads with Range preview and cleanup"
```

---

### Task 8: Dockerfile & Container Entrypoint

**Files:**
- Modify: `Dockerfile`
- Modify: `docker/entrypoint.sh`

**Interfaces:**
- Container runs:
  1. SQLite schema push (`prisma db push`)
  2. Telethon Core service on `:3005` with healthcheck
  3. Realtime service on `:3003`
  4. Next.js server on `:3000`

- [ ] **Step 1: Update Dockerfile to include Python 3 and Telethon Core venv**

In `Dockerfile`:
- Add `python3` and `python3-pip` in dependencies.
- Build virtualenv at `/app/mini-services/telethon-core/.venv` using `requirements.txt`.
- Copy `mini-services/telethon-core` to the final runner image.

- [ ] **Step 2: Update `docker/entrypoint.sh` to launch Telethon Core**

In `docker/entrypoint.sh`:
```sh
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
```

- [ ] **Step 3: Commit**

```bash
git add Dockerfile docker/entrypoint.sh
git commit -m "build(docker): integrate Python runtime and Telethon Core in entrypoint"
```

---

### Task 9: Comprehensive Test Suite & Storage Verification

**Files:**
- Create: `tests/streaming-storage.test.ts`
- Create: `tests/telethon-e2e.test.py`

**Interfaces:**
- Verifies:
  1. Low-storage invariant: Disk usage does not increase proportional to file size during stream.
  2. 2,000,000,000 byte boundary: 2,000,000,000 bytes succeeds, 2,000,000,001 bytes fails with HTTP 413.
  3. SHA-256 checksum matches bit-for-bit.
  4. Disconnect cleanup: aborting mid-stream releases resources.
  5. Legacy parts: downloading `tg:` / `local:` parts works as expected.

- [ ] **Step 1: Implement `tests/streaming-storage.test.ts`**

Create test script with assertions covering the above invariants.

- [ ] **Step 2: Run test suite**

Run: `bun run tests/streaming-storage.test.ts`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/streaming-storage.test.ts tests/telethon-e2e.test.py
git commit -m "test: add comprehensive streaming storage and boundary verification suite"
```
