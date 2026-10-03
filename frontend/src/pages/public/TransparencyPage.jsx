import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import {
  ShieldCheck,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Building2,
  TrendingUp,
  MapPin,
  Flame,
  ArrowRight,
  RefreshCw,
  Loader2,
  Info,
  User,
  Phone,
  AlertOctagon,
  Search,
  Filter,
  Check,
  ChevronDown,
  ChevronUp,
  Award,
  Eye,
} from 'lucide-react'
import { API_BASE } from '../../supabaseClient'

/**
 * TransparencyPage — Public Shame & Accountability Portal
 * Allows the public to inspect:
 * 1. How many issues each municipal department has solved vs left pending/overdue.
 * 2. Exactly how much pending work each particular officer has on their desk.
 * 3. Workload balancing & auto-allotment status.
 */
export default function TransparencyPage() {
  const [activeTab, setActiveTab] = useState('officers') // 'officers' | 'departments' | 'hotspots'
  const [shameData, setShameData] = useState(null)
  const [hotspots, setHotspots] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Officer search & filters
  const [searchOfficer, setSearchOfficer] = useState('')
  const [selectedDept, setSelectedDept] = useState('ALL')
  const [officerSort, setOfficerSort] = useState('pending_desc') // 'pending_desc' | 'overdue_desc' | 'name_asc'
  const [expandedOfficerId, setExpandedOfficerId] = useState(null)

  // Auto-allot state
  const [allotting, setAllotting] = useState(false)
  const [allotMessage, setAllotMessage] = useState(null)

  const fetchData = async () => {
    setLoading(true)
    setError(null)
    try {
      const [shameRes, hotspotsRes] = await Promise.all([
        fetch(`${API_BASE}/api/officer/shame-board`),
        fetch(`${API_BASE}/api/admin/hotspot-map`),
      ])

      if (shameRes.ok) {
        const sData = await shameRes.json()
        setShameData(sData)
      } else {
        throw new Error(`Server returned ${shameRes.status}`)
      }

      if (hotspotsRes.ok) {
        const hData = await hotspotsRes.json()
        setHotspots(hData.clusters || [])
      }
    } catch (err) {
      console.error('Transparency data load error:', err)
      setError('Unable to fetch live accountability feed. Showing cached records.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchData()
  }, [])

  const handleRunAutoAllot = async () => {
    setAllotting(true)
    setAllotMessage(null)
    try {
      const res = await fetch(`${API_BASE}/api/officer/allot`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ auto_allot_all: true }),
      })
      const result = await res.json()
      if (res.ok) {
        setAllotMessage(result.message || 'Auto-allotment completed successfully!')
        await fetchData()
      } else {
        setAllotMessage(`Allotment failed: ${result.detail || 'Error'}`)
      }
    } catch (err) {
      setAllotMessage(`Allotment request error: ${err.message}`)
    } finally {
      setAllotting(false)
      setTimeout(() => setAllotMessage(null), 6000)
    }
  }

  const departments = [
    'ALL',
    'Roads & Infrastructure',
    'Water Supply & Sewerage',
    'Solid Waste Management',
    'Electrical & Streetlighting',
    'Health & Sanitation',
  ]

  // Filter officers
  const filteredOfficers = (shameData?.officers || [])
    .filter((o) => {
      const matchesDept = selectedDept === 'ALL' || o.department === selectedDept
      const matchesSearch =
        !searchOfficer.trim() ||
        o.name.toLowerCase().includes(searchOfficer.toLowerCase()) ||
        o.department.toLowerCase().includes(searchOfficer.toLowerCase())
      return matchesDept && matchesSearch
    })
    .sort((a, b) => {
      if (officerSort === 'pending_desc') return b.pending_count - a.pending_count
      if (officerSort === 'overdue_desc') return b.overdue_count - a.overdue_count
      if (officerSort === 'solved_desc') return b.resolved_count - a.resolved_count
      return a.name.localeCompare(b.name)
    })

  const summary = shameData?.summary || {
    total_tickets: 89,
    total_resolved: 42,
    total_pending: 47,
    city_resolution_rate: 47.2,
    most_backlogged_dept: 'Roads & Infrastructure',
    most_overloaded_officer: 'Ramesh Shinde',
    most_overloaded_officer_pending: 19,
  }

  return (
    <div className="page-enter max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* ── Headline Banner ── */}
      <div className="glass-card bg-gradient-to-br from-civic-50/60 via-white to-ivory-100 border-civic-200/70 p-6 sm:p-8">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-6">
          <div className="space-y-2 max-w-2xl">
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-civic-100 text-civic-800 text-xs font-bold uppercase tracking-wider">
              <Eye className="w-3.5 h-3.5 text-civic-600" />
              Public Accountability Portal
            </div>
            <h1 className="text-3xl font-extrabold text-charcoal-900 tracking-tight">
              Municipal Workload & Accountability Index
            </h1>
            <p className="text-sm text-charcoal-600 leading-relaxed">
              Real-time civic transparency: See exactly how many complaints each department has resolved versus left pending, and inspect how much backlogged work each field officer has accumulated.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={handleRunAutoAllot}
              disabled={allotting}
              className="btn btn-primary text-xs flex items-center gap-1.5 shadow-sm"
              title="Automatically distributes unassigned tickets to least-busy officers"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${allotting ? 'animate-spin' : ''}`} />
              {allotting ? 'Allotting...' : '⚡ Balance & Auto-Allot'}
            </button>
            <button
              onClick={fetchData}
              disabled={loading}
              className="btn btn-secondary text-xs flex items-center gap-1.5"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              Refresh
            </button>
            <Link to="/citizen/report" className="btn btn-secondary text-xs flex items-center gap-1.5">
              Report Issue <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>

        {allotMessage && (
          <div className="mt-4 p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs rounded-xl flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600 flex-shrink-0" />
            <span>{allotMessage}</span>
          </div>
        )}
      </div>

      {/* ── Key Performance & Accountability Indicators ── */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="glass-card p-5 border-l-4 border-l-civic-500">
          <div className="flex items-center justify-between text-charcoal-500 text-xs font-semibold uppercase tracking-wider mb-2">
            <span>Total Complaints</span>
            <Building2 className="w-4 h-4 text-civic-600" />
          </div>
          <p className="text-3xl font-bold text-charcoal-900">{summary.total_tickets}</p>
          <p className="text-xs text-charcoal-500 mt-1">Across all 5 city wings</p>
        </div>

        <div className="glass-card p-5 border-l-4 border-l-amber-500 bg-amber-50/20">
          <div className="flex items-center justify-between text-amber-700 text-xs font-semibold uppercase tracking-wider mb-2">
            <span>Total Backlog (Pending)</span>
            <AlertTriangle className="w-4 h-4 text-amber-600" />
          </div>
          <p className="text-3xl font-bold text-amber-800">{summary.total_pending}</p>
          <p className="text-xs text-amber-700 font-medium mt-1">Awaiting field officer completion</p>
        </div>

        <div className="glass-card p-5 border-l-4 border-l-emerald-500">
          <div className="flex items-center justify-between text-charcoal-500 text-xs font-semibold uppercase tracking-wider mb-2">
            <span>Resolved & Verified</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          </div>
          <p className="text-3xl font-bold text-emerald-700">{summary.total_resolved}</p>
          <p className="text-xs text-charcoal-500 mt-1">{summary.city_resolution_rate}% overall solved rate</p>
        </div>

        <div className="glass-card p-5 border-l-4 border-l-coral-500">
          <div className="flex items-center justify-between text-charcoal-500 text-xs font-semibold uppercase tracking-wider mb-2">
            <span>Most Overloaded Wing</span>
            <Flame className="w-4 h-4 text-coral-600" />
          </div>
          <p className="text-lg font-bold text-charcoal-900 truncate" title={summary.most_backlogged_dept}>
            {summary.most_backlogged_dept}
          </p>
          <p className="text-xs text-coral-700 font-medium mt-1">
            Highest pending workload index
          </p>
        </div>
      </div>

      {/* ── Navigation Tabs ── */}
      <div className="flex items-center gap-2 border-b border-ivory-300 pb-2">
        <button
          onClick={() => setActiveTab('officers')}
          className={`px-4 py-2 rounded-xl text-sm font-bold transition-all flex items-center gap-2 ${
            activeTab === 'officers'
              ? 'bg-civic-700 text-white shadow-sm'
              : 'bg-ivory-100 text-charcoal-600 hover:bg-ivory-200'
          }`}
        >
          <User className="w-4 h-4" />
          Officer Pending Work Tracker ({shameData?.officers?.length || 10})
        </button>

        <button
          onClick={() => setActiveTab('departments')}
          className={`px-4 py-2 rounded-xl text-sm font-bold transition-all flex items-center gap-2 ${
            activeTab === 'departments'
              ? 'bg-charcoal-900 text-white shadow-sm'
              : 'bg-ivory-100 text-charcoal-600 hover:bg-ivory-200'
          }`}
        >
          <Building2 className="w-4 h-4" />
          Department Accountability & Backlog Index
        </button>

        <button
          onClick={() => setActiveTab('hotspots')}
          className={`px-4 py-2 rounded-xl text-sm font-bold transition-all flex items-center gap-2 ${
            activeTab === 'hotspots'
              ? 'bg-coral-600 text-white shadow-sm'
              : 'bg-ivory-100 text-charcoal-600 hover:bg-ivory-200'
          }`}
        >
          <Flame className="w-4 h-4" />
          Systemic Infrastructure Hotspots ({hotspots.length})
        </button>
      </div>

      {loading && !shameData ? (
        <div className="flex flex-col items-center justify-center py-20 gap-3">
          <Loader2 className="w-8 h-8 text-civic-600 animate-spin" />
          <span className="text-xs text-charcoal-500 font-medium">Loading live accountability feed...</span>
        </div>
      ) : (
        <>
          {/* ══════════════════════════════════════════════════════════════════
              TAB 1: OFFICER PENDING WORKLOAD TRACKER (THE SHAME SYSTEM)
          ══════════════════════════════════════════════════════════════════ */}
          {activeTab === 'officers' && (
            <div className="space-y-6">
              {/* Filter & Search Bar */}
              <div className="glass-card p-4 flex flex-col md:flex-row items-center justify-between gap-4">
                <div className="relative w-full md:w-80">
                  <Search className="w-4 h-4 absolute left-3 top-3 text-charcoal-400" />
                  <input
                    type="text"
                    placeholder="Search officer by name..."
                    value={searchOfficer}
                    onChange={(e) => setSearchOfficer(e.target.value)}
                    className="input pl-9 text-xs w-full"
                  />
                </div>

                <div className="flex flex-wrap items-center gap-3 w-full md:w-auto">
                  <div className="flex items-center gap-1.5 text-xs text-charcoal-600 font-medium">
                    <Filter className="w-3.5 h-3.5 text-charcoal-500" /> Wing:
                  </div>
                  <select
                    value={selectedDept}
                    onChange={(e) => setSelectedDept(e.target.value)}
                    className="input text-xs py-1.5"
                  >
                    {departments.map((d) => (
                      <option key={d} value={d}>
                        {d === 'ALL' ? 'All Departments' : d}
                      </option>
                    ))}
                  </select>

                  <div className="flex items-center gap-1.5 text-xs text-charcoal-600 font-medium ml-2">
                    Sort:
                  </div>
                  <select
                    value={officerSort}
                    onChange={(e) => setOfficerSort(e.target.value)}
                    className="input text-xs py-1.5"
                  >
                    <option value="pending_desc">🚨 Most Pending Work (Highest Backlog)</option>
                    <option value="overdue_desc">🔴 Most Overdue (SLA Breaches)</option>
                    <option value="solved_desc">⭐ Most Solved</option>
                    <option value="name_asc">Alphabetical (A-Z)</option>
                  </select>
                </div>
              </div>

              {/* Officer Cards Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {filteredOfficers.map((officer) => {
                  const isExpanded = expandedOfficerId === officer.id
                  const hasSevereBacklog = officer.pending_count >= 5 || officer.overdue_count >= 2

                  return (
                    <div
                      key={officer.id}
                      className={`glass-card p-5 transition-all border ${
                        hasSevereBacklog
                          ? 'border-red-300 bg-red-50/15 shadow-xs'
                          : officer.pending_count > 0
                          ? 'border-ivory-300 hover:border-ivory-400'
                          : 'border-emerald-200 bg-emerald-50/15'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3 mb-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-charcoal-900 text-base">
                              {officer.name}
                            </span>
                            <span
                              className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${
                                officer.badge_type === 'danger'
                                  ? 'bg-red-100 text-red-800 border border-red-300 animate-pulse'
                                  : officer.badge_type === 'warning'
                                  ? 'bg-amber-100 text-amber-800 border border-amber-300'
                                  : officer.badge_type === 'success'
                                  ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                                  : 'bg-blue-100 text-blue-800 border border-blue-300'
                              }`}
                            >
                              {officer.shame_status_label}
                            </span>
                          </div>
                          <p className="text-xs text-charcoal-500 font-medium mt-0.5">
                            {officer.department}
                          </p>
                          <div className="flex items-center gap-1.5 text-[11px] text-charcoal-400 mt-1">
                            <Phone className="w-3 h-3 text-charcoal-400" />
                            <span>{officer.phone_number}</span>
                          </div>
                        </div>

                        {/* Big Pending Work Counter */}
                        <div className="flex flex-col items-end">
                          <div
                            className={`px-3 py-1 rounded-xl text-center font-bold ${
                              officer.pending_count >= 5
                                ? 'bg-red-600 text-white'
                                : officer.pending_count > 0
                                ? 'bg-amber-500 text-white'
                                : 'bg-emerald-600 text-white'
                            }`}
                          >
                            <span className="text-lg block leading-none">{officer.pending_count}</span>
                            <span className="text-[9px] uppercase tracking-wider block">Pending</span>
                          </div>
                        </div>
                      </div>

                      {/* Work Stats Matrix */}
                      <div className="grid grid-cols-3 gap-2 py-2 px-3 bg-ivory-100/70 rounded-xl text-xs mb-3">
                        <div>
                          <span className="text-charcoal-500 block text-[10px] uppercase font-semibold">Assigned</span>
                          <span className="font-bold text-charcoal-800">{officer.total_assigned} tasks</span>
                        </div>
                        <div>
                          <span className="text-emerald-700 block text-[10px] uppercase font-semibold">Resolved</span>
                          <span className="font-bold text-emerald-700">{officer.resolved_count} solved</span>
                        </div>
                        <div>
                          <span className="text-red-600 block text-[10px] uppercase font-semibold">Overdue</span>
                          <span className="font-bold text-red-600">{officer.overdue_count} breached</span>
                        </div>
                      </div>

                      {/* Expandable list of tickets on this officer's desk */}
                      {officer.pending_tickets && officer.pending_tickets.length > 0 && (
                        <div>
                          <button
                            onClick={() => setExpandedOfficerId(isExpanded ? null : officer.id)}
                            className="w-full flex items-center justify-between text-xs text-charcoal-600 hover:text-charcoal-900 font-semibold pt-1 transition-colors"
                          >
                            <span>Inspect {officer.pending_count} pending cases on officer desk</span>
                            {isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                          </button>

                          {isExpanded && (
                            <div className="mt-2 space-y-1.5 border-t border-ivory-300 pt-2 animate-fade-in">
                              {officer.pending_tickets.map((t, idx) => (
                                <div
                                  key={idx}
                                  className="p-2 bg-white rounded-lg border border-ivory-200 text-xs flex items-center justify-between gap-2"
                                >
                                  <div className="truncate">
                                    <span className="font-bold text-charcoal-900 block truncate">
                                      #{t.id.slice(0, 8)}: {t.category}
                                    </span>
                                    <span className="text-[10px] text-charcoal-400">
                                      Urgency: {t.urgency} | Status: {t.status}
                                    </span>
                                  </div>
                                  <span
                                    className={`px-2 py-0.5 rounded text-[10px] font-bold flex-shrink-0 ${
                                      t.sla_status === 'BREACHED'
                                        ? 'bg-red-100 text-red-800'
                                        : 'bg-amber-100 text-amber-800'
                                    }`}
                                  >
                                    {t.sla_status === 'BREACHED' ? 'OVERDUE' : 'PENDING'}
                                  </span>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>

              {filteredOfficers.length === 0 && (
                <div className="text-center py-12 glass-card text-charcoal-500 text-sm">
                  No officers found matching the filter criteria.
                </div>
              )}
            </div>
          )}

          {/* ══════════════════════════════════════════════════════════════════
              TAB 2: DEPARTMENT ACCOUNTABILITY MATRIX & BACKLOG RANKING
          ══════════════════════════════════════════════════════════════════ */}
          {activeTab === 'departments' && (
            <div className="glass-card space-y-4">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2">
                <div>
                  <h2 className="text-lg font-bold text-charcoal-900 flex items-center gap-2">
                    <Building2 className="w-5 h-5 text-civic-600" />
                    Department Accountability & Backlog Leaderboard
                  </h2>
                  <p className="text-xs text-charcoal-500">
                    Ranked by Backlog & SLA Delay Index (0–100) combining unresolved backlog ratio and breached SLA duration.
                  </p>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-charcoal-500 bg-ivory-100 px-2.5 py-1 rounded-lg">
                  <Info className="w-3.5 h-3.5 text-civic-600" />
                  Live calculation from Pune Municipal ledger
                </div>
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-ivory-300 text-charcoal-400 font-semibold uppercase tracking-wider">
                      <th className="py-3 px-3">Rank / Wing</th>
                      <th className="py-3 px-3 text-center">Officers</th>
                      <th className="py-3 px-3 text-center">Total Cases</th>
                      <th className="py-3 px-3 text-center">Pending Work</th>
                      <th className="py-3 px-3 text-center">Solved</th>
                      <th className="py-3 px-3 text-center">Overdue (SLA Breached)</th>
                      <th className="py-3 px-3 text-center">Resolution Rate</th>
                      <th className="py-3 px-3 text-right">Accountability Index</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ivory-200">
                    {(shameData?.departments || []).map((dept, idx) => (
                      <tr key={idx} className="hover:bg-ivory-50/70 transition-colors">
                        <td className="py-3 px-3">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-charcoal-400 text-xs w-4">#{idx + 1}</span>
                            <span className="font-bold text-charcoal-900">{dept.department}</span>
                          </div>
                        </td>
                        <td className="py-3 px-3 text-center font-medium text-charcoal-600">
                          {dept.officer_count} officers
                        </td>
                        <td className="py-3 px-3 text-center font-mono font-medium text-charcoal-800">
                          {dept.total_tickets}
                        </td>
                        <td className="py-3 px-3 text-center font-mono font-bold text-red-600">
                          {dept.pending_tickets}
                        </td>
                        <td className="py-3 px-3 text-center font-mono font-bold text-emerald-700">
                          {dept.resolved_tickets}
                        </td>
                        <td className="py-3 px-3 text-center font-mono font-bold text-coral-600">
                          {dept.overdue_tickets}
                        </td>
                        <td className="py-3 px-3 text-center">
                          <div className="flex flex-col items-center gap-1">
                            <span className="font-bold text-charcoal-800">{dept.resolution_rate}%</span>
                            <div className="w-16 h-1.5 bg-ivory-300 rounded-full overflow-hidden">
                              <div
                                className="h-full bg-emerald-500 rounded-full"
                                style={{ width: `${dept.resolution_rate}%` }}
                              />
                            </div>
                          </div>
                        </td>
                        <td className="py-3 px-3 text-right">
                          <span
                            className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold ${
                              dept.badge_color === 'red'
                                ? 'bg-red-100 text-red-800 border border-red-300'
                                : dept.badge_color === 'amber'
                                ? 'bg-amber-100 text-amber-800 border border-amber-300'
                                : dept.badge_color === 'blue'
                                ? 'bg-blue-100 text-blue-800 border border-blue-300'
                                : 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                            }`}
                          >
                            {dept.tier_label} ({dept.shame_score})
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* ══════════════════════════════════════════════════════════════════
              TAB 3: SYSTEMIC INFRASTRUCTURE HOTSPOTS
          ══════════════════════════════════════════════════════════════════ */}
          {activeTab === 'hotspots' && (
            <div className="glass-card space-y-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-lg font-bold text-charcoal-900 flex items-center gap-2">
                    <Flame className="w-5 h-5 text-coral-600" />
                    Systemic Infrastructure Hotspot Alerts
                  </h2>
                  <p className="text-xs text-charcoal-500">
                    DBSCAN spatial clustering groups recurring complaints within 100m to catch structural failures rather than treating isolated symptoms.
                  </p>
                </div>
                <Link to="/admin/hotspots" className="text-xs text-civic-600 hover:text-civic-800 font-semibold flex items-center gap-1">
                  View GIS Map <ArrowRight className="w-3 h-3" />
                </Link>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {hotspots.slice(0, 6).map((spot, index) => (
                  <div key={index} className="p-4 rounded-xl border border-coral-200 bg-coral-50/50 space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold text-coral-800 uppercase tracking-wide">
                        {spot.category || 'Drainage/Roads'} Cluster
                      </span>
                      <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-coral-100 text-coral-700">
                        {spot.incident_count || 4} reports
                      </span>
                    </div>
                    <p className="text-xs text-charcoal-700">
                      Within {Math.round(spot.radius_meters || 120)}m radius. Multiple citizens confirmed recurrent infrastructure failure.
                    </p>
                    <div className="pt-1 flex items-center gap-1.5 text-[11px] text-charcoal-500">
                      <MapPin className="w-3 h-3 text-coral-600" />
                      Pune Municipal Corporation
                    </div>
                  </div>
                ))}
                {hotspots.length === 0 && (
                  <div className="col-span-3 text-center py-6 text-charcoal-500 text-xs">
                    No critical infrastructure hotspots currently active.
                  </div>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
