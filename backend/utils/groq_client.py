"""Shared Groq client — uses OpenAI SDK with base_url override to hit Groq's API."""

from openai import OpenAI
from backend.config import get_settings


def get_groq_client() -> OpenAI:
    """Returns an OpenAI-compatible client pointed at Groq's API endpoint."""
    settings = get_settings()
    return OpenAI(
        api_key=settings.groq_api_key,
        base_url="https://api.groq.com/openai/v1",
    )
