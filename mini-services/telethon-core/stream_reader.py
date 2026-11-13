import hashlib
from typing import AsyncGenerator, Optional

class AsyncStreamReader:
    """
    Adapter that wraps an async byte generator into a file-like reader
    compatible with Telethon's upload_file, enforcing backpressure,
    bounded RAM, incremental SHA-256 calculation, and strict size limits.
    """
    def __init__(self, stream_gen: AsyncGenerator[bytes, None], total_size: int, max_bytes: int = 2_147_483_648, name: str = "stream"):
        if total_size < 0:
            raise ValueError("Declared upload size must not be negative")
        if total_size > max_bytes:
            raise ValueError(f"Declared upload size {total_size} exceeds maximum allowed limit of {max_bytes} bytes.")
        self.stream_gen = stream_gen
        self.total_size = total_size
        self.max_bytes = max_bytes
        self.name = name
        self.total_read = 0
        self._buffer = memoryview(b"")
        self._buffer_offset = 0
        self._hasher = hashlib.sha256()
        self._closed = False
        self._eof = False

    def tell(self) -> int:
        return self.total_read

    def get_sha256(self) -> str:
        return self._hasher.hexdigest()

    def _validate_eof(self):
        if self.total_read != self.total_size:
            raise ValueError(f"Upload size mismatch: expected {self.total_size} bytes, received {self.total_read}.")

    async def read(self, size: int = -1) -> bytes:
        if self._closed:
            return b""

        target_size = min(size if size > 0 else 512 * 1024, self.total_size - self.total_read)
        if target_size <= 0:
            await self.finish()
            return b""

        output = bytearray()
        while len(output) < target_size:
            buffered = len(self._buffer) - self._buffer_offset
            if buffered:
                take = min(target_size - len(output), buffered)
                output.extend(self._buffer[self._buffer_offset:self._buffer_offset + take])
                self._buffer_offset += take
                if self._buffer_offset == len(self._buffer):
                    self._buffer = memoryview(b"")
                    self._buffer_offset = 0
                continue

            if self._eof:
                break

            try:
                chunk = await self.stream_gen.__anext__()
            except StopAsyncIteration:
                self._eof = True
                break
            if not chunk:
                continue

            if self.total_read + len(output) + len(chunk) > self.total_size:
                raise ValueError(f"Upload stream exceeds declared size of {self.total_size} bytes.")
            self._buffer = memoryview(chunk)
            self._buffer_offset = 0

        if not output:
            await self.finish()
            return b""

        out = bytes(output)
        self.total_read += len(out)
        self._hasher.update(out)

        if self.total_read > self.max_bytes:
            self.close()
            raise ValueError(f"Upload size {self.total_read} exceeds maximum allowed limit of {self.max_bytes} bytes.")
        return out

    async def finish(self):
        """Verify the declared number of bytes was consumed and the source ended."""
        if self.total_read != self.total_size:
            raise ValueError(f"Upload size mismatch: expected {self.total_size} bytes, received {self.total_read}.")
        if not self._eof:
            try:
                extra = await self.stream_gen.__anext__()
            except StopAsyncIteration:
                self._eof = True
            else:
                if extra:
                    raise ValueError(f"Upload stream exceeds declared size of {self.total_size} bytes.")
                while True:
                    try:
                        extra = await self.stream_gen.__anext__()
                    except StopAsyncIteration:
                        self._eof = True
                        break
                    if extra:
                        raise ValueError(f"Upload stream exceeds declared size of {self.total_size} bytes.")
        self._validate_eof()

    def close(self):
        self._closed = True
        self._buffer = memoryview(b"")
        self._buffer_offset = 0
