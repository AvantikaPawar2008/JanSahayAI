"""FastAPI app entrypoint — mounts all routers and configures middleware."""

import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
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

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(name)s | %(levelname)s | %(message)s",
)
logger = logging.getLogger("civicpulse")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Startup/shutdown events — preload ML model on startup."""
    logger.info("🚀 CivicPulse starting up...")
    logger.info("📦 Loading sentence-transformers model (first time may download ~80MB)...")
    preload_model()
    logger.info("✅ Embedding model loaded and ready")
    yield
    logger.info("🛑 CivicPulse shutting down...")


app = FastAPI(
    title="CivicPulse API",
    description="AI-driven municipal complaint resolution platform",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS — allow React dev server
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000", "http://127.0.0.1:5173"],
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
        "name": "CivicPulse API",
        "version": "1.0.0",
        "status": "running",
        "docs": "/docs",
    }


@app.get("/health")
async def health():
    return {"status": "healthy"}
