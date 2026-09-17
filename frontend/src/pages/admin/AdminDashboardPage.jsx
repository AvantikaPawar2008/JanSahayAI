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
        <Loader2 className="w-8 h-8 text-civic-400 animate-spin" />
      </div>
    )
  }

  const statCards = [
    {
      label: 'Total Tickets',
      value: metrics?.total_tickets || 0,
      icon: TrendingUp,
      color: 'from-civic-500/20 to-civic-600/10 border-civic-500/30',
      textColor: 'text-civic-400',
    },
    {
      label: 'Open',
      value: metrics?.open_tickets || 0,
      icon: Clock,
      color: 'from-blue-500/20 to-blue-600/10 border-blue-500/30',
      textColor: 'text-blue-400',
    },
    {
      label: 'In Progress',
      value: metrics?.in_progress_tickets || 0,
      icon: Users,
      color: 'from-amber-500/20 to-amber-600/10 border-amber-500/30',
      textColor: 'text-amber-400',
    },
    {
      label: 'Resolved',
      value: metrics?.resolved_tickets || 0,
      icon: CheckCircle2,
      color: 'from-emerald-500/20 to-emerald-600/10 border-emerald-500/30',
      textColor: 'text-emerald-400',
    },
    {
      label: 'Critical Priority',
      value: metrics?.critical_tickets || 0,
      icon: AlertTriangle,
      color: 'from-red-500/20 to-red-600/10 border-red-500/30',
      textColor: 'text-red-400',
    },
    {
      label: 'Active Hotspots',
      value: metrics?.active_hotspots || 0,
      icon: Zap,
      color: 'from-purple-500/20 to-purple-600/10 border-purple-500/30',
      textColor: 'text-purple-400',
    },
  ]

  return (
    <div className="page-enter max-w-7xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold gradient-text">Executive Dashboard</h1>
          <p className="text-white/50 text-sm mt-1">
            {metrics?.tickets_today || 0} tickets submitted today · Headline metrics & SLA compliance
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={fetchMetrics} className="btn-secondary px-3 py-2" title="Refresh metrics">
            <RefreshCw className="w-4 h-4" />
          </button>
          <button
            onClick={runHotspotDetection}
            disabled={detecting}
            className="btn-secondary text-sm flex items-center gap-1.5"
          >
            {detecting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4 text-amber-400" />}
            Detect Clusters
          </button>
          <Link to="/admin/hotspots" className="btn-primary text-sm flex items-center gap-1.5">
            <Flame className="w-4 h-4 text-red-300" />
            Open Hotspot Map
            <ArrowRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-8">
        {statCards.map(({ label, value, icon: Icon, color, textColor }) => (
          <div key={label} className={`rounded-xl border bg-gradient-to-br ${color} p-4 text-center animate-fade-in`}>
            <Icon className={`w-5 h-5 ${textColor} mx-auto mb-2 opacity-70`} />
            <p className={`text-2xl font-bold ${textColor}`}>{value}</p>
            <p className="text-xs text-white/40 mt-1">{label}</p>
          </div>
        ))}
      </div>

      {/* SLA Compliance Section + Hotspot CTA Banner */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
        {/* SLA Health Card */}
        <div className="glass-card lg:col-span-1 p-6 border-white/10">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-sm font-semibold text-white/80 uppercase tracking-wide flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-amber-400" />
              SLA Breach Compliance
            </h2>
            <span className="text-xs text-white/40">Target &lt; 5%</span>
          </div>

          <div className="flex items-baseline gap-2 mb-3">
            <span className="text-3xl font-bold text-amber-400 font-mono">
              {metrics?.sla_breach_rate ?? 0}%
            </span>
            <span className="text-xs text-white/50">Breach Rate</span>
          </div>

          <p className="text-xs text-white/50 mb-4">
            <strong>{metrics?.sla_breached_tickets ?? 0}</strong> active tickets currently exceed standard municipal resolution response SLAs.
          </p>

          <div className="w-full h-3 rounded-full bg-white/5 overflow-hidden p-0.5 border border-white/5">
            <div
              className="h-full rounded-full bg-gradient-to-r from-emerald-500 via-amber-500 to-red-500 transition-all duration-700"
              style={{ width: `${Math.min(100, Math.max(5, metrics?.sla_breach_rate || 0))}%` }}
            />
          </div>
        </div>

        {/* Hotspot Map Banner */}
        <div className="glass-card lg:col-span-2 p-6 border-red-500/20 bg-gradient-to-br from-red-500/10 via-surface-800 to-purple-900/10 flex flex-col justify-between">
          <div>
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-500/20 text-red-300 text-xs font-semibold mb-3 border border-red-500/30">
              <Flame className="w-3.5 h-3.5" />
              Live Geospatial Intelligence
            </div>
            <h3 className="text-xl font-bold text-white mb-2">
              {metrics?.active_hotspots || 0} Critical Civic Hotspots Identified
            </h3>
            <p className="text-sm text-white/60 max-w-xl">
              DBSCAN spatial clustering groups nearby complaints to isolate systemic infrastructure failures like water main bursts and pothole clusters before citizen escalations multiply.
            </p>
          </div>

          <div className="mt-6 flex items-center gap-3">
            <Link to="/admin/hotspots" className="btn-primary text-sm flex items-center gap-2">
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
        <div className="glass-card p-6 border-amber-500/30 mb-8 bg-gradient-to-br from-amber-500/10 via-surface-900 to-surface-800 animate-slide-up">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-xl bg-amber-500/20 text-amber-400 border border-amber-500/30">
                <AlertTriangle className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-bold text-white flex items-center gap-2">
                  Misclassified Complaints Requiring Admin Review
                  <span className="text-xs px-2 py-0.5 rounded-full bg-red-500/20 text-red-300 font-semibold border border-red-500/30">
                    {misclassified.length} Pending
                  </span>
                </h2>
                <p className="text-xs text-white/50">
                  These complaints could not be automatically routed with high confidence or received a fallback assignment. Reassign them to the correct department queue below.
                </p>
              </div>
            </div>
            <button
              onClick={fetchMisclassified}
              disabled={loadingMisclassified}
              className="btn-secondary px-3 py-1.5 text-xs flex items-center gap-1.5"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loadingMisclassified ? 'animate-spin' : ''}`} />
              Refresh
            </button>
          </div>

          <div className="divide-y divide-white/5 space-y-3">
            {misclassified.map((ticket) => (
              <div
                key={ticket.id}
                className="pt-3 first:pt-0 flex flex-col md:flex-row md:items-center justify-between gap-4 p-3.5 rounded-xl bg-white/5 border border-white/10"
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-bold text-white/90 truncate">{ticket.category}</span>
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/20 text-amber-300 border border-amber-500/30">
                      Current: {ticket.department || 'Unassigned'}
                    </span>
                    <span className="text-[10px] text-white/40 font-mono">ID: {ticket.id.slice(0, 8)}...</span>
                  </div>
                  <p className="text-xs text-white/60 line-clamp-2">{ticket.description}</p>
                </div>

                <div className="flex items-center gap-2 flex-shrink-0">
                  <select
                    value={targetDepartments[ticket.id] || ticket.department || departmentsList[0]}
                    onChange={(e) =>
                      setTargetDepartments({ ...targetDepartments, [ticket.id]: e.target.value })
                    }
                    className="input-field text-xs py-1.5 px-3 min-w-[200px]"
                  >
                    {departmentsList.map((d) => (
                      <option key={d} value={d} className="bg-surface-900 text-white">
                        {d}
                      </option>
                    ))}
                  </select>
                  <button
                    onClick={() => handleReassign(ticket.id)}
                    disabled={reassigningId === ticket.id}
                    className="btn-primary text-xs px-3 py-1.5 flex items-center gap-1 flex-shrink-0"
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
      <div className="glass-card p-6 border-white/10 mb-8">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-sm font-semibold text-white/80 uppercase tracking-wide">
              Department Performance & Queue Breakdown
            </h2>
            <p className="text-xs text-white/40 mt-0.5">
              Live status breakdown and resolution progress across municipal teams
            </p>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs text-white/70">
            <thead className="border-b border-white/10 text-white/40 uppercase text-[10px] font-semibold">
              <tr>
                <th className="py-2.5 px-3">Department</th>
                <th className="py-2.5 px-3 text-center">Open</th>
                <th className="py-2.5 px-3 text-center">In Progress</th>
                <th className="py-2.5 px-3 text-center">Resolved</th>
                <th className="py-2.5 px-3 text-center">Total</th>
                <th className="py-2.5 px-3">Resolution Progress</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {(metrics?.department_breakdown || []).map((row) => {
                const total = row.total || 0
                const resolvedPct = total > 0 ? Math.round((row.resolved / total) * 100) : 0
                return (
                  <tr key={row.department} className="hover:bg-white/[0.02] transition-colors">
                    <td className="py-3 px-3 font-medium text-white flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-civic-400" />
                      {row.department}
                    </td>
                    <td className="py-3 px-3 text-center font-mono text-blue-400 font-bold">{row.open}</td>
                    <td className="py-3 px-3 text-center font-mono text-amber-400 font-bold">{row.in_progress}</td>
                    <td className="py-3 px-3 text-center font-mono text-emerald-400 font-bold">{row.resolved}</td>
                    <td className="py-3 px-3 text-center font-mono text-white/90 font-bold">{total}</td>
                    <td className="py-3 px-3 w-48">
                      <div className="flex items-center gap-2">
                        <div className="flex-1 h-2 rounded-full bg-white/5 overflow-hidden">
                          <div
                            className="h-full rounded-full bg-gradient-to-r from-civic-500 to-emerald-500"
                            style={{ width: `${resolvedPct}%` }}
                          />
                        </div>
                        <span className="text-[10px] font-mono text-white/40 w-8">{resolvedPct}%</span>
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
        <div className="glass-card p-6 border-white/10">
          <h2 className="text-sm font-semibold text-white/70 uppercase tracking-wide mb-4">
            Tickets by Department
          </h2>
          <div className="space-y-4">
            {Object.entries(metrics?.tickets_by_department || {}).map(([dept, count]) => {
              const total = metrics?.total_tickets || 1
              const pct = Math.round((count / total) * 100)
              return (
                <div key={dept}>
                  <div className="flex justify-between text-xs mb-1.5">
                    <span className="text-white/80 font-medium truncate">{dept}</span>
                    <span className="text-white/40 font-mono">
                      {count} ({pct}%)
                    </span>
                  </div>
                  <div className="w-full h-2.5 rounded-full bg-white/5 overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-civic-500 to-purple-500 transition-all duration-700"
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              )
            })}
            {Object.keys(metrics?.tickets_by_department || {}).length === 0 && (
              <p className="text-white/30 text-sm text-center py-6">No department tickets submitted yet</p>
            )}
          </div>
        </div>

        {/* Urgency Distribution */}
        <div className="glass-card p-6 border-white/10">
          <h2 className="text-sm font-semibold text-white/70 uppercase tracking-wide mb-4">
            Urgency Distribution
          </h2>
          <div className="grid grid-cols-2 gap-3 mb-6">
            {[
              { key: 'CRITICAL', label: 'Critical', color: 'from-red-500/20 to-red-600/10 border-red-500/30', text: 'text-red-400' },
              { key: 'HIGH', label: 'High', color: 'from-orange-500/20 to-orange-600/10 border-orange-500/30', text: 'text-orange-400' },
              { key: 'MEDIUM', label: 'Medium', color: 'from-amber-500/20 to-amber-600/10 border-amber-500/30', text: 'text-amber-400' },
              { key: 'LOW', label: 'Low', color: 'from-emerald-500/20 to-emerald-600/10 border-emerald-500/30', text: 'text-emerald-400' },
            ].map(({ key, label, color, text }) => (
              <div key={key} className={`rounded-xl border bg-gradient-to-br ${color} p-3.5 text-center`}>
                <p className={`text-xl font-bold font-mono ${text}`}>
                  {metrics?.tickets_by_urgency?.[key] || 0}
                </p>
                <p className="text-xs text-white/50 mt-1">{label}</p>
              </div>
            ))}
          </div>

          <div className="p-3.5 rounded-xl bg-white/5 border border-white/5 text-xs text-white/40">
            💡 Triage SLA standard: Critical issues are assigned in &lt;15m; High priority within 2 hours.
          </div>
        </div>
      </div>
    </div>
  )
}
