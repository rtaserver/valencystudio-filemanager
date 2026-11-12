import hashlib
from typing import AsyncGenerator, Optional

class AsyncStreamReader:
    """
    Adapter that wraps an async byte generator into a file-like reader
    compatible with Telethon's upload_file, enforcing backpressure,
    bounded RAM, incremental SHA-256 calculation, and strict size limits.
    """
    def __init__(self, stream_gen: AsyncGenerator[bytes, None], total_size: int, max_bytes: int = 2_147_483_648, name: str = "stream"):
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
