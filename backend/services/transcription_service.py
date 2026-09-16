"""Converts audio files to text using Groq-hosted Whisper large-v3."""

import tempfile
import os
from backend.utils.groq_client import get_groq_client
from backend.config import get_settings


async def transcribe_audio(audio_bytes: bytes, filename: str = "audio.webm") -> dict:
    """
    Sends audio to Groq Whisper and returns transcript + English translation.
    
    Args:
        audio_bytes: Raw audio file bytes
        filename: Original filename (used for format detection)
    
    Returns:
        dict with keys: transcript (original language), translated_text (English)
    """
    client = get_groq_client()
    settings = get_settings()

    # Write audio bytes to a temp file (Groq SDK needs a file-like object)
    suffix = os.path.splitext(filename)[1] or ".webm"
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        tmp.write(audio_bytes)
        tmp_path = tmp.name

    try:
        # Step 1: Transcribe in original language
        with open(tmp_path, "rb") as audio_file:
            transcription = client.audio.transcriptions.create(
                model=settings.groq_whisper_model,
                file=audio_file,
                response_format="text",
            )

        # Step 2: Translate to English (Whisper's translate endpoint)
        with open(tmp_path, "rb") as audio_file:
            translation = client.audio.translations.create(
                model=settings.groq_whisper_model,
                file=audio_file,
                response_format="text",
            )

        return {
            "transcript": transcription if isinstance(transcription, str) else transcription.text,
            "translated_text": translation if isinstance(translation, str) else translation.text,
        }
    finally:
        # Clean up temp file
        os.unlink(tmp_path)
