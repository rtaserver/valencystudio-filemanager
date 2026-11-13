import asyncio
import os
from typing import AsyncGenerator, Optional
from telethon import TelegramClient, functions, types
from telethon.tl.types import Message, Document
from config import Settings, get_settings
from stream_reader import AsyncStreamReader

class TelethonClientManager:
    UPLOAD_PART_SIZE = 512 * 1024
    MAX_UPLOAD_PARTS = 4000
    MAX_MULTIPART_BYTES = 2_000_000_000

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

    async def upload_big_file_part(self, telegram_file_id: int, index: int, total_parts: int, data: bytes) -> bool:
        """Upload one idempotently-addressed MTProto big-file part; keeps bytes only in memory."""
        if not await self.is_healthy():
            raise RuntimeError("Telethon client is not connected")
        if not -(2**63) <= telegram_file_id < 2**63:
            raise ValueError("Telegram multipart file ID is out of range")
        max_parts_for_size = (self.MAX_MULTIPART_BYTES + self.UPLOAD_PART_SIZE - 1) // self.UPLOAD_PART_SIZE
        if total_parts <= 0 or total_parts > min(self.MAX_UPLOAD_PARTS, max_parts_for_size):
            raise ValueError("Multipart upload part count is out of supported range")
        if index < 0 or index >= total_parts:
            raise ValueError("Multipart upload part index is out of range")
        expected_max = self.UPLOAD_PART_SIZE
        if not data or len(data) > expected_max or (index < total_parts - 1 and len(data) != expected_max):
            raise ValueError("Multipart upload part has invalid size")
        async with self._semaphore:
            return bool(await self.client(functions.upload.SaveBigFilePartRequest(
                file_id=telegram_file_id,
                file_part=index,
                file_total_parts=total_parts,
                bytes=data,
            )))

    async def finalize_big_file(self, telegram_file_id: int, total_parts: int, filename: str, mime_type: str, caption: str) -> dict:
        if not await self.is_healthy():
            raise RuntimeError("Telethon client is not connected")
        if not -(2**63) <= telegram_file_id < 2**63:
            raise ValueError("Telegram multipart file ID is out of range")
        max_parts_for_size = (self.MAX_MULTIPART_BYTES + self.UPLOAD_PART_SIZE - 1) // self.UPLOAD_PART_SIZE
        if total_parts <= 0 or total_parts > min(self.MAX_UPLOAD_PARTS, max_parts_for_size):
            raise ValueError("Multipart upload part count is out of supported range")
        if not filename or len(filename) > 255 or not mime_type or len(mime_type) > 120 or len(caption) > 64:
            raise ValueError("invalid multipart finalization metadata")
        async with self._semaphore:
            if not self.chat_entity and self.settings.storage_chat_id:
                self.chat_entity = await self.client.get_entity(self.settings.storage_chat_id)
            target = self.chat_entity or self.settings.storage_chat_id
            if caption:
                async for existing in self.client.iter_messages(target, search=caption, limit=10):
                    if existing.message == caption and existing.document:
                        doc: Optional[Document] = existing.document
                        return {"message_id": existing.id, "document_id": str(doc.id), "chat_id": self.settings.storage_chat_id}
            uploaded = types.InputFileBig(telegram_file_id, total_parts, filename)
            msg: Message = await self.client.send_file(
                entity=target,
                file=uploaded,
                caption=caption or f"📦 {filename}",
                force_document=True,
                mime_type=mime_type,
            )
            doc: Optional[Document] = msg.document
            return {
                "message_id": msg.id,
                "document_id": str(doc.id) if doc else "",
                "chat_id": self.settings.storage_chat_id,
            }

    async def upload_stream(self, reader: AsyncStreamReader, filename: str, mime_type: str, caption: str) -> dict:
        if not await self.is_healthy():
            raise RuntimeError("Telethon client is not connected")

        async with self._semaphore:
            uploaded_file = None
            message_sent = False
            try:
                uploaded_file = await self.client.upload_file(
                    file=reader,
                    file_name=filename,
                    file_size=reader.total_size,
                )
                await reader.finish()

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
                message_sent = True

                doc: Optional[Document] = msg.document
                document_id = str(doc.id) if doc else ""

                return {
                    "message_id": msg.id,
                    "document_id": document_id,
                    "size": reader.tell(),
                    "checksum": reader.get_sha256(),
                    "chat_id": self.settings.storage_chat_id,
                }
            except Exception:
                if uploaded_file is not None and not message_sent:
                    try:
                        await self.client.delete_file(uploaded_file)
                    except Exception:
                        pass
                raise

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
