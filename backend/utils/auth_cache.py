"""
Fast in-memory cache for user profiles and roles resolved from JWT tokens.
Eliminates 2 sequential HTTP network round-trips (auth.get_user + profiles query) per backend API request.
"""

import time
import logging
from typing import Optional, Tuple
from backend.db.supabase_client import get_supabase_client

logger = logging.getLogger("civicpulse.auth_cache")

# token_str -> (expiry_timestamp, user_id, role, department)
_auth_cache: dict[str, Tuple[float, str, Optional[str], Optional[str]]] = {}
CACHE_TTL = 300.0  # 5 minutes


def resolve_user_from_token(authorization: str) -> Tuple[Optional[str], Optional[str], Optional[str]]:
    """
    Extracts (user_id, role, department) for a given Bearer token.
    Uses in-memory cache to return results in 0.0ms on warm requests.
    Returns (None, None, None) if token is invalid or lookup fails.
    """
    if not authorization or not authorization.startswith("Bearer "):
        return None, None, None

    token_str = authorization.replace("Bearer ", "").strip()
    if not token_str:
        return None, None, None

    now = time.time()

    # Check warm cache
    if token_str in _auth_cache:
        exp, uid, role, dept = _auth_cache[token_str]
        if now < exp:
            return uid, role, dept
        else:
            _auth_cache.pop(token_str, None)

    # Cache miss: fetch from Supabase
    try:
        admin_db = get_supabase_client()
        user_res = admin_db.auth.get_user(token_str)
        if user_res and user_res.user:
            uid = str(user_res.user.id)
            p = admin_db.table("profiles").select("department, role").eq("id", uid).single().execute()
            role = p.data.get("role") if p.data else None
            dept = p.data.get("department") if p.data else None
            _auth_cache[token_str] = (now + CACHE_TTL, uid, role, dept)
            return uid, role, dept
    except Exception as e:
        logger.debug(f"Auth resolution failed: {e}")

    return None, None, None
