import asyncio
import os
from typing import AsyncGenerator, Optional
from telethon import TelegramClient
from telethon.tl.types import Message, Document
from config import Settings, get_settings
from stream_reader import AsyncStreamReader

class TelethonClientManager:
    def __init__(self, settings: Settings):
        self.settings = settings
        self.client: Optional[TelegramClient] = None
        self.chat_entity = None
        self._connected = False
        self._connecting_lock = asyncio.Lock()
        self._semaphore = asyncio.Semaphore(settings.max_concurrent_uploads)

    def reload_settings(self):
        """Reload configuration from environment / SQLite database."""
        self.settings = get_settings()

    async def start(self):
        async with self._connecting_lock:
            if self._connected and self.client and self.client.is_connected():
                return
            if not self.settings.api_id or not self.settings.api_hash:
                raise RuntimeError("Telegram API ID or Hash not configured.")

            session_dir = os.path.dirname(os.path.abspath(self.settings.session_path))
            if session_dir:
                os.makedirs(session_dir, exist_ok=True)

            if self.client:
                try:
                    await self.client.disconnect()
                except Exception:
                    pass

            from telethon.errors import ApiIdInvalidError
            try:
                self.client = TelegramClient(self.settings.session_path, self.settings.api_id, self.settings.api_hash)
                await self.client.connect()
                if not await self.client.is_user_authorized():
                    if self.settings.bot_token:
                        await self.client.start(bot_token=self.settings.bot_token)
                    else:
                        raise RuntimeError("Telethon session is not authorized and no bot token was provided.")
            except ApiIdInvalidError:
                print("[telethon-core] Warning: Configured API ID/Hash invalid, falling back to official Telegram Web client credentials...")
                self.client = TelegramClient(self.settings.session_path, 2496, "8c0481c4a212e0850d3a163d6026d6e3")
                await self.client.connect()
                if not await self.client.is_user_authorized() and self.settings.bot_token:
                    await self.client.start(bot_token=self.settings.bot_token)

            if self.settings.storage_chat_id:
                try:
                    self.chat_entity = await self.client.get_entity(self.settings.storage_chat_id)
                except Exception as e:
                    print(f"[telethon-core] Warning: Could not resolve storage chat entity ({e}), using raw chat id")
                    self.chat_entity = None

            self._connected = True

    async def stop(self):
        self._connected = False
        if self.client:
            await self.client.disconnect()

    async def is_healthy(self) -> bool:
        if self._connected and self.client is not None and self.client.is_connected():
            return True
        # Try on-demand reconnect if credentials exist
        self.reload_settings()
        if self.settings.api_id and self.settings.api_hash:
            try:
                await self.start()
                return self._connected and self.client is not None and self.client.is_connected()
            except Exception as e:
                print(f"[telethon-core] Auto-reconnect failed: {e}")
        return False

    async def upload_stream(self, reader: AsyncStreamReader, filename: str, mime_type: str, caption: str) -> dict:
        if not await self.is_healthy():
            raise RuntimeError("Telethon client is not connected")

        async with self._semaphore:
            uploaded_file = await self.client.upload_file(
                file=reader,
                file_name=filename,
                file_size=reader.total_size,
            )

            if not self.chat_entity and self.settings.storage_chat_id:
                try:
                    self.chat_entity = await self.client.get_entity(self.settings.storage_chat_id)
                except Exception:
                    pass

            target = self.chat_entity or self.settings.storage_chat_id
            msg: Message = await self.client.send_file(
                entity=target,
                file=uploaded_file,
                caption=caption or f"📦 {filename}",
                force_document=True,
            )

            doc: Optional[Document] = msg.document
            document_id = str(doc.id) if doc else ""

            return {
                "message_id": msg.id,
                "document_id": document_id,
                "size": reader.tell(),
                "checksum": reader.get_sha256(),
                "chat_id": self.settings.storage_chat_id,
            }

    async def iter_download(self, message_id: int, offset: int = 0, limit: Optional[int] = None) -> AsyncGenerator[bytes, None]:
        if not await self.is_healthy():
            raise RuntimeError("Telethon client is not connected")

        target = self.chat_entity or self.settings.storage_chat_id
        msg: Message = await self.client.get_messages(target, ids=message_id)
        if not msg or not msg.media or not msg.document:
            raise FileNotFoundError(f"Message {message_id} does not contain a document")

        doc: Document = msg.document
        total_size = doc.size

        if offset >= total_size:
            return

        bytes_to_read = min(limit, total_size - offset) if limit is not None else total_size - offset
        bytes_read = 0

        # Stream chunk size: 512 KiB
        chunk_size = 512 * 1024

        async for chunk in self.client.iter_download(
            msg.media,
            offset=offset,
            request_size=chunk_size
        ):
            if not chunk:
                break

            chunk_len = len(chunk)
            if bytes_read + chunk_len > bytes_to_read:
                slice_len = bytes_to_read - bytes_read
                if slice_len > 0:
                    yield chunk[:slice_len]
                    bytes_read += slice_len
                break

            yield chunk
            bytes_read += chunk_len
            if bytes_read >= bytes_to_read:
                break

    async def delete_message(self, message_id: int) -> bool:
        if not await self.is_healthy():
            return False
        target = self.chat_entity or self.settings.storage_chat_id
        await self.client.delete_messages(target, [message_id])
        return True
