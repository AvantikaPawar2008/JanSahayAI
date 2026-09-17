"""Pydantic request/response models — grouped by feature with section comments."""

from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime
from enum import Enum


# ============================================================
# ENUMS
# ============================================================

class UrgencyLevel(str, Enum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"
    CRITICAL = "CRITICAL"


class TicketStatus(str, Enum):
    OPEN = "OPEN"
    ASSIGNED = "ASSIGNED"
    IN_PROGRESS = "IN_PROGRESS"
    RESOLVED_PENDING_CITIZEN = "RESOLVED_PENDING_CITIZEN"
    RESOLVED = "RESOLVED"
    REOPENED = "REOPENED"
    CLOSED = "CLOSED"


class DepartmentType(str, Enum):
    WATER = "Water Supply & Sewerage"
    ROADS = "Roads & Infrastructure"
    WASTE = "Solid Waste Management"
    ELECTRICAL = "Electrical & Streetlighting"
    HEALTH = "Health & Sanitation"


class PhotoType(str, Enum):
    BEFORE = "before"
    AFTER = "after"


class AlertStatus(str, Enum):
    NEW = "NEW"
    ACKNOWLEDGED = "ACKNOWLEDGED"
    INVESTIGATING = "INVESTIGATING"
    RESOLVED = "RESOLVED"


class UserRole(str, Enum):
    CITIZEN = "citizen"
    OFFICER = "officer"
    ADMIN = "admin"


# ============================================================
# INTAKE — Citizen complaint submission
# ============================================================

class IntakeResponse(BaseModel):
    """Response returned after a citizen submits a complaint."""
    master_ticket_id: str
    is_duplicate: bool
    category: str
    sub_category: Optional[str] = None
    department: Optional[str] = None
    urgency: Optional[str] = None
    message: str
    upvote_count: int = 1
    address_text: Optional[str] = None


# ============================================================
# TRIAGE — LLM classification result
# ============================================================

class TriageResult(BaseModel):
    """Structured output from the triage LLM call."""
    department: str
    urgency: str
    category: str
    sub_category: Optional[str] = None
    sop_steps: List[str]
    tools_required: List[str]
    citizen_sms_draft: str
    needs_admin_review: bool = False


# ============================================================
# TICKETS — CRUD models
# ============================================================

class TicketResponse(BaseModel):
    """Full ticket representation for API responses."""
    id: str
    category: str
    sub_category: Optional[str] = None
    department: Optional[str] = None
    urgency: Optional[str] = None
    status: str
    lat: float
    lng: float
    address_text: Optional[str] = None
    sop_steps: Optional[List[str]] = None
    tools_required: Optional[List[str]] = None
    citizen_sms_draft: Optional[str] = None
    assigned_officer_id: Optional[str] = None
    upvote_count: int = 1
    description: Optional[str] = None
    created_at: Optional[str] = None
    resolved_at: Optional[str] = None
    priority_score: Optional[float] = None
    priority_sla_component: Optional[float] = None
    priority_urgency_component: Optional[float] = None
    priority_duplicate_component: Optional[float] = None
    needs_admin_review: Optional[bool] = False
    department_reassigned_by: Optional[str] = None
    department_reassigned_at: Optional[str] = None


class DepartmentReassignRequest(BaseModel):
    """Request payload for an admin reassigning a ticket's department."""
    department: DepartmentType


class TicketUpdateRequest(BaseModel):
    """Partial update for a ticket."""
    status: Optional[TicketStatus] = None
    assigned_officer_id: Optional[str] = None


class TicketListResponse(BaseModel):
    """Paginated ticket list."""
    tickets: List[TicketResponse]
    total: int


# ============================================================
# OFFICER — Queue and proof-of-work
# ============================================================

class OfficerQueueItem(BaseModel):
    """A ticket item in the officer's prioritized queue."""
    id: str
    category: str
    sub_category: Optional[str] = None
    department: Optional[str] = None
    urgency: Optional[str] = None
    status: str
    lat: float
    lng: float
    address_text: Optional[str] = None
    upvote_count: int = 1
    description: Optional[str] = None
    created_at: Optional[str] = None
    priority_score: float = 0.0
    priority_sla_component: Optional[float] = None
    priority_urgency_component: Optional[float] = None
    priority_duplicate_component: Optional[float] = None
    sop_steps: Optional[List[str]] = None
    tools_required: Optional[List[str]] = None
    needs_admin_review: Optional[bool] = False


class ProofSubmissionResponse(BaseModel):
    """Response after officer submits before/after photo."""
    verification_photo_id: str
    photo_type: str
    message: str


# ============================================================
# VERIFICATION — Anti-fraud check results
# ============================================================

class VerificationRequest(BaseModel):
    """Request to verify a before/after photo pair."""
    master_ticket_id: str
    officer_id: Optional[str] = None


class VerificationResult(BaseModel):
    """Result of anti-fraud verification checks."""
    geofence_passed: bool
    vision_check_passed: bool
    same_location: bool
    defect_resolved: bool
    repair_quality: Optional[str] = None
    confidence: float = 0.0
    notes: str = ""
    overall_passed: bool


# ============================================================
# HOTSPOT — Cluster detection
# ============================================================

class HotspotAlert(BaseModel):
    """A detected hotspot cluster alert."""
    id: str
    category: str
    sub_category: Optional[str] = None
    department: Optional[str] = None
    center_lat: float
    center_lng: float
    radius_m: float
    ticket_count: int
    ticket_ids: Optional[List[str]] = None
    status: str
    root_cause_analysis: Optional[str] = None
    created_at: Optional[str] = None


class HotspotDetectionResponse(BaseModel):
    """Response from running hotspot detection."""
    alerts_created: int
    alerts: List[HotspotAlert]


# ============================================================
# ADMIN — Dashboard metrics
# ============================================================

class DashboardMetrics(BaseModel):
    """Aggregated metrics for the admin dashboard."""
    total_tickets: int = 0
    open_tickets: int = 0
    in_progress_tickets: int = 0
    resolved_tickets: int = 0
    critical_tickets: int = 0
    avg_resolution_hours: Optional[float] = None
    tickets_by_department: dict = {}
    tickets_by_urgency: dict = {}
    tickets_today: int = 0
    active_hotspots: int = 0
    sla_breach_rate: float = 0.0
    sla_breached_tickets: int = 0
    department_breakdown: List[dict] = []


# ============================================================
# AUTH — User models
# ============================================================

class UserProfile(BaseModel):
    """User profile with role information."""
    id: str
    auth_user_id: str
    role: UserRole
    name: str
    phone_number: Optional[str] = None
    department: Optional[str] = None


class LoginRequest(BaseModel):
    email: str
    password: str


class SignupRequest(BaseModel):
    email: str
    password: str
    name: str
    role: UserRole = UserRole.CITIZEN
    phone_number: Optional[str] = None
    department: Optional[str] = None
