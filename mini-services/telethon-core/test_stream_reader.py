import hashlib
import unittest

class TestAsyncStreamReader(unittest.IsolatedAsyncioTestCase):
    async def test_rejects_stream_shorter_than_declared_size(self):
        from stream_reader import AsyncStreamReader

        async def chunks():
            yield b"short"

        reader = AsyncStreamReader(chunks(), total_size=10, max_bytes=100)
        with self.assertRaisesRegex(ValueError, "expected 10 bytes, received 5"):
            while await reader.read(4):
                pass

    async def test_rejects_stream_larger_than_declared_size(self):
        from stream_reader import AsyncStreamReader

        async def chunks():
            yield b"123456"

        reader = AsyncStreamReader(chunks(), total_size=5, max_bytes=100)
        with self.assertRaisesRegex(ValueError, "exceeds declared size of 5 bytes"):
            while await reader.read(4):
                pass

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

    async def test_large_input_chunk_is_read_in_bounded_slices(self):
        from stream_reader import AsyncStreamReader

        payload = b"x" * (2 * 1024 * 1024)

        async def chunks():
            yield payload

        reader = AsyncStreamReader(chunks(), total_size=len(payload), max_bytes=len(payload))
        first = await reader.read(512 * 1024)
        self.assertEqual(len(first), 512 * 1024)
        self.assertIs(reader._buffer.obj, payload)

        remainder = bytearray(first)
        while True:
            chunk = await reader.read(512 * 1024)
            if not chunk:
                break
            remainder.extend(chunk)
        self.assertEqual(bytes(remainder), payload)

    async def test_exceeding_max_bytes_raises_error(self):
        from stream_reader import AsyncStreamReader
        async def endless_generator():
            chunk = b"x" * 1024
            while True:
                yield chunk

        # Set limit to 2048 bytes
        with self.assertRaisesRegex(ValueError, "Declared upload size 5000 exceeds maximum allowed limit of 2048 bytes"):
            AsyncStreamReader(endless_generator(), total_size=5000, max_bytes=2048)

if __name__ == "__main__":
    unittest.main()
