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
