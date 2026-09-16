"""Loads all environment variables into a single Settings object for the entire backend."""

from pydantic_settings import BaseSettings
from pydantic import Field
from functools import lru_cache


import os

ENV_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")


class Settings(BaseSettings):
    # Groq API
    groq_api_key: str = Field(default="", env="GROQ_API_KEY")

    # Supabase
    supabase_url: str = Field(default="", env="SUPABASE_URL")
    supabase_anon_key: str = Field(default="", env="SUPABASE_ANON_KEY")
    supabase_service_role_key: str = Field(default="", env="SUPABASE_SERVICE_ROLE_KEY")

    # WhatsApp (optional)
    whatsapp_api_token: str = Field(default="", env="WHATSAPP_API_TOKEN")

    # Tunable thresholds
    dedup_similarity_threshold: float = Field(default=0.80, env="DEDUP_SIMILARITY_THRESHOLD")
    geofence_radius_meters: float = Field(default=150.0, env="GEOFENCE_RADIUS_METERS")
    hotspot_eps_meters: float = Field(default=100.0, env="HOTSPOT_EPS_METERS")
    hotspot_min_points: int = Field(default=5, env="HOTSPOT_MIN_POINTS")

    # LLM model names
    groq_text_model: str = "openai/gpt-oss-20b"
    groq_vision_model: str = "llama-3.2-11b-vision-preview"
    groq_whisper_model: str = "whisper-large-v3"

    # Embedding model
    embedding_model_name: str = "all-MiniLM-L6-v2"

    model_config = {
        "env_file": (ENV_FILE, ".env"),
        "env_file_encoding": "utf-8",
        "extra": "ignore",
    }


@lru_cache()
def get_settings() -> Settings:
    return Settings()
