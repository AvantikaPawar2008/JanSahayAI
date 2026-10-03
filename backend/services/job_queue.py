"""[TODO-IN-01] Async Background Job Queue for STT & Vision Triage.

Decouples heavy Whisper STT and Vision inference from the HTTP request cycle.
Uses asyncio.Queue as an in-process queue (zero additional infrastructure).
Designed to be a drop-in upgrade path to ARQ/Celery/pgmq with no API changes.

Flow:
 1. Intake router calls enqueue_stt_job() / enqueue_vision_job() -> returns immediately
 2. Worker coroutine processes jobs in background (rate-limited, retry-backoff)
 3. Results are written directly to Supabase master_tickets / ticket_reports
 4. Client polls GET /api/intake/job/{job_id} or uses Supabase realtime for push
"""

import asyncio
import logging
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Callable, Awaitable, Optional

logger = logging.getLogger("civicpulse.jobqueue")


class JobStatus(str, Enum):
    QUEUED = "QUEUED"
    PROCESSING = "PROCESSING"
    DONE = "DONE"
    FAILED = "FAILED"


class JobType(str, Enum):
    STT_TRANSCRIBE = "STT_TRANSCRIBE"
    VISION_TRIAGE = "VISION_TRIAGE"
    VISION_VERIFY = "VISION_VERIFY"


@dataclass
class Job:
    job_id: str = field(default_factory=lambda: str(uuid.uuid4()))
    job_type: JobType = JobType.STT_TRANSCRIBE
    payload: dict = field(default_factory=dict)
    status: JobStatus = JobStatus.QUEUED
    result: Optional[dict] = None
    error: Optional[str] = None
    created_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    updated_at: str = field(default_factory=lambda: datetime.now(timezone.utc).isoformat())
    retries: int = 0
    max_retries: int = 3


# Singleton queue + result store
_queue: asyncio.Queue[Job] = asyncio.Queue(maxsize=500)
_results: dict[str, Job] = {}
_worker_running: bool = False


def get_job_status(job_id: str) -> Optional[Job]:
    """Retrieve a job's current status and result by job_id."""
    return _results.get(job_id)


async def enqueue_stt_job(audio_bytes: bytes, filename: str, ticket_report_id: str) -> str:
    """
    Enqueue a background STT transcription job.

    Returns:
        job_id - the caller can poll GET /api/intake/job/{job_id}
    """
    job = Job(
        job_type=JobType.STT_TRANSCRIBE,
        payload={
            "audio_bytes": audio_bytes,
            "filename": filename,
            "ticket_report_id": ticket_report_id,
        },
    )
    _results[job.job_id] = job
    try:
        _queue.put_nowait(job)
    except asyncio.QueueFull:
        logger.error("Job queue full - dropping STT job for report %s", ticket_report_id)
        job.status = JobStatus.FAILED
        job.error = "Queue full - server overloaded"
        return job.job_id

    logger.info("STT job %s queued for report %s", job.job_id, ticket_report_id)
    return job.job_id


async def enqueue_vision_job(image_url: str, ticket_report_id: str, master_ticket_id: str) -> str:
    """
    Enqueue a background Vision triage job.

    Returns:
        job_id - the caller can poll GET /api/intake/job/{job_id}
    """
    job = Job(
        job_type=JobType.VISION_TRIAGE,
        payload={
            "image_url": image_url,
            "ticket_report_id": ticket_report_id,
            "master_ticket_id": master_ticket_id,
        },
    )
    _results[job.job_id] = job
    try:
        _queue.put_nowait(job)
    except asyncio.QueueFull:
        logger.error("Job queue full - dropping Vision job for ticket %s", master_ticket_id)
        job.status = JobStatus.FAILED
        job.error = "Queue full - server overloaded"
        return job.job_id

    logger.info("Vision job %s queued for ticket %s", job.job_id, master_ticket_id)
    return job.job_id


async def _process_stt_job(job: Job) -> dict:
    """Execute a STT transcription job and write result to Supabase."""
    from backend.services.transcription_service import transcribe_audio
    from backend.db.supabase_client import get_supabase_client

    audio_bytes: bytes = job.payload["audio_bytes"]
    filename: str = job.payload["filename"]
    ticket_report_id: str = job.payload["ticket_report_id"]

    result = await transcribe_audio(audio_bytes, filename)
    transcript = result.get("transcript", "")
    translated = result.get("translated_text", "")

    supabase = get_supabase_client()
    supabase.table("ticket_reports").update({
        "transcript": transcript,
        "translated_text": translated,
    }).eq("id", ticket_report_id).execute()

    logger.info("STT job %s complete - transcript written to report %s", job.job_id, ticket_report_id)
    return {"transcript": transcript, "translated_text": translated}


async def _process_vision_job(job: Job) -> dict:
    """Execute a Vision triage job and write result to Supabase."""
    from backend.services.vision_service import analyze_complaint_photo
    from backend.db.supabase_client import get_supabase_client

    image_url: str = job.payload["image_url"]
    master_ticket_id: str = job.payload["master_ticket_id"]

    vision_result = await analyze_complaint_photo(image_url)
    description = vision_result.get("description", "")

    supabase = get_supabase_client()
    if description:
        supabase.table("master_tickets").update({
            "description": description,
        }).eq("id", master_ticket_id).execute()

    logger.info("Vision job %s complete - description written to ticket %s", job.job_id, master_ticket_id)
    return vision_result


_JOB_HANDLERS: dict[JobType, Callable[[Job], Awaitable[dict]]] = {
    JobType.STT_TRANSCRIBE: _process_stt_job,
    JobType.VISION_TRIAGE: _process_vision_job,
}


async def _worker_loop():
    """Background coroutine that drains the job queue with retry + exponential backoff."""
    global _worker_running
    _worker_running = True
    logger.info("Background job queue worker started")

    while True:
        job: Job = await _queue.get()
        job.status = JobStatus.PROCESSING
        job.updated_at = datetime.now(timezone.utc).isoformat()

        handler = _JOB_HANDLERS.get(job.job_type)
        if not handler:
            job.status = JobStatus.FAILED
            job.error = f"No handler registered for job type {job.job_type}"
            logger.error("No handler for job type %s (job %s)", job.job_type, job.job_id)
            _queue.task_done()
            continue

        try:
            job.result = await handler(job)
            job.status = JobStatus.DONE
        except Exception as exc:
            job.retries += 1
            if job.retries <= job.max_retries:
                backoff = 2 ** job.retries
                logger.warning(
                    "Job %s (type=%s) failed (attempt %d/%d) - retrying in %ds: %s",
                    job.job_id, job.job_type, job.retries, job.max_retries, backoff, exc,
                )
                job.status = JobStatus.QUEUED
                await asyncio.sleep(backoff)
                await _queue.put(job)
            else:
                job.status = JobStatus.FAILED
                job.error = str(exc)
                logger.error(
                    "Job %s (type=%s) permanently failed after %d retries: %s",
                    job.job_id, job.job_type, job.max_retries, exc,
                )

        job.updated_at = datetime.now(timezone.utc).isoformat()
        _results[job.job_id] = job
        _queue.task_done()


async def start_worker():
    """
    Called once from FastAPI lifespan startup to launch the background worker.
    Safe to call multiple times - idempotent.
    """
    global _worker_running
    if not _worker_running:
        asyncio.create_task(_worker_loop())
