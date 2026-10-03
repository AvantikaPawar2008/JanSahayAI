import os
import sys
import logging
from contextlib import asynccontextmanager

# Ensure project root is in sys.path so 'from backend...' imports work regardless of cwd
project_root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if project_root not in sys.path:
    sys.path.insert(0, project_root)

# pyrefly: ignore [missing-import]
from fastapi import FastAPI
# pyrefly: ignore [missing-import]
from fastapi.middleware.cors import CORSMiddleware

from backend.routers import (
    intake_router,
    ticket_router,
    officer_router,
    verification_router,
    admin_router,
    whatsapp_webhook,
)
from backend.services.embedding_service import preload_model
from backend.services.laya_service import get_model as preload_laya
from backend.services.job_queue import start_worker as start_job_queue_worker
from backend.services.rag_sop_service import initialize_sop_store

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(name)s | %(levelname)s | %(message)s",
)
logger = logging.getLogger("jansahayai")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup/shutdown events — preload ML models on startup."""
    logger.info("🚀 JanSahayAI starting up...")
    logger.info("📦 Loading sentence-transformers model (first time may download ~80MB)...")
    preload_model()
    logger.info("✅ Embedding model loaded and ready")
    logger.info("📦 Loading Laya typed-decision model (multilingual checkpoint, ~33ms)...")
    preload_laya()
    logger.info("✅ Laya model loaded and ready for zero-latency typed decisions")
    logger.info("📚 Initializing RAG SOP vector store with Indian municipal manuals...")
    initialize_sop_store()
    logger.info("✅ RAG SOP vector store ready")
    logger.info("⚡ Starting async background job queue worker...")
    await start_job_queue_worker()
    logger.info("✅ Background job queue worker running")
    yield
    logger.info("🛑 JanSahayAI shutting down...")


app = FastAPI(
    title="JanSahayAI API",
    description="AI-driven municipal complaint resolution platform",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS — allow React dev server on localhost and 127.0.0.1
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:8000",
        "http://127.0.0.1:8000",
    ],
    allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:[0-9]+)?$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount all routers
app.include_router(intake_router.router)
app.include_router(ticket_router.router)
app.include_router(officer_router.router)
app.include_router(verification_router.router)
app.include_router(admin_router.router)
app.include_router(whatsapp_webhook.router)


@app.get("/")
async def root():
    return {
        "name": "JanSahayAI API",
        "version": "1.0.0",
        "status": "running",
        "docs": "/docs",
    }


@app.get("/health")
async def health():
    return {"status": "healthy"}
