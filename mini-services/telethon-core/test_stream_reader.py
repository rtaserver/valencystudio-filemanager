import asyncio
import hashlib
import unittest

class TestAsyncStreamReader(unittest.IsolatedAsyncioTestCase):
    async def test_chunked_reading_and_hash(self):
        from stream_reader import AsyncStreamReader
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
        from stream_reader import AsyncStreamReader
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
