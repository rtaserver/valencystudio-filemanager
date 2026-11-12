import os
import unittest
from unittest.mock import patch

class TestConfig(unittest.TestCase):
    @patch.dict(os.environ, {
        "TELETHON_API_ID": "12345",
        "TELETHON_API_HASH": "abcdef1234567890abcdef1234567890",
        "TELETHON_BOT_TOKEN": "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11",
        "TELETHON_STORAGE_CHAT_ID": "-100123456789",
        "TELETHON_INTERNAL_KEY": "test-key-123",
        "MAX_UPLOAD_BYTES": "2000000000",
        "PORT": "3000",  # Next.js app port must not conflict with Telethon Core
    })
    def test_valid_config(self):
        from config import get_settings
        cfg = get_settings()
        self.assertEqual(cfg.api_id, 12345)
        self.assertEqual(cfg.api_hash, "abcdef1234567890abcdef1234567890")
        self.assertEqual(cfg.bot_token, "123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11")
        self.assertEqual(cfg.storage_chat_id, -100123456789)
        self.assertEqual(cfg.internal_key, "test-key-123")
        self.assertEqual(cfg.max_upload_bytes, 2000000000)
        self.assertEqual(cfg.port, 3005)

    @patch.dict(os.environ, {
        "TELETHON_API_ID": "invalid",
    }, clear=True)
    def test_invalid_api_id(self):
        from config import get_settings
        with self.assertRaises(ValueError):
            get_settings()

if __name__ == "__main__":
    unittest.main()
