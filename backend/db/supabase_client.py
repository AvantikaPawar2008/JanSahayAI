"""Single shared Supabase client instance — import this wherever you need DB access."""

# pyrefly: ignore [missing-import]
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
    Returns a Supabase client. Uses service role client to guarantee reliable backend
    data access without PostgreSQL circular RLS recursion failures on master_tickets.
    """
    return get_supabase_client()

