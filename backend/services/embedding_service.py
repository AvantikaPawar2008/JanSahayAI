"""Generates text embeddings locally using sentence-transformers (no API calls)."""

# pyrefly: ignore [missing-import]
from sentence_transformers import SentenceTransformer
from backend.config import get_settings
# pyrefly: ignore [missing-import]
import numpy as np

# Module-level model cache — loaded once on first call
_model = None


def _get_model() -> SentenceTransformer:
    """Lazy-loads the sentence-transformers model (cached after first call)."""
    global _model
    if _model is None:
        settings = get_settings()
        _model = SentenceTransformer(settings.embedding_model_name)
    return _model


def get_embedding(text: str) -> list[float]:
    """
    Generates a 384-dim embedding vector for the given text.
    
    Args:
        text: Input text to embed
    
    Returns:
        List of floats (384-dimensional vector for MiniLM)
    """
    model = _get_model()
    embedding = model.encode(text, normalize_embeddings=True)
    return embedding.tolist()


def compute_cosine_similarity(vec_a: list[float], vec_b: list[float]) -> float:
    """
    Computes cosine similarity between two vectors.
    
    Returns:
        Float between -1 and 1 (1 = identical, 0 = orthogonal)
    """
    a = np.array(vec_a)
    b = np.array(vec_b)
    dot = np.dot(a, b)
    norm_a = np.linalg.norm(a)
    norm_b = np.linalg.norm(b)
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return float(dot / (norm_a * norm_b))


def preload_model():
    """Call at app startup to preload the model (avoids first-request latency)."""
    _get_model()
