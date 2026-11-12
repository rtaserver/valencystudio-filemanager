import re
import urllib.parse
from contextlib import asynccontextmanager
from typing import Optional
from fastapi import FastAPI, Header, HTTPException, Request, Response, status, Depends
from fastapi.responses import JSONResponse, StreamingResponse
from config import Settings, get_settings
from client_manager import TelethonClientManager
from stream_reader import AsyncStreamReader

_client_mgr = TelethonClientManager(get_settings())

def get_settings_dep() -> Settings:
    return _client_mgr.settings

def get_client_mgr() -> TelethonClientManager:
    return _client_mgr

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: attempt connection if credentials are configured
    s = _client_mgr.settings
    if s.api_id and s.api_hash:
        try:
            await _client_mgr.start()
        except Exception as e:
            print(f"[telethon-core] Warning: could not connect on startup: {e}")
    yield
    # Shutdown
    await _client_mgr.stop()

app = FastAPI(title="ValencyStudio Telethon Core", lifespan=lifespan)

def verify_internal_key(
    x_internal_key: Optional[str] = Header(None),
    settings: Settings = Depends(get_settings_dep)
):
    expected = settings.internal_key
    if not x_internal_key or x_internal_key != expected:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid internal key")

@app.get("/health")
async def health(mgr: TelethonClientManager = Depends(get_client_mgr)):
    connected = await mgr.is_healthy()
    return {"ok": True, "connected": connected}

@app.post("/upload")
async def upload(
    request: Request,
    x_file_name: str = Header(..., description="URI-encoded filename"),
    x_file_size: int = Header(..., description="Expected size in bytes"),
    settings: Settings = Depends(get_settings_dep),
    mgr: TelethonClientManager = Depends(get_client_mgr),
    _: None = Depends(verify_internal_key),
):
    if x_file_size <= 0 or x_file_size > settings.max_upload_bytes:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"File size {x_file_size} exceeds maximum {settings.max_upload_bytes} bytes",
        )

    filename = urllib.parse.unquote(x_file_name)
    mime_type = request.headers.get("content-type", "application/octet-stream")

    reader = AsyncStreamReader(
        stream_gen=request.stream(),
        total_size=x_file_size,
        max_bytes=settings.max_upload_bytes,
        name=filename,
    )

    try:
        result = await mgr.upload_stream(
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
    mgr: TelethonClientManager = Depends(get_client_mgr),
    _: None = Depends(verify_internal_key),
):
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
        generator = mgr.iter_download(message_id=message_id, offset=offset, limit=limit)
        return StreamingResponse(generator, media_type="application/octet-stream")
    except FileNotFoundError:
        raise HTTPException(status_code=404, detail="Message or document not found")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.delete("/message/{message_id}")
async def delete_message(
    message_id: int,
    mgr: TelethonClientManager = Depends(get_client_mgr),
    _: None = Depends(verify_internal_key),
):
    success = await mgr.delete_message(message_id)
    return {"ok": success}

if __name__ == "__main__":
    import uvicorn
    s = _client_mgr.settings
    uvicorn.run("main:app", host="127.0.0.1", port=s.port, log_level="info")
