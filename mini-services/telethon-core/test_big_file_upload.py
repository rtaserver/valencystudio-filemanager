from unittest.mock import AsyncMock, MagicMock, patch
import unittest
from config import Settings

class TestBigFileUpload(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.settings = Settings(123, "hash", "token", "path", -100, "key", 1, 2_000_000_000, 3005)

    async def test_upload_part_uses_stable_big_file_id_and_index(self):
        from client_manager import TelethonClientManager
        mgr = TelethonClientManager(self.settings)
        mock_client = MagicMock()
        mock_client.is_connected.return_value = True
        mock_client.side_effect = AsyncMock(return_value=True)
        mgr.client = mock_client
        mgr._connected = True
        payload = b"x" * mgr.UPLOAD_PART_SIZE
        self.assertTrue(await mgr.upload_big_file_part(987654, 2, 3, payload))
        request = mock_client.call_args.args[0]
        self.assertEqual((request.file_id, request.file_part, request.file_total_parts), (987654, 2, 3))
        self.assertEqual(request.bytes, payload)

    async def test_nonfinal_short_chunk_is_rejected_without_telegram_call(self):
        from client_manager import TelethonClientManager
        mgr = TelethonClientManager(self.settings)
        mock_client = MagicMock()
        mock_client.is_connected.return_value = True
        mgr.client = mock_client
        mgr._connected = True
        with self.assertRaisesRegex(ValueError, "invalid size"):
            await mgr.upload_big_file_part(123, 0, 2, b"short")
        mock_client.assert_not_called()

    async def test_finalize_sends_big_file_as_one_document(self):
        from client_manager import TelethonClientManager
        mock_client = MagicMock()
        mock_client.is_connected.return_value = True
        mock_client.get_entity = AsyncMock(return_value="storage-chat")
        async def empty_messages(*args, **kwargs):
            if False:
                yield None
        mock_client.iter_messages = empty_messages
        mock_msg = MagicMock(id=4321, document=MagicMock(id=111))
        mock_client.send_file = AsyncMock(return_value=mock_msg)
        mgr = TelethonClientManager(self.settings)
        mgr.client = mock_client
        mgr._connected = True
        result = await mgr.finalize_big_file(987654, 3, "test.bin", "application/octet-stream", "upload:abc")
        self.assertEqual(result["message_id"], 4321)
        sent = mock_client.send_file.await_args.kwargs
        self.assertEqual((sent["file"].id, sent["file"].parts), (987654, 3))
        self.assertEqual(sent["caption"], "upload:abc")

if __name__ == "__main__":
    unittest.main()
