import { useState, useEffect } from 'react'
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
} from 'lucide-react'
import useAuth from '../../hooks/useAuth'
import { API_BASE } from '../../supabaseClient'

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

  const departmentsList = [
    'Water Supply & Sewerage',
    'Roads & Infrastructure',
    'Solid Waste Management',
    'Electrical & Streetlighting',
    'Health & Sanitation',
  ]

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

  useEffect(() => {
    fetchMetrics()
    fetchMisclassified()
    const interval = setInterval(() => {
      fetchMetrics()
      fetchMisclassified()
    }, 30000)
    return () => clearInterval(interval)
  }, [session])

  const handleReassign = async (ticketId) => {
    const chosenDept = targetDepartments[ticketId] || 'Water Supply & Sewerage'
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
      label: 'Total Tickets',
      value: metrics?.total_tickets || 0,
      icon: TrendingUp,
      badgeBg: 'bg-civic-50 text-civic-700 border-civic-200',
    },
    {
      label: 'Open',
      value: metrics?.open_tickets || 0,
      icon: Clock,
      badgeBg: 'bg-blue-50 text-blue-700 border-blue-200',
    },
    {
      label: 'In Progress',
      value: metrics?.in_progress_tickets || 0,
      icon: Users,
      badgeBg: 'bg-amber-50 text-amber-700 border-amber-200',
    },
    {
      label: 'Resolved',
      value: metrics?.resolved_tickets || 0,
      icon: CheckCircle2,
      badgeBg: 'bg-emerald-50 text-emerald-700 border-emerald-200',
    },
    {
      label: 'Critical Priority',
      value: metrics?.critical_tickets || 0,
      icon: AlertTriangle,
      badgeBg: 'bg-coral-50 text-coral-700 border-coral-200',
    },
    {
      label: 'Active Hotspots',
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
              Civic Operations
            </span>
            <span className="text-xs text-charcoal-400 font-mono">Realtime Telemetry</span>
          </div>
          <h1 className="text-3xl font-extrabold text-charcoal-900 tracking-tight">Executive Dashboard</h1>
          <p className="text-charcoal-500 text-sm mt-1">
            <strong className="text-charcoal-800 font-semibold">{metrics?.tickets_today || 0}</strong> tickets submitted today · Headline metrics & SLA compliance
          </p>
        </div>
        <div className="flex items-center gap-2.5">
          <button onClick={fetchMetrics} className="btn-secondary px-3 py-2" title="Refresh metrics">
            <RefreshCw className="w-4 h-4 text-charcoal-600" />
          </button>
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

      {/* SLA Compliance Section + Hotspot CTA Banner */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        {/* SLA Health Card */}
        <div className="bg-white rounded-2xl border border-ivory-300 shadow-card p-6 flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xs font-bold text-charcoal-700 uppercase tracking-wider flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-amber-500" />
                SLA Breach Compliance
              </h2>
              <span className="text-xs px-2 py-0.5 rounded-md bg-ivory-100 text-charcoal-500 font-medium border border-ivory-300">Target &lt; 5%</span>
            </div>

            <div className="flex items-baseline gap-2.5 mb-2">
              <span className={`text-3xl font-extrabold font-mono ${(metrics?.sla_breach_rate || 0) > 10 ? 'text-coral-600' : 'text-amber-600'}`}>
                {metrics?.sla_breach_rate ?? 0}%
              </span>
              <span className="text-xs text-charcoal-500 font-medium">Breach Rate</span>
            </div>

            <p className="text-xs text-charcoal-600 leading-relaxed mb-5">
              <strong className="text-charcoal-900 font-semibold">{metrics?.sla_breached_tickets ?? 0}</strong> active tickets currently exceed standard municipal resolution response SLAs.
            </p>
          </div>

          <div className="w-full h-3 rounded-full bg-ivory-200 overflow-hidden p-0.5 border border-ivory-300/80">
            <div
              className="h-full rounded-full bg-gradient-to-r from-emerald-500 via-amber-500 to-coral-500 transition-all duration-700"
              style={{ width: `${Math.min(100, Math.max(5, metrics?.sla_breach_rate || 0))}%` }}
            />
          </div>
        </div>

        {/* Hotspot Map Banner */}
        <div className="bg-gradient-to-br from-coral-50/70 via-white to-ivory-100 rounded-2xl border border-coral-200/80 shadow-card p-6 flex flex-col justify-between">
          <div>
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-coral-100 text-coral-700 text-xs font-semibold mb-3 border border-coral-200">
              <Flame className="w-3.5 h-3.5" />
              Live Geospatial Intelligence
            </div>
            <h3 className="text-xl font-bold text-charcoal-900 mb-2">
              {metrics?.active_hotspots || 0} Critical Civic Hotspots Identified
            </h3>
            <p className="text-sm text-charcoal-600 max-w-xl leading-relaxed">
              DBSCAN spatial clustering groups nearby complaints to isolate systemic infrastructure failures like water main bursts and pothole clusters before citizen escalations multiply.
            </p>
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Link to="/admin/hotspots" className="btn-primary text-sm flex items-center gap-2 shadow-sm">
              Explore Full Hotspot Heatmap
              <ArrowRight className="w-4 h-4" />
            </Link>
            <Link to="/admin/alerts" className="btn-secondary text-sm">
              View Hotspot Alerts
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

      {/* Per-Department Queue & Resolution Breakdown Table */}
      <div className="bg-white rounded-2xl border border-ivory-300 shadow-card p-6 mb-8">
        <div className="flex items-center justify-between mb-5">
          <div>
            <h2 className="text-xs font-bold text-charcoal-700 uppercase tracking-wider">
              Department Performance & Queue Breakdown
            </h2>
            <p className="text-xs text-charcoal-500 mt-0.5">
              Live status breakdown and resolution progress across municipal teams
            </p>
          </div>
        </div>

        <div className="overflow-x-auto rounded-xl border border-ivory-200">
          <table className="w-full text-left text-xs text-charcoal-700">
            <thead className="bg-ivory-100/70 border-b border-ivory-200 text-charcoal-500 uppercase text-[10px] font-bold">
              <tr>
                <th className="py-3 px-3.5">Department</th>
                <th className="py-3 px-3.5 text-center">Open</th>
                <th className="py-3 px-3.5 text-center">In Progress</th>
                <th className="py-3 px-3.5 text-center">Resolved</th>
                <th className="py-3 px-3.5 text-center">Total</th>
                <th className="py-3 px-3.5">Resolution Progress</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ivory-200">
              {(metrics?.department_breakdown || []).map((row) => {
                const total = row.total || 0
                const resolvedPct = total > 0 ? Math.round((row.resolved / total) * 100) : 0
                return (
                  <tr key={row.department} className="hover:bg-ivory-50/80 transition-colors">
                    <td className="py-3.5 px-3.5 font-semibold text-charcoal-900 flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-civic-500" />
                      {row.department}
                    </td>
                    <td className="py-3.5 px-3.5 text-center font-mono text-blue-700 font-bold">{row.open}</td>
                    <td className="py-3.5 px-3.5 text-center font-mono text-amber-700 font-bold">{row.in_progress}</td>
                    <td className="py-3.5 px-3.5 text-center font-mono text-emerald-700 font-bold">{row.resolved}</td>
                    <td className="py-3.5 px-3.5 text-center font-mono text-charcoal-900 font-bold">{total}</td>
                    <td className="py-3.5 px-3.5 w-48">
                      <div className="flex items-center gap-2.5">
                        <div className="flex-1 h-2 rounded-full bg-ivory-200 overflow-hidden">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-civic-600 to-sage-500"
                            style={{ width: `${resolvedPct}%` }}
                          />
                        </div>
                        <span className="text-[11px] font-mono text-charcoal-500 w-8">{resolvedPct}%</span>
                      </div>
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
