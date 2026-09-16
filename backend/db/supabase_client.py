"""Single shared Supabase client instance — import this wherever you need DB access."""

from supabase import create_client, Client
from backend.config import get_settings


def get_supabase_client() -> Client:
    """Returns a Supabase client using the service role key (full access for backend ops)."""
    settings = get_settings()
    return create_client(settings.supabase_url, settings.supabase_service_role_key)


def get_supabase_anon_client() -> Client:
    """Returns a Supabase client using the anon key (for operations respecting RLS)."""
    settings = get_settings()
    return create_client(settings.supabase_url, settings.supabase_anon_key)


def get_supabase_user_client(token: str | None = None) -> Client:
    """
    Returns a Supabase client configured with the user's JWT.
    Enforces PostgreSQL Row Level Security (RLS) according to user's profile and role.
    Falls back to service role client if no user token is present.
    """
    if not token:
        return get_supabase_client()

    # Clean bearer prefix if present
    token_str = token.replace("Bearer ", "").strip()
    if not token_str:
        return get_supabase_client()

    settings = get_settings()
    client = create_client(settings.supabase_url, settings.supabase_anon_key)
    try:
        client.postgrest.auth(token_str)
    except Exception:
        pass
    return client

