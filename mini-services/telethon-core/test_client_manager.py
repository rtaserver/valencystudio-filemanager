import unittest
from unittest.mock import AsyncMock, MagicMock, patch
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
        from client_manager import TelethonClientManager
        mock_client = MagicMock()
        mock_client.connect = AsyncMock()
        mock_client.is_connected = MagicMock(return_value=True)
        mock_client.is_user_authorized = AsyncMock(return_value=True)
        mock_client.get_entity = AsyncMock(return_value=MagicMock(id=100123))
        mock_client.disconnect = AsyncMock()
        mock_client_cls.return_value = mock_client

        mgr = TelethonClientManager(self.settings)
        await mgr.start()

        self.assertTrue(await mgr.is_healthy())
        await mgr.stop()
        mock_client.disconnect.assert_awaited_once()

    @patch("client_manager.TelegramClient")
    async def test_upload_stream_delegation(self, mock_client_cls):
        from client_manager import TelethonClientManager
        mock_client = MagicMock()
        mock_client.connect = AsyncMock()
        mock_client.is_connected = MagicMock(return_value=True)
        mock_client.is_user_authorized = AsyncMock(return_value=True)
        mock_client.get_entity = AsyncMock(return_value=MagicMock(id=100123))
        mock_client.upload_file = AsyncMock(return_value="mock_uploaded_file")

        mock_msg = MagicMock()
        mock_msg.id = 999
        mock_msg.document = MagicMock(id=88888)
        mock_client.send_file = AsyncMock(return_value=mock_msg)
        mock_client_cls.return_value = mock_client

        mgr = TelethonClientManager(self.settings)
        await mgr.start()

        mock_reader = MagicMock()
        mock_reader.total_size = 1024
        mock_reader.tell = MagicMock(return_value=1024)
        mock_reader.get_sha256 = MagicMock(return_value="fake_sha256")

        result = await mgr.upload_stream(mock_reader, "test.txt", "text/plain", "caption")
        self.assertEqual(result["message_id"], 999)
        self.assertEqual(result["document_id"], "88888")
        self.assertEqual(result["size"], 1024)
        self.assertEqual(result["checksum"], "fake_sha256")

if __name__ == "__main__":
    unittest.main()
