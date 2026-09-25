"""Storage service for managing file uploads to Supabase Storage with automatic compression and resilient fallbacks."""

import os
import io
import uuid
import base64
import logging
import requests
from typing import Optional, Tuple
from PIL import Image, ImageOps
from backend.config import get_settings

logger = logging.getLogger(__name__)

PRIMARY_BUCKET = "complaint-media"
FALLBACK_BUCKET = "JanSahayAI-media"


def optimize_image(raw_bytes: bytes, max_dim: int = 1600, quality: int = 85) -> Tuple[bytes, str]:
    """
    Optimizes and compresses image bytes to prevent slow network uploads and timeouts.
    Maintains high visual fidelity while reducing file size from 10MB+ down to ~150-300KB.
    """
    try:
        img = Image.open(io.BytesIO(raw_bytes))
        img = ImageOps.exif_transpose(img)
        if img.mode in ("RGBA", "P"):
            img = img.convert("RGB")
        img.thumbnail((max_dim, max_dim), Image.Resampling.LANCZOS)
        out = io.BytesIO()
        img.save(out, format="JPEG", quality=quality, optimize=True)
        return out.getvalue(), "image/jpeg"
    except Exception as e:
        logger.warning(f"Image optimization skipped: {e}")
        return raw_bytes, "image/jpeg"


def upload_image_bytes(
    supabase=None,
    image_bytes: bytes = b"",
    storage_path: str = "",
    content_type: str = "image/jpeg",
) -> str:
    """
    Direct HTTP upload to Supabase Storage, bypassing storage3 client bugs (such as
    UnboundLocalError: cannot access local variable 'response' where it is not associated with a value).
    Compresses image if needed, tries primary and fallback buckets, and falls back to local data URI
    if Supabase storage is temporarily unreachable.
    """
    settings = get_settings()
    supabase_url = settings.supabase_url.rstrip("/")
    service_key = settings.supabase_service_role_key

    # 1. Optimize image to prevent network timeouts
    optimized_bytes, content_type = optimize_image(image_bytes)

    # Clean filename
    filename = storage_path.rsplit("/", 1)[-1] if "/" in storage_path else f"photo_{uuid.uuid4().hex[:8]}.jpg"
    headers = {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
        "x-upsert": "true",
    }

    buckets = [PRIMARY_BUCKET, FALLBACK_BUCKET]
    last_error: Optional[str] = None

    for bucket in buckets:
        upload_url = f"{supabase_url}/storage/v1/object/{bucket}/{storage_path}"
        public_url = f"{supabase_url}/storage/v1/object/public/{bucket}/{storage_path}"
        
        try:
            files = {"file": (filename, optimized_bytes, content_type)}
            resp = requests.post(upload_url, headers=headers, files=files, timeout=30)
            
            if resp.status_code in (200, 201):
                logger.info(f"Direct storage upload succeeded to bucket '{bucket}': {public_url}")
                return public_url
            
            # If bucket not found, attempt to auto-create it
            if resp.status_code == 404 and "Bucket not found" in resp.text:
                logger.info(f"Bucket '{bucket}' not found. Attempting creation...")
                create_resp = requests.post(
                    f"{supabase_url}/storage/v1/bucket",
                    headers=headers,
                    json={"id": bucket, "name": bucket, "public": True},
                    timeout=15,
                )
                if create_resp.status_code in (200, 201):
                    # Retry upload once
                    retry_files = {"file": (filename, optimized_bytes, content_type)}
                    retry_resp = requests.post(upload_url, headers=headers, files=retry_files, timeout=30)
                    if retry_resp.status_code in (200, 201):
                        return public_url
                last_error = f"Bucket '{bucket}' 404 and auto-creation returned {create_resp.status_code}"
            else:
                last_error = f"Bucket '{bucket}' returned HTTP {resp.status_code}: {resp.text}"
                logger.warning(last_error)

        except Exception as ex:
            last_error = f"Network error during upload to '{bucket}': {ex}"
            logger.warning(last_error)

    # Safe local fallback: encode as data URI so work/proof photo is NEVER lost!
    logger.warning(f"All remote storage buckets failed ({last_error}). Falling back to data URI storage.")
    try:
        b64_data = base64.b64encode(optimized_bytes).decode("utf-8")
        data_uri = f"data:{content_type};base64,{b64_data}"
        return data_uri
    except Exception as b64_err:
        raise RuntimeError(f"All storage upload attempts failed. Last error: {last_error}") from b64_err
