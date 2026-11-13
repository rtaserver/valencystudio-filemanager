import unittest
from unittest.mock import AsyncMock, MagicMock
from fastapi.testclient import TestClient
from config import Settings

class TestAPI(unittest.TestCase):
    def setUp(self):
        from main import app, get_client_mgr, get_settings_dep
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

        app.dependency_overrides[get_settings_dep] = lambda: self.mock_settings
        app.dependency_overrides[get_client_mgr] = lambda: self.mock_mgr
        self.client = TestClient(app)

    def test_authorized_upload_big_part(self):
        self.mock_mgr.MAX_UPLOAD_PARTS = 4000
        self.mock_mgr.UPLOAD_PART_SIZE = 512 * 1024
        self.mock_mgr.upload_big_file_part = AsyncMock(return_value=True)
        part = b"x" * (512 * 1024)
        res = self.client.post(
            "/upload/big/123/0",
            content=part,
            headers={"X-Internal-Key": "secret-key", "X-Total-Parts": "1", "Content-Length": str(len(part))},
        )
        self.assertEqual(res.status_code, 200, res.text)
        self.mock_mgr.upload_big_file_part.assert_awaited_once_with(123, 0, 1, part)

    def test_upload_big_part_requires_internal_key(self):
        part = b"x" * (512 * 1024)
        res = self.client.post("/upload/big/123/0", content=part, headers={"X-Total-Parts": "1"})
        self.assertEqual(res.status_code, 401)

    def test_upload_big_part_rejects_short_nonfinal_chunk(self):
        self.mock_mgr.MAX_UPLOAD_PARTS = 4000
        self.mock_mgr.UPLOAD_PART_SIZE = 512 * 1024
        res = self.client.post(
            "/upload/big/123/0",
            content=b"short",
            headers={"X-Internal-Key": "secret-key", "X-Total-Parts": "2"},
        )
        self.assertEqual(res.status_code, 400)

    def test_authorized_finalize_big_upload(self):
        self.mock_mgr.finalize_big_file = AsyncMock(return_value={"message_id": 77, "document_id": "abc"})
        res = self.client.post(
            "/upload/big/finalize",
            json={"telegram_file_id": 123, "total_parts": 1, "filename": "one.bin", "caption": "upload:test"},
            headers={"X-Internal-Key": "secret-key"},
        )
        self.assertEqual(res.status_code, 200, res.text)
        self.mock_mgr.finalize_big_file.assert_awaited_once_with(123, 1, "one.bin", "application/octet-stream", "upload:test")

    def test_health(self):
        res = self.client.get("/health")
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
