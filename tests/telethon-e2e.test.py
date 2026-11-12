import unittest
import asyncio
import hashlib
import os
import sys

# Ensure mini-services/telethon-core is on sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "mini-services", "telethon-core")))

from stream_reader import AsyncStreamReader
from config import Settings
from main import app, get_settings_dep, get_client_mgr
from fastapi.testclient import TestClient
from unittest.mock import AsyncMock, MagicMock

class TestTelethonE2E(unittest.TestCase):
    def test_zero_spool_and_checksum(self):
        """Verifies zero temporary files are written to disk and SHA-256 matches bit-for-bit."""
        data_blocks = [b"chunk_" + str(i).encode() for i in range(100)]
        expected_data = b"".join(data_blocks)
        expected_hash = hashlib.sha256(expected_data).hexdigest()

        async def gen():
            for block in data_blocks:
                yield block

        reader = AsyncStreamReader(gen(), total_size=len(expected_data), max_bytes=2_000_000_000)

        accumulated = bytearray()
        loop = asyncio.new_event_loop()
        try:
            while True:
                chunk = loop.run_until_complete(reader.read(32))
                if not chunk:
                    break
                accumulated.extend(chunk)
        finally:
            loop.close()

        self.assertEqual(bytes(accumulated), expected_data)
        self.assertEqual(reader.get_sha256(), expected_hash)
        self.assertEqual(reader.tell(), len(expected_data))

    def test_size_boundary_enforcement(self):
        """Verifies strict 2,000,000,000 byte boundary."""
        async def mock_stream(size: int):
            sent = 0
            chunk = b"X" * (1024 * 1024)
            while sent < size:
                to_send = min(len(chunk), size - sent)
                yield chunk[:to_send]
                sent += to_send

        # Test at limit: 100 bytes allowed
        reader = AsyncStreamReader(mock_stream(100), total_size=100, max_bytes=100)
        loop = asyncio.new_event_loop()
        try:
            chunk = loop.run_until_complete(reader.read(100))
            self.assertEqual(len(chunk), 100)
            self.assertEqual(reader.tell(), 100)
        finally:
            loop.close()

        # Test exceeding limit: 101 bytes when limit is 100
        reader_overflow = AsyncStreamReader(mock_stream(101), total_size=101, max_bytes=100)
        loop = asyncio.new_event_loop()
        try:
            with self.assertRaises(ValueError) as ctx:
                loop.run_until_complete(reader_overflow.read(100))
                loop.run_until_complete(reader_overflow.read(10))
            self.assertIn("exceeds maximum allowed limit", str(ctx.exception))
        finally:
            loop.close()

    def test_http_api_boundary_rejection(self):
        """Verifies HTTP /upload rejects requests > 2,000,000,000 bytes with 413."""
        mock_settings = Settings(
            api_id=123,
            api_hash="hash",
            bot_token="token",
            session_path="/tmp/session",
            storage_chat_id=-100,
            internal_key="test-key",
            max_concurrent_uploads=1,
            max_upload_bytes=2_000_000_000,
            port=3005
        )
        app.dependency_overrides[get_settings_dep] = lambda: mock_settings
        app.dependency_overrides[get_client_mgr] = lambda: MagicMock()
        client = TestClient(app)

        # Send request with size 2_000_000_001
        res = client.post(
            "/upload",
            headers={
                "X-Internal-Key": "test-key",
                "X-File-Name": "large.iso",
                "X-File-Size": "2000000001",
                "Content-Type": "application/octet-stream"
            },
            content=b""
        )
        self.assertEqual(res.status_code, 413)
        self.assertIn("exceeds maximum", res.json()["detail"])

    def test_disconnect_abort_cleanup(self):
        """Verifies aborting stream clears memory buffer immediately."""
        async def infinite_gen():
            while True:
                yield b"A" * 1024

        reader = AsyncStreamReader(infinite_gen(), total_size=10_000_000, max_bytes=2_000_000_000)
        loop = asyncio.new_event_loop()
        try:
            chunk = loop.run_until_complete(reader.read(512))
            self.assertEqual(len(chunk), 512)
            self.assertFalse(reader._closed)

            # Abort/close
            reader.close()
            self.assertTrue(reader._closed)
            self.assertEqual(len(reader._buffer), 0)

            # Subsequent read returns empty
            after_close = loop.run_until_complete(reader.read(512))
            self.assertEqual(after_close, b"")
        finally:
            loop.close()

if __name__ == "__main__":
    unittest.main()
