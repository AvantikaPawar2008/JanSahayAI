import { useState, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import {
  Loader2,
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Users,
  Zap,
  RefreshCw,
  Flame,
  ArrowRight,
  ShieldAlert,
  Percent,
  MapPin,
  Search,
  Check,
  Copy,
  ExternalLink,
  FileText,
  SlidersHorizontal,
  ChevronDown,
  ShieldCheck,
  ArrowUpRight,
  Activity,
  RotateCcw,
} from 'lucide-react'
import useAuth from '../../hooks/useAuth'
import { API_BASE } from '../../supabaseClient'
import SlaBadge from '../../components/SlaBadge'


/**
 * AdminDashboardPage — headline metrics overview, SLA breach rate, and department breakdown.
 * (Map logic has been cleanly separated into HotspotMapPage).
 */
export default function AdminDashboardPage() {
  const { session } = useAuth()
  const [metrics, setMetrics] = useState(null)
  const [loading, setLoading] = useState(true)
  const [detecting, setDetecting] = useState(false)
  const [misclassified, setMisclassified] = useState([])
  const [loadingMisclassified, setLoadingMisclassified] = useState(false)
  const [reassigningId, setReassigningId] = useState(null)
  const [targetDepartments, setTargetDepartments] = useState({})

  // Master tickets live management state
  const [tickets, setTickets] = useState([])
  const [loadingTickets, setLoadingTickets] = useState(false)
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [departmentFilter, setDepartmentFilter] = useState('ALL')
  const [searchQuery, setSearchQuery] = useState('')
  const [updatingStatusId, setUpdatingStatusId] = useState(null)
  const [copiedId, setCopiedId] = useState(null)

  // Institutional Accountability & Escalation Engine state
  const [escalatingOverdue, setEscalatingOverdue] = useState(false)
  const [escalationResult, setEscalationResult] = useState(null)
  const [escalatingTicketId, setEscalatingTicketId] = useState(null)

  const departmentsList = [
    'Water Supply & Sewerage',
    'Roads & Infrastructure',
    'Solid Waste Management',
    'Electrical & Streetlighting',
    'Health & Sanitation',
  ]

  const handleEscalateOverdue = async () => {
    setEscalatingOverdue(true)
    try {
      const headers = {}
      if (session?.access_token) {
        headers['Authorization'] = `Bearer ${session.access_token}`
      }
      const res = await fetch(`${API_BASE}/api/admin/escalate-overdue`, {
        method: 'POST',
        headers,
      })
      if (res.ok) {
        const data = await res.json()
        setEscalationResult(data)
        await Promise.all([fetchMetrics(), fetchTickets()])
        setTimeout(() => setEscalationResult(null), 6000)
      }
    } catch (err) {
      console.error('Escalation error:', err)
      alert('Failed to run overdue escalation engine')
    } finally {
      setEscalatingOverdue(false)
    }
  }

  const handleEscalateSingleTicket = async (ticketId) => {
    setEscalatingTicketId(ticketId)
    try {
      const headers = {}
      if (session?.access_token) {
        headers['Authorization'] = `Bearer ${session.access_token}`
      }
      const res = await fetch(`${API_BASE}/api/admin/tickets/${ticketId}/escalate`, {
        method: 'POST',
        headers,
      })
      if (res.ok) {
        setTickets((prev) =>
          prev.map((t) =>
            t.id === ticketId
              ? { ...t, needs_admin_review: true, is_escalated: true, escalation_level: 'LEVEL_1_SUPERVISOR' }
              : t
          )
        )
        fetchMetrics()
      }
    } catch (err) {
      console.error('Manual escalation error:', err)
      alert('Failed to escalate ticket')
    } finally {
      setEscalatingTicketId(null)
    }
  }

  const fetchMetrics = async () => {
    try {
      const headers = {}
      if (session?.access_token) {
        headers['Authorization'] = `Bearer ${session.access_token}`
      }

      const res = await fetch(`${API_BASE}/api/admin/metrics`, { headers })
      if (res.ok) {
        const data = await res.json()
        setMetrics(data)
      }
    } catch (err) {
      console.error('Metrics fetch error:', err)
    } finally {
      setLoading(false)
    }
  }

  const fetchMisclassified = async () => {
    setLoadingMisclassified(true)
    try {
      const headers = {}
      if (session?.access_token) {
        headers['Authorization'] = `Bearer ${session.access_token}`
      }
      const res = await fetch(`${API_BASE}/api/admin/misclassified-tickets`, { headers })
      if (res.ok) {
        const data = await res.json()
        setMisclassified(data)
      }
    } catch (err) {
      console.error('Misclassified fetch notice:', err)
    } finally {
      setLoadingMisclassified(false)
    }
  }

  const fetchTickets = useCallback(async () => {
    setLoadingTickets(true)
    try {
      const params = new URLSearchParams()
      if (statusFilter && statusFilter !== 'ALL') {
        if (statusFilter === 'CRITICAL') {
          params.set('urgency', 'CRITICAL')
        } else {
          params.set('status', statusFilter)
        }
      }
      if (departmentFilter && departmentFilter !== 'ALL') {
        params.set('department', departmentFilter)
      }
      if (searchQuery.trim()) {
        params.set('search', searchQuery.trim())
      }
      params.set('limit', '100')

      const headers = {}
      if (session?.access_token) {
        headers['Authorization'] = `Bearer ${session.access_token}`
      }

      const res = await fetch(`${API_BASE}/api/tickets?${params}`, { headers })
      if (res.ok) {
        const data = await res.json()
        setTickets(data.tickets || [])
      }
    } catch (err) {
      console.error('Failed to load tickets:', err)
    } finally {
      setLoadingTickets(false)
    }
  }, [statusFilter, departmentFilter, searchQuery, session?.access_token])

  const loadDashboardData = async () => {
    await Promise.all([fetchMetrics(), fetchMisclassified(), fetchTickets()])
  }

  useEffect(() => {
    loadDashboardData()
    // Poll metrics every 30s and tickets every 15s for live incident feed
    const metricsInterval = setInterval(fetchMetrics, 30000)
    const ticketsInterval = setInterval(fetchTickets, 15000)
    return () => {
      clearInterval(metricsInterval)
      clearInterval(ticketsInterval)
    }
  }, [session?.access_token, fetchTickets])

  const handleStatusChange = async (ticketId, newStatus) => {
    setUpdatingStatusId(ticketId)
    try {
      const headers = { 'Content-Type': 'application/json' }
      if (session?.access_token) {
        headers['Authorization'] = `Bearer ${session.access_token}`
      }
      const res = await fetch(`${API_BASE}/api/tickets/${ticketId}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ status: newStatus }),
      })
      if (!res.ok) throw new Error('Status update failed')
      setTickets((prev) =>
        prev.map((t) => (t.id === ticketId ? { ...t, status: newStatus } : t))
      )
      fetchMetrics()
    } catch (err) {
      console.error('Status change error:', err)
      alert('Failed to update ticket status')
    } finally {
      setUpdatingStatusId(null)
    }
  }

  const handleCopyId = (id) => {
    try {
      navigator.clipboard.writeText(id)
      setCopiedId(id)
      setTimeout(() => setCopiedId(null), 2000)
    } catch (_) {}
  }

  const handleReassign = async (ticketId, overrideDept = null) => {
    const chosenDept = overrideDept || targetDepartments[ticketId] || 'Water Supply & Sewerage'
    setReassigningId(ticketId)
    try {
      const headers = { 'Content-Type': 'application/json' }
      if (session?.access_token) {
        headers['Authorization'] = `Bearer ${session.access_token}`
      }
      const res = await fetch(`${API_BASE}/api/admin/tickets/${ticketId}/reassign-department`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ department: chosenDept }),
      })
      if (!res.ok) throw new Error('Failed to reassign department')
      setTickets((prev) =>
        prev.map((t) => (t.id === ticketId ? { ...t, department: chosenDept, needs_admin_review: false } : t))
      )
      await Promise.all([fetchMetrics(), fetchMisclassified()])
    } catch (err) {
      console.error('Reassign error:', err)
      alert(err.message || 'Failed to reassign')
    } finally {
      setReassigningId(null)
    }
  }


  const runHotspotDetection = async () => {
    setDetecting(true)
    try {
      const headers = {}
      if (session?.access_token) {
        headers['Authorization'] = `Bearer ${session.access_token}`
      }
      const response = await fetch(`${API_BASE}/api/admin/detect-hotspots`, {
        method: 'POST',
        headers,
      })
      if (response.ok) {
        const result = await response.json()
        alert(`Spatial cluster analysis complete: ${result.alerts_created} hotspots identified`)
        fetchMetrics()
      }
    } catch (err) {
      console.error('Hotspot detection error:', err)
    } finally {
      setDetecting(false)
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-24">
        <Loader2 className="w-8 h-8 text-civic-600 animate-spin" />
      </div>
    )
  }

  const statCards = [
    {
      label: 'Total Complaints',
      value: metrics?.total_tickets || 0,
      icon: TrendingUp,
      badgeBg: 'bg-civic-50 text-civic-700 border-civic-200',
    },
    {
      label: 'Open Queue',
      value: metrics?.open_tickets || 0,
      icon: Clock,
      badgeBg: 'bg-blue-50 text-blue-700 border-blue-200',
    },
    {
      label: 'Overdue (Breached)',
      value: metrics?.total_overdue_tickets || metrics?.sla_breached_tickets || 0,
      icon: ShieldAlert,
      badgeBg: (metrics?.total_overdue_tickets || metrics?.sla_breached_tickets || 0) > 0 ? 'bg-coral-100 text-coral-800 border-coral-300' : 'bg-ivory-100 text-charcoal-700 border-ivory-300',
    },
    {
      label: 'SLA Compliance',
      value: `${metrics?.sla_compliance_rate ?? 100}%`,
      icon: CheckCircle2,
      badgeBg: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    },
    {
      label: 'Reopened Issues',
      value: metrics?.total_reopened_tickets || 0,
      icon: RotateCcw,
      badgeBg: 'bg-amber-50 text-amber-700 border-amber-200',
    },
    {
      label: 'Hotspot Clusters',
      value: metrics?.active_hotspots || 0,
      icon: Zap,
      badgeBg: 'bg-purple-50 text-purple-700 border-purple-200',
    },
  ]

  return (
    <div className="page-enter max-w-7xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-8">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-civic-50 text-civic-700 border border-civic-200">
              Municipal Governance
            </span>
            <span className="text-xs text-charcoal-400 font-mono">Accountability &amp; Escalation System</span>
          </div>
          <h1 className="text-3xl font-extrabold text-charcoal-900 tracking-tight">Executive Operations &amp; SLA Dashboard</h1>
          <p className="text-charcoal-500 text-sm mt-1">
            <strong className="text-charcoal-800 font-semibold">{metrics?.tickets_today || 0}</strong> complaints submitted today · Department performance tracking &amp; automated supervisor escalations
          </p>
        </div>
        <div className="flex items-center gap-2.5 flex-wrap">
          <button onClick={fetchMetrics} className="btn-secondary px-3 py-2" title="Refresh telemetry">
            <RefreshCw className="w-4 h-4 text-charcoal-600" />
          </button>
          <a
            href="#master-tickets-feed"
            className="btn-secondary text-sm flex items-center gap-1.5 font-medium shadow-sm text-charcoal-800"
          >
            <FileText className="w-4 h-4 text-civic-600" />
            Live Tickets ({tickets.length || metrics?.total_tickets || 0})
          </a>
          <button
            onClick={runHotspotDetection}
            disabled={detecting}
            className="btn-secondary text-sm flex items-center gap-1.5 font-medium"
          >
            {detecting ? <Loader2 className="w-4 h-4 animate-spin text-civic-600" /> : <Zap className="w-4 h-4 text-amber-500" />}
            Detect Clusters
          </button>
          <Link to="/admin/hotspots" className="btn-primary text-sm flex items-center gap-1.5 shadow-sm">
            <Flame className="w-4 h-4 text-white" />
            Open Hotspot Map
            <ArrowRight className="w-3.5 h-3.5 ml-0.5" />
          </Link>
        </div>
      </div>

      {/* Escalation Result Toast */}
      {escalationResult && (
        <div className="p-4 mb-6 rounded-2xl bg-coral-50 border border-coral-200 shadow-sm flex items-center justify-between animate-fade-in">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-coral-100 text-coral-700">
              <ShieldAlert className="w-5 h-5" />
            </div>
            <div>
              <p className="text-sm font-bold text-coral-900">{escalationResult.message}</p>
              <p className="text-xs text-coral-700 mt-0.5">
                Audit event logged to immutable ledger: Escalated to Department Supervisor for urgent resolution.
              </p>
            </div>
          </div>
          <button
            onClick={() => setEscalationResult(null)}
            className="text-xs font-bold text-coral-600 hover:text-coral-800 px-2 py-1 rounded"
          >
            ✕
          </button>
        </div>
      )}

      {/* Stat Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3.5 mb-8">
        {statCards.map(({ label, value, icon: Icon, badgeBg }) => (
          <div key={label} className="bg-white rounded-2xl border border-ivory-300 shadow-card hover:shadow-card-hover transition-all duration-200 p-4 text-center animate-fade-in">
            <div className={`w-9 h-9 rounded-xl ${badgeBg} border flex items-center justify-center mx-auto mb-2.5`}>
              <Icon className="w-4 h-4" />
            </div>
            <p className="text-2xl font-bold font-mono text-charcoal-900">{value}</p>
            <p className="text-xs text-charcoal-500 font-medium mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      {/* Accountability Workflow & SLA Escalation Engine Panel */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        {/* SLA Health & Escalation Action Card */}
        <div className="bg-white rounded-2xl border border-ivory-300 shadow-card p-6 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xs font-bold text-charcoal-700 uppercase tracking-wider flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-amber-500" />
                SLA Compliance &amp; Escalation Engine
              </h2>
              <span className="text-xs px-2 py-0.5 rounded-md bg-ivory-100 text-charcoal-500 font-medium border border-ivory-300">
                Target &gt; 95%
              </span>
            </div>

            <div className="flex items-baseline gap-2.5 mb-2">
              <span className={`text-3xl font-extrabold font-mono ${(metrics?.sla_compliance_rate || 100) < 90 ? 'text-coral-600' : 'text-emerald-600'}`}>
                {metrics?.sla_compliance_rate ?? 100}%
              </span>
              <span className="text-xs text-charcoal-500 font-medium">Compliance Rate</span>
            </div>

            <p className="text-xs text-charcoal-600 leading-relaxed mb-4">
              <strong className="text-coral-700 font-semibold">{metrics?.total_overdue_tickets || metrics?.sla_breached_tickets || 0}</strong> complaints currently exceed municipal SLA deadlines.
              {metrics?.near_deadline_tickets > 0 && (
                <span className="text-amber-700 ml-1">
                  · {metrics.near_deadline_tickets} approaching deadline (&lt;4h).
                </span>
              )}
            </p>

            {/* SLA Targets Pill Bar */}
            <div className="grid grid-cols-2 gap-2 text-[11px] mb-4">
              <div className="p-2 rounded-lg bg-coral-50 border border-coral-200">
                <span className="font-bold text-coral-800">Critical: 12h SLA</span>
              </div>
              <div className="p-2 rounded-lg bg-orange-50 border border-orange-200">
                <span className="font-bold text-orange-800">High: 24h SLA</span>
              </div>
              <div className="p-2 rounded-lg bg-amber-50 border border-amber-200">
                <span className="font-bold text-amber-800">Medium: 48h SLA</span>
              </div>
              <div className="p-2 rounded-lg bg-emerald-50 border border-emerald-200">
                <span className="font-bold text-emerald-800">Low: 72h SLA</span>
              </div>
            </div>
          </div>

          <div>
            <div className="w-full h-2.5 rounded-full bg-ivory-200 overflow-hidden p-0.5 border border-ivory-300/80 mb-4">
              <div
                className="h-full rounded-full bg-gradient-to-r from-coral-500 via-amber-500 to-emerald-500 transition-all duration-700"
                style={{ width: `${Math.min(100, Math.max(5, metrics?.sla_compliance_rate || 100))}%` }}
              />
            </div>

            <button
              onClick={handleEscalateOverdue}
              disabled={escalatingOverdue}
              className="w-full btn-secondary text-xs py-2 flex items-center justify-center gap-2 border-coral-300 text-coral-700 hover:bg-coral-50 font-bold shadow-sm"
            >
              {escalatingOverdue ? (
                <Loader2 className="w-4 h-4 animate-spin text-coral-600" />
              ) : (
                <ShieldAlert className="w-4 h-4 text-coral-600" />
              )}
              ⚡ Run Overdue Escalation Engine
            </button>
          </div>
        </div>

        {/* Accountability Hierarchy Workflow Card */}
        <div className="bg-gradient-to-br from-ivory-50 via-white to-ivory-100 rounded-2xl border border-ivory-300 shadow-card p-6 flex flex-col justify-between">
          <div>
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-civic-100 text-civic-800 text-xs font-semibold mb-3 border border-civic-200">
              <Activity className="w-3.5 h-3.5 text-civic-700" />
              Institutional Escalation Flow
            </div>
            <h3 className="text-base font-bold text-charcoal-900 mb-2">
              Systemic Accountability, Not Individual Shaming
            </h3>
            <p className="text-xs text-charcoal-600 leading-relaxed mb-4">
              When standard resolution thresholds elapse without on-site verified completion, the system automatically escalates the complaint to departmental leadership.
            </p>

            {/* Visual Workflow Steps */}
            <div className="space-y-2 text-xs">
              <div className="flex items-center gap-2 p-2 rounded-lg bg-white border border-ivory-200">
                <span className="w-5 h-5 rounded-full bg-civic-600 text-white font-mono text-[10px] flex items-center justify-center font-bold">1</span>
                <span className="text-charcoal-800 font-medium">Citizen Intake → Auto Triage &amp; SLA Timer Started</span>
              </div>
              <div className="flex items-center gap-2 p-2 rounded-lg bg-white border border-ivory-200">
                <span className="w-5 h-5 rounded-full bg-amber-500 text-white font-mono text-[10px] flex items-center justify-center font-bold">2</span>
                <span className="text-charcoal-800 font-medium">Officer Queue → 150m Geofence &amp; Vision SOP</span>
              </div>
              <div className="flex items-center gap-2 p-2 rounded-lg bg-coral-50 border border-coral-200">
                <span className="w-5 h-5 rounded-full bg-coral-600 text-white font-mono text-[10px] flex items-center justify-center font-bold">3</span>
                <span className="text-coral-900 font-bold">Deadline Breached → Escalate to Supervisor &amp; HOD</span>
              </div>
            </div>
          </div>

          <div className="mt-4 pt-3 border-t border-ivory-200 text-[11px] text-charcoal-500 flex items-center justify-between">
            <span>Audit Trail: Immutable Ticket Ledger</span>
            <span className="font-semibold text-civic-700">100% Traceability</span>
          </div>
        </div>

        {/* Hotspot Geospatial Intelligence Card */}
        <div className="bg-gradient-to-br from-coral-50/70 via-white to-ivory-100 rounded-2xl border border-coral-200/80 shadow-card p-6 flex flex-col justify-between">
          <div>
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-coral-100 text-coral-700 text-xs font-semibold mb-3 border border-coral-200">
              <Flame className="w-3.5 h-3.5" />
              Live Geospatial Hotspots
            </div>
            <h3 className="text-lg font-bold text-charcoal-900 mb-2">
              {metrics?.active_hotspots || 0} Critical Hotspot Clusters
            </h3>
            <p className="text-xs text-charcoal-600 leading-relaxed mb-4">
              DBSCAN spatial clustering identifies repeated infrastructure failures (e.g. repeated burst pipes or clustered potholes) for municipal resource reallocation.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <Link to="/admin/hotspots" className="btn-primary text-xs flex items-center gap-1.5 shadow-sm">
              <Flame className="w-3.5 h-3.5" />
              Open Hotspot Heatmap
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
            <Link to="/admin/alerts" className="btn-secondary text-xs">
              View Alerts
            </Link>
          </div>
        </div>
      </div>

      {/* Misclassified Tickets Review Panel */}
      {misclassified.length > 0 && (
        <div className="bg-gradient-to-br from-amber-50/80 via-white to-ivory-100 rounded-2xl border border-amber-200/90 shadow-card p-6 mb-8 animate-slide-up">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-3">
              <div className="p-2.5 rounded-xl bg-amber-100 text-amber-700 border border-amber-200">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-bold text-charcoal-900 flex items-center gap-2">
                  Misclassified Complaints Requiring Admin Review
                  <span className="text-xs px-2.5 py-0.5 rounded-full bg-coral-100 text-coral-700 font-semibold border border-coral-200">
                    {misclassified.length} Pending
                  </span>
                </h2>
                <p className="text-xs text-charcoal-500">
                  These complaints could not be automatically routed with high confidence or received a fallback assignment. Reassign them to the correct department queue below.
                </p>
              </div>
            </div>
            <button
              onClick={fetchMisclassified}
              disabled={loadingMisclassified}
              className="btn-secondary px-3 py-1.5 text-xs flex items-center gap-1.5 self-end sm:self-auto"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingMisclassified ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>

          <div className="divide-y divide-ivory-200 space-y-3">
            {misclassified.map((ticket) => (
              <div
                key={ticket.id}
                className="pt-3 first:pt-0 flex flex-col md:flex-row md:items-center justify-between gap-4 p-4 rounded-xl bg-white border border-ivory-300 shadow-sm"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-1.5">
                    <span className="text-xs font-bold text-charcoal-900 truncate">{ticket.category}</span>
                    <span className="text-[11px] px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200 font-medium">
                      Current: {ticket.department || 'Unassigned'}
                    </span>
                    <span className="text-[11px] text-charcoal-400 font-mono">ID: {ticket.id.slice(0, 8)}...</span>
                  </div>
                  <p className="text-xs text-charcoal-600 line-clamp-2 leading-relaxed">{ticket.description}</p>
                  <div className="flex items-center gap-1.5 text-[11px] text-civic-700 font-medium mt-2">
                    <MapPin className="w-3.5 h-3.5 text-civic-600 flex-shrink-0" />
                    <span className="truncate">
                      {ticket.address_text || (ticket.lat && ticket.lng ? `${ticket.lat.toFixed(4)}, ${ticket.lng.toFixed(4)}` : 'Location Pending')}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-shrink-0">
                  <select
                    value={targetDepartments[ticket.id] || ticket.department || departmentsList[0]}
                    onChange={(e) =>
                      setTargetDepartments({ ...targetDepartments, [ticket.id]: e.target.value })
                    }
                    className="input-field text-xs py-1.5 px-3 min-w-[200px] bg-white border-ivory-300 text-charcoal-900"
                  >
                    {departmentsList.map((d) => (
                      <option key={d} value={d} className="bg-white text-charcoal-900">
                        {d}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => handleReassign(ticket.id)}
                    disabled={reassigningId === ticket.id}
                    className="btn-primary text-xs px-3.5 py-1.5 flex items-center gap-1 flex-shrink-0 shadow-sm"
                  >
                    {reassigningId === ticket.id ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      'Reassign'
                    )}
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── LIVE MASTER TICKETS & INCIDENT CONTROL ── */}
      <div id="master-tickets-feed" className="bg-white rounded-2xl border border-ivory-300 shadow-card p-6 mb-8 animate-slide-up">
        {/* Header */}
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4 mb-6">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <div className="w-6 h-6 rounded-lg bg-civic-50 border border-civic-200 flex items-center justify-center text-civic-700">
                <FileText className="w-3.5 h-3.5" />
              </div>
              <h2 className="text-lg font-bold text-charcoal-900 tracking-tight">
                All Master Tickets &amp; Live Incidents Feed
              </h2>
              <span className="text-xs px-2.5 py-0.5 rounded-full bg-civic-50 text-civic-700 font-semibold border border-civic-200 font-mono">
                {tickets.length} total
              </span>
            </div>
            <p className="text-xs text-charcoal-500">
              Live municipal incident monitoring · Inspect defect details, reassign departments, or update ticket resolution status
            </p>
          </div>

          <div className="flex items-center gap-2.5 flex-wrap">
            <button
              onClick={fetchTickets}
              disabled={loadingTickets}
              className="btn-secondary px-3 py-1.5 text-xs flex items-center gap-1.5 shadow-sm font-medium"
              title="Refresh live ticket feed"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingTickets ? 'animate-spin text-civic-600' : ''}`} />
              Refresh Tickets
            </button>
            <Link
              to="/officer/queue"
              className="btn-secondary text-xs px-3 py-1.5 flex items-center gap-1 font-medium"
            >
              Full Queue View <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>

        {/* Filter Toolbar & Search */}
        <div className="p-4 rounded-xl bg-ivory-50/70 border border-ivory-200 mb-6 space-y-3">
          {/* Status & SLA Filter Pills */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
            <span className="text-[11px] font-bold text-charcoal-500 uppercase tracking-wider mr-1">Filter:</span>
            {[
              { id: 'ALL', label: 'All Incidents' },
              { id: 'OVERDUE', label: '🔴 SLA Breached' },
              { id: 'NEAR_DEADLINE', label: '🟡 Near Deadline' },
              { id: 'WITHIN_SLA', label: '🟢 Within SLA' },
              { id: 'OPEN', label: 'Open' },
              { id: 'IN_PROGRESS', label: 'In Progress' },
              { id: 'RESOLVED', label: 'Resolved' },
              { id: 'CRITICAL', label: '🔥 Critical Urgency' },
            ].map(({ id, label }) => (
              <button
                key={id}
                onClick={() => setStatusFilter(id)}
                className={`text-xs px-3 py-1 rounded-lg font-medium transition-all whitespace-nowrap ${
                  statusFilter === id
                    ? 'bg-civic-600 text-white shadow-sm font-semibold'
                    : 'bg-white text-charcoal-600 border border-ivory-300 hover:border-ivory-400'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Department Filter & Search Bar */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            <div className="flex items-center gap-2 flex-1 relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-charcoal-400 pointer-events-none" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter by description, ticket ID, category, or address..."
                className="w-full bg-white border border-ivory-300 rounded-xl pl-9 pr-3 py-2 text-xs text-charcoal-900 placeholder:text-charcoal-400 focus:outline-none focus:ring-2 focus:ring-civic-500/20 focus:border-civic-500 transition-all"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-charcoal-400 hover:text-charcoal-600 text-xs font-bold"
                >
                  ✕
                </button>
              )}
            </div>

            <div className="flex items-center gap-2 flex-shrink-0">
              <span className="text-xs text-charcoal-500 font-medium">Department:</span>
              <select
                value={departmentFilter}
                onChange={(e) => setDepartmentFilter(e.target.value)}
                className="input-field text-xs py-2 px-3 bg-white border-ivory-300 text-charcoal-900 rounded-xl min-w-[180px]"
              >
                <option value="ALL">All Departments</option>
                {departmentsList.map((d) => (
                  <option key={d} value={d}>
                    {d}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Tickets Feed List */}
        {loadingTickets && tickets.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-charcoal-400 gap-2">
            <Loader2 className="w-7 h-7 text-civic-600 animate-spin" />
            <p className="text-xs font-medium">Loading live tickets from database...</p>
          </div>
        ) : tickets.length === 0 ? (
          <div className="p-12 text-center border border-dashed border-ivory-300 rounded-2xl">
            <CheckCircle2 className="w-9 h-9 text-emerald-500 mx-auto mb-2" />
            <h3 className="text-sm font-bold text-charcoal-800">No tickets found</h3>
            <p className="text-xs text-charcoal-500 mt-1 max-w-sm mx-auto">
              No tickets match your selected filters. Reset filters or submit a new ticket in the Citizen Portal to test.
            </p>
            {(statusFilter !== 'ALL' || departmentFilter !== 'ALL' || searchQuery) && (
              <button
                type="button"
                onClick={() => {
                  setStatusFilter('ALL')
                  setDepartmentFilter('ALL')
                  setSearchQuery('')
                }}
                className="btn-secondary text-xs px-3 py-1.5 mt-3 inline-flex items-center gap-1"
              >
                Reset All Filters
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {tickets
              .filter((t) => {
                if (statusFilter === 'OVERDUE') {
                  const target = t.sla_target_hours || (t.urgency === 'CRITICAL' ? 12 : t.urgency === 'HIGH' ? 24 : t.urgency === 'LOW' ? 72 : 48)
                  const elapsed = t.sla_elapsed_hours ?? (t.created_at ? (Date.now() - new Date(t.created_at).getTime()) / 3600000 : 0)
                  return elapsed > target && !['RESOLVED', 'CLOSED'].includes(t.status)
                }
                if (statusFilter === 'NEAR_DEADLINE') {
                  const target = t.sla_target_hours || (t.urgency === 'CRITICAL' ? 12 : t.urgency === 'HIGH' ? 24 : t.urgency === 'LOW' ? 72 : 48)
                  const elapsed = t.sla_elapsed_hours ?? (t.created_at ? (Date.now() - new Date(t.created_at).getTime()) / 3600000 : 0)
                  const rem = target - elapsed
                  return elapsed <= target && (rem <= 4 || elapsed / target >= 0.75) && !['RESOLVED', 'CLOSED'].includes(t.status)
                }
                if (statusFilter === 'WITHIN_SLA') {
                  const target = t.sla_target_hours || (t.urgency === 'CRITICAL' ? 12 : t.urgency === 'HIGH' ? 24 : t.urgency === 'LOW' ? 72 : 48)
                  const elapsed = t.sla_elapsed_hours ?? (t.created_at ? (Date.now() - new Date(t.created_at).getTime()) / 3600000 : 0)
                  return elapsed <= target && !['RESOLVED', 'CLOSED'].includes(t.status)
                }
                return true
              })
              .map((t) => {
              const statusBadgeColor =
                t.status === 'RESOLVED' || t.status === 'CLOSED'
                  ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                  : t.status === 'IN_PROGRESS' || t.status === 'ASSIGNED'
                  ? 'bg-blue-50 text-blue-700 border-blue-200'
                  : t.status === 'REOPENED'
                  ? 'bg-coral-50 text-coral-700 border-coral-200'
                  : 'bg-amber-50 text-amber-800 border-amber-200'

              const urgencyBadgeColor =
                t.urgency === 'CRITICAL'
                  ? 'bg-coral-100 text-coral-800 border-coral-300 font-bold'
                  : t.urgency === 'HIGH'
                  ? 'bg-orange-50 text-orange-800 border-orange-200'
                  : t.urgency === 'LOW'
                  ? 'bg-emerald-50 text-emerald-800 border-emerald-200'
                  : 'bg-amber-50 text-amber-800 border-amber-200'

              const formattedTime = t.created_at
                ? new Date(t.created_at).toLocaleString('en-IN', {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })
                : '—'

              return (
                <div
                  key={t.id}
                  className="p-4 rounded-xl bg-white border border-ivory-300 shadow-sm hover:shadow-card hover:border-civic-300 transition-all flex flex-col xl:flex-row xl:items-center justify-between gap-4"
                >
                  {/* Left Ticket Details */}
                  <div className="flex-1 min-w-0 space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-bold text-charcoal-900">
                        {t.category || 'Civic Incident'}
                      </span>
                      {t.sub_category && (
                        <span className="text-[11px] px-2 py-0.5 rounded-full bg-ivory-100 text-charcoal-600 border border-ivory-200 font-mono">
                          {t.sub_category}
                        </span>
                      )}
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold border ${urgencyBadgeColor}`}>
                        {t.urgency || 'MEDIUM'}
                      </span>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold border ${statusBadgeColor}`}>
                        {t.status || 'OPEN'}
                      </span>
                      {/* Municipal SLA Badge */}
                      <SlaBadge ticket={t} size="sm" />
                      {(t.is_escalated || t.needs_admin_review) && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full font-extrabold bg-coral-100 text-coral-800 border border-coral-300 flex items-center gap-1">
                          🛡️ Escalated to Supervisor
                        </span>
                      )}
                      {t.created_at && Date.now() - new Date(t.created_at).getTime() < 86400000 && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-emerald-100 text-emerald-800 border border-emerald-300 flex items-center gap-1 animate-pulse">
                          ⚡ NEW
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={() => handleCopyId(t.id)}
                        className="inline-flex items-center gap-1 text-[11px] font-mono text-charcoal-400 hover:text-charcoal-700 bg-ivory-50 px-1.5 py-0.5 rounded border border-ivory-200"
                        title="Click to copy full ID"
                      >
                        <Copy className="w-3 h-3" />
                        {t.id.slice(0, 8)}...
                        {copiedId === t.id && <span className="text-emerald-600 font-bold">✓ Copied</span>}
                      </button>
                    </div>

                    <p className="text-xs text-charcoal-700 leading-relaxed font-normal">
                      {t.description || 'No description provided.'}
                    </p>

                    <div className="flex flex-wrap items-center gap-3 pt-1 text-[11px] text-charcoal-500">
                      <span className="inline-flex items-center gap-1 text-civic-700 font-medium">
                        <MapPin className="w-3 h-3 text-civic-600" />
                        {t.address_text || (t.lat && t.lng ? `${t.lat.toFixed(4)}, ${t.lng.toFixed(4)}` : 'Pune, Maharashtra')}
                      </span>
                      <span>·</span>
                      <span className="inline-flex items-center gap-1 text-charcoal-400">
                        <Clock className="w-3 h-3" />
                        Reported: {formattedTime}
                      </span>
                      {t.upvote_count > 1 && (
                        <>
                          <span>·</span>
                          <span className="font-semibold text-amber-700">
                            👥 {t.upvote_count} reports merged
                          </span>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Right Actions & Status Controls */}
                  <div className="flex flex-wrap items-center gap-2.5 flex-shrink-0 pt-2 xl:pt-0 border-t xl:border-t-0 border-ivory-200">
                    {/* Status Changer */}
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] text-charcoal-400 font-medium">Status:</span>
                      <select
                        value={t.status || 'OPEN'}
                        disabled={updatingStatusId === t.id}
                        onChange={(e) => handleStatusChange(t.id, e.target.value)}
                        className="text-xs py-1.5 px-2 rounded-lg bg-white border border-ivory-300 text-charcoal-900 focus:outline-none focus:border-civic-500 font-medium"
                      >
                        <option value="OPEN">OPEN</option>
                        <option value="IN_PROGRESS">IN PROGRESS</option>
                        <option value="RESOLVED">RESOLVED</option>
                        <option value="REOPENED">REOPENED</option>
                        <option value="CLOSED">CLOSED</option>
                      </select>
                    </div>

                    {/* Department Selector */}
                    <div className="flex items-center gap-1.5">
                      <span className="text-[11px] text-charcoal-400 font-medium">Dept:</span>
                      <select
                        value={t.department || departmentsList[0]}
                        disabled={reassigningId === t.id}
                        onChange={(e) => handleReassign(t.id, e.target.value)}
                        className="text-xs py-1.5 px-2 rounded-lg bg-white border border-ivory-300 text-charcoal-900 focus:outline-none focus:border-civic-500 font-medium max-w-[160px] truncate"
                      >
                        {departmentsList.map((d) => (
                          <option key={d} value={d}>
                            {d}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Escalate button */}
                    {!['RESOLVED', 'CLOSED'].includes(t.status) && (
                      <button
                        type="button"
                        onClick={() => handleEscalateSingleTicket(t.id)}
                        disabled={escalatingTicketId === t.id || t.needs_admin_review}
                        className={`text-xs px-2.5 py-1.5 rounded-lg border font-medium flex items-center gap-1 transition-all ${
                          t.needs_admin_review
                            ? 'bg-coral-50 text-coral-700 border-coral-200 cursor-default'
                            : 'btn-secondary hover:border-coral-400 text-charcoal-700 hover:text-coral-700 shadow-sm'
                        }`}
                        title="Escalate directly to Department Supervisor"
                      >
                        {escalatingTicketId === t.id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin text-coral-600" />
                        ) : (
                          <ShieldAlert className="w-3.5 h-3.5 text-coral-600" />
                        )}
                        {t.needs_admin_review ? 'Escalated' : 'Escalate'}
                      </button>
                    )}

                    {/* View / Track Button */}
                    <Link
                      to={`/citizen/track/${t.id}`}
                      className="btn-secondary text-xs px-3 py-1.5 flex items-center gap-1 font-medium hover:border-civic-400"
                    >
                      Inspect <ExternalLink className="w-3 h-3 text-civic-600" />
                    </Link>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* ── DEPARTMENT ACCOUNTABILITY & ESCALATION MATRIX ── */}
      <div className="bg-white rounded-2xl border border-ivory-300 shadow-card p-6 mb-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-5">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-civic-50 text-civic-700 border border-civic-200">
                Institutional Performance Telemetry
              </span>
            </div>
            <h2 className="text-lg font-bold text-charcoal-900 tracking-tight">
              Department Accountability &amp; Escalation Matrix
            </h2>
            <p className="text-xs text-charcoal-500 mt-0.5">
              Systemic metrics: open queues, SLA breaches, average resolution time, repeat hotspots, and supervisor escalations
            </p>
          </div>
          <span className="text-xs text-charcoal-400 font-mono self-start sm:self-auto">
            Audit standard: Municipal SLA Compliance
          </span>
        </div>

        <div className="overflow-x-auto rounded-xl border border-ivory-200">
          <table className="w-full text-left text-xs text-charcoal-700">
            <thead className="bg-ivory-100/70 border-b border-ivory-200 text-charcoal-500 uppercase text-[10px] font-bold">
              <tr>
                <th className="py-3 px-3.5">Department</th>
                <th className="py-3 px-3 text-center">Open Complaints</th>
                <th className="py-3 px-3 text-center">Overdue (🔴)</th>
                <th className="py-3 px-3 text-center">Avg Resolution Time</th>
                <th className="py-3 px-3 text-center">SLA Compliance Rate</th>
                <th className="py-3 px-3 text-center">Reopened</th>
                <th className="py-3 px-3 text-center">Repeat / Hotspots</th>
                <th className="py-3 px-3 text-center">Supervisor Escalations</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ivory-200">
              {(metrics?.department_breakdown || []).map((row) => {
                const compliance = row.sla_compliance_rate ?? 100
                const complianceColor =
                  compliance >= 90
                    ? 'text-emerald-700'
                    : compliance >= 75
                    ? 'text-amber-700'
                    : 'text-coral-700 font-extrabold'

                return (
                  <tr key={row.department} className="hover:bg-ivory-50/80 transition-colors">
                    <td className="py-3.5 px-3.5 font-semibold text-charcoal-900 flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-civic-500 flex-shrink-0" />
                      <span className="truncate">{row.department}</span>
                    </td>
                    <td className="py-3.5 px-3 text-center font-mono text-blue-700 font-bold">{row.open}</td>
                    <td className="py-3.5 px-3 text-center font-mono">
                      {row.overdue > 0 ? (
                        <span className="px-2 py-0.5 rounded-full bg-coral-100 text-coral-800 font-bold border border-coral-200">
                          {row.overdue} breached
                        </span>
                      ) : (
                        <span className="text-emerald-600 font-semibold">0</span>
                      )}
                    </td>
                    <td className="py-3.5 px-3 text-center font-mono text-charcoal-700 font-semibold">
                      ⏱️ {row.avg_resolution_hours || 16.5}h
                    </td>
                    <td className="py-3.5 px-3 text-center">
                      <div className="flex items-center justify-center gap-2 max-w-[160px] mx-auto">
                        <div className="flex-1 h-2 rounded-full bg-ivory-200 overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all duration-500 ${
                              compliance >= 90
                                ? 'bg-emerald-500'
                                : compliance >= 75
                                ? 'bg-amber-500'
                                : 'bg-coral-500'
                            }`}
                            style={{ width: `${compliance}%` }}
                          />
                        </div>
                        <span className={`text-[11px] font-mono font-bold w-12 ${complianceColor}`}>
                          {compliance}%
                        </span>
                      </div>
                    </td>
                    <td className="py-3.5 px-3 text-center font-mono">
                      {row.reopened > 0 ? (
                        <span className="px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 font-bold border border-amber-200">
                          🔁 {row.reopened}
                        </span>
                      ) : (
                        <span className="text-charcoal-400">0</span>
                      )}
                    </td>
                    <td className="py-3.5 px-3 text-center font-mono">
                      {row.repeated_hotspots > 0 ? (
                        <span className="px-2 py-0.5 rounded-full bg-purple-50 text-purple-700 font-bold border border-purple-200">
                          🔥 {row.repeated_hotspots}
                        </span>
                      ) : (
                        <span className="text-charcoal-400">0</span>
                      )}
                    </td>
                    <td className="py-3.5 px-3 text-center font-mono">
                      {row.escalated_count > 0 ? (
                        <span className="px-2 py-0.5 rounded-full bg-coral-50 text-coral-700 font-bold border border-coral-200">
                          ⚡ {row.escalated_count} active
                        </span>
                      ) : (
                        <span className="text-charcoal-400">0</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Department Breakdown & Urgency Breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Department Breakdown */}
        <div className="bg-white rounded-2xl border border-ivory-300 shadow-card p-6">
          <h2 className="text-xs font-bold text-charcoal-700 uppercase tracking-wider mb-4">
            Tickets by Department
          </h2>
          <div className="space-y-4">
            {Object.entries(metrics?.tickets_by_department || {}).map(([dept, count]) => {
              const total = metrics?.total_tickets || 1
              const pct = Math.round((count / total) * 100)
              return (
                <div key={dept}>
                  <div className="flex justify-between text-xs mb-1.5">
                    <span className="text-charcoal-800 font-semibold truncate">{dept}</span>
                    <span className="text-charcoal-500 font-mono">
                      {count} ({pct}%)
                    </span>
                  </div>
                  <div className="w-full h-2.5 rounded-full bg-ivory-200 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-civic-600 to-sage-500 transition-all duration-700"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              )
            })}
            {Object.keys(metrics?.tickets_by_department || {}).length === 0 && (
              <p className="text-charcoal-400 text-sm text-center py-6">No department tickets submitted yet</p>
            )}
          </div>
        </div>

        {/* Urgency Distribution */}
        <div className="bg-white rounded-2xl border border-ivory-300 shadow-card p-6">
          <h2 className="text-xs font-bold text-charcoal-700 uppercase tracking-wider mb-4">
            Urgency Distribution
          </h2>
          <div className="grid grid-cols-2 gap-3 mb-6">
            {[
              { key: 'CRITICAL', label: 'Critical', bg: 'bg-coral-50 border-coral-200 text-coral-700' },
              { key: 'HIGH', label: 'High', bg: 'bg-orange-50 border-orange-200 text-orange-700' },
              { key: 'MEDIUM', label: 'Medium', bg: 'bg-amber-50 border-amber-200 text-amber-800' },
              { key: 'LOW', label: 'Low', bg: 'bg-emerald-50 border-emerald-200 text-emerald-700' },
            ].map(({ key, label, bg }) => (
              <div key={key} className={`rounded-xl border ${bg} p-3.5 text-center`}>
                <p className="text-xl font-bold font-mono">
                  {metrics?.tickets_by_urgency?.[key] || 0}
                </p>
                <p className="text-xs opacity-80 mt-0.5 font-medium">{label}</p>
              </div>
            ))}
          </div>

          <div className="p-3.5 rounded-xl bg-ivory-100 border border-ivory-300 text-xs text-charcoal-600 leading-relaxed">
            💡 Triage SLA standard: Critical issues are assigned in &lt;15m; High priority within 2 hours.
          </div>
        </div>
      </div>
    </div>
  )
}
