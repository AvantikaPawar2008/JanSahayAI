"""Loads all environment variables into a single Settings object for the entire backend."""

# pyrefly: ignore [missing-import]
from pydantic_settings import BaseSettings
from pydantic import Field, field_validator
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

    # WhatsApp
    whatsapp_api_token: str = Field(default="", env="WHATSAPP_API_TOKEN")
    whatsapp_verify_token: str = Field(default="jansahayai_secret_token", env="WHATSAPP_VERIFY_TOKEN")
    whatsapp_app_secret: str = Field(default="", env="WHATSAPP_APP_SECRET")

    # Tunable thresholds
    dedup_similarity_threshold: float = Field(default=0.80, env="DEDUP_SIMILARITY_THRESHOLD")
    dedup_high_confidence_threshold: float = Field(default=0.90, env="DEDUP_HIGH_CONFIDENCE_THRESHOLD")
    dedup_low_confidence_threshold: float = Field(default=0.60, env="DEDUP_LOW_CONFIDENCE_THRESHOLD")
    laya_duplicate_confirm_threshold: float = Field(default=0.60, env="LAYA_DUPLICATE_CONFIRM_THRESHOLD")
    laya_low_confidence_review_threshold: float = Field(default=0.55, env="LAYA_LOW_CONFIDENCE_REVIEW_THRESHOLD")
    geofence_radius_meters: float = Field(default=150.0, env="GEOFENCE_RADIUS_METERS")
    hotspot_eps_meters: float = Field(default=100.0, env="HOTSPOT_EPS_METERS")
    hotspot_min_points: int = Field(default=5, env="HOTSPOT_MIN_POINTS")

    # LLM model names
    groq_text_model: str = "openai/gpt-oss-20b"
    groq_vision_model: str = Field(default="qwen/qwen3.8-27b", env="GROQ_VISION_MODEL")
    groq_whisper_model: str = "whisper-large-v3-turbo"

    @field_validator("groq_vision_model", mode="before")
    @classmethod
    def sanitize_vision_model(cls, v: str) -> str:
        """Coerce decommissioned or missing Groq vision models to the active supported model."""
        if not v or any(bad in str(v).lower() for bad in ["llama-3.2", "11b-vision", "90b-vision"]):
            return "qwen/qwen3.8-27b"
        return str(v).strip()

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
