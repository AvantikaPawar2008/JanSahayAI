import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Loader2, Filter, Map as MapIcon, List, RefreshCw, Shield } from 'lucide-react'
import TicketCard from '../../components/TicketCard'
import MapView from '../../components/MapView'
import useAuth from '../../hooks/useAuth'
import { API_BASE } from '../../supabaseClient'

/**
 * OfficerQueuePage — prioritized ticket list with urgency-based sorting and map/list toggle.
 */
export default function OfficerQueuePage() {
  const navigate = useNavigate()
  const { session, profile } = useAuth()
  const [tickets, setTickets] = useState([])
  const [loading, setLoading] = useState(true)
  const [viewMode, setViewMode] = useState('list') // list | map
  const [departmentFilter, setDepartmentFilter] = useState('')
  const [urgencyFilter, setUrgencyFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [sortOrder, setSortOrder] = useState('priority_score_desc')
  const [refreshing, setRefreshing] = useState(false)

  const departments = [
    'Water Supply & Sewerage',
    'Roads & Infrastructure',
    'Solid Waste Management',
    'Electrical & Streetlighting',
    'Health & Sanitation',
  ]

  useEffect(() => {
    // Auto-select officer's department if available
    if (profile?.department && !departmentFilter) {
      setDepartmentFilter(profile.department)
    }
  }, [profile])

  const fetchQueue = async () => {
    try {
      const params = new URLSearchParams()
      if (departmentFilter) params.set('department', departmentFilter)
      if (urgencyFilter) params.set('urgency', urgencyFilter)
      if (statusFilter) params.set('status', statusFilter)
      // 2c: Always send sort parameter along with filter parameters
      params.set('sort', sortOrder)
      
      const headers = {}
      if (session?.access_token) {
        headers['Authorization'] = `Bearer ${session.access_token}`
      }

      const response = await fetch(`${API_BASE}/api/officer/queue?${params}`, { headers })
      if (!response.ok) throw new Error('Failed to load queue')
      const data = await response.json()
      setTickets(data)
    } catch (err) {
      console.error('Queue fetch error:', err)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    fetchQueue()
    // Refresh every 30 seconds
    const interval = setInterval(fetchQueue, 30000)
    return () => clearInterval(interval)
  }, [departmentFilter, urgencyFilter, statusFilter, sortOrder, session])

  const handleRefresh = () => {
    setRefreshing(true)
    fetchQueue()
  }

  const urgencyStats = {
    CRITICAL: tickets.filter((t) => t.urgency === 'CRITICAL').length,
    HIGH: tickets.filter((t) => t.urgency === 'HIGH').length,
    MEDIUM: tickets.filter((t) => t.urgency === 'MEDIUM').length,
    LOW: tickets.filter((t) => t.urgency === 'LOW').length,
  }

  return (
    <div className="page-enter max-w-6xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-6">
        <div>
          {profile?.department && (
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-xs px-2.5 py-0.5 rounded-full font-medium bg-sage-100 text-civic-800 border border-sage-200 flex items-center gap-1.5">
                <Shield className="w-3 h-3 text-civic-600" />
                {profile.department} Team
              </span>
            </div>
          )}
          <h1 className="text-3xl font-bold tracking-tight text-charcoal-900">
            {departmentFilter ? `${departmentFilter} Queue` : 'All Municipal Tickets'}
            <span className="text-xl font-normal text-charcoal-400 ml-2">({tickets.length} open)</span>
          </h1>
          <p className="text-charcoal-500 text-sm mt-1">
            {tickets.length} active {tickets.length === 1 ? 'ticket' : 'tickets'}
            {departmentFilter ? ` in ${departmentFilter}` : ' across municipal departments'}
            {sortOrder.startsWith('department') ? ' · grouped by department & sorted by priority' : ' · sorted by real-time municipal priority score'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="btn-secondary px-3 py-2 text-charcoal-700 hover:text-charcoal-900"
            title="Refresh queue"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin text-civic-600' : ''}`} />
          </button>
          <button
            onClick={() => setViewMode(viewMode === 'list' ? 'map' : 'list')}
            className="btn-secondary px-3 py-2 text-charcoal-700 hover:text-charcoal-900"
            title={viewMode === 'list' ? 'Switch to Map view' : 'Switch to List view'}
          >
            {viewMode === 'list' ? <MapIcon className="w-4 h-4 text-civic-600" /> : <List className="w-4 h-4 text-civic-600" />}
          </button>
        </div>
      </div>

      {/* Urgency Stats Cards — Clickable to filter */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        {[
          { key: 'CRITICAL', label: 'Critical', color: 'bg-coral-50/80 border-coral-200 hover:border-coral-300', activeColor: 'ring-2 ring-coral-500 border-coral-400', text: 'text-coral-600' },
          { key: 'HIGH', label: 'High', color: 'bg-orange-50/80 border-orange-200 hover:border-orange-300', activeColor: 'ring-2 ring-orange-500 border-orange-400', text: 'text-orange-600' },
          { key: 'MEDIUM', label: 'Medium', color: 'bg-amber-50/80 border-amber-200 hover:border-amber-300', activeColor: 'ring-2 ring-amber-500 border-amber-400', text: 'text-amber-600' },
          { key: 'LOW', label: 'Low', color: 'bg-civic-50/80 border-civic-200 hover:border-civic-300', activeColor: 'ring-2 ring-civic-500 border-civic-400', text: 'text-civic-600' },
        ].map(({ key, label, color, activeColor, text }) => (
          <div
            key={key}
            onClick={() => setUrgencyFilter(urgencyFilter === key ? '' : key)}
            className={`cursor-pointer rounded-xl border ${color} p-4 text-center transition-all duration-200 hover:scale-[1.01] shadow-subtle ${urgencyFilter === key ? activeColor : ''}`}
            title={`Click to filter by ${label}`}
          >
            <p className={`text-2xl font-bold ${text}`}>{urgencyStats[key]}</p>
            <p className="text-xs text-charcoal-500 mt-1 font-medium">{label}</p>
          </div>
        ))}
      </div>

      {/* Filter and Sort Controls Bar */}
      <div className="glass-card-static mb-6 space-y-3">
        {/* Department Filters */}
        <div className="flex items-center gap-2 overflow-x-auto pb-1">
          <span className="text-[11px] font-semibold text-charcoal-400 uppercase tracking-wide mr-1 flex items-center gap-1">
            <Filter className="w-3.5 h-3.5 text-charcoal-400" /> Dept:
          </span>
          <button
            onClick={() => setDepartmentFilter('')}
            className={`px-3 py-1 rounded-lg text-xs font-medium transition-all flex-shrink-0
              ${!departmentFilter ? 'bg-civic-500 text-white font-semibold shadow-sm' : 'text-charcoal-500 hover:text-charcoal-800 hover:bg-ivory-200'}`}
          >
            All Departments
          </button>
          {departments.map((dept) => {
            const isOfficerDept = profile?.department === dept
            return (
              <button
                key={dept}
                onClick={() => setDepartmentFilter(dept)}
                className={`px-3 py-1 rounded-lg text-xs font-medium transition-all flex-shrink-0 flex items-center gap-1
                  ${departmentFilter === dept
                    ? 'bg-civic-500 text-white font-semibold shadow-sm'
                    : isOfficerDept
                    ? 'text-civic-700 bg-sage-50 border border-sage-200 font-medium'
                    : 'text-charcoal-500 hover:text-charcoal-800 hover:bg-ivory-200'}`}
              >
                {isOfficerDept && <Shield className="w-2.5 h-2.5 text-civic-600" />}
                {dept.split(' ')[0]}
                {isOfficerDept && <span className="text-[10px] opacity-80">(Mine)</span>}
              </button>
            )
          })}
        </div>

        {/* Urgency & Status & Sort Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-ivory-300">
          {/* Status filter */}
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[11px] font-semibold text-charcoal-400 uppercase tracking-wide mr-1">Status:</span>
            {['', 'OPEN', 'IN_PROGRESS', 'ASSIGNED', 'REOPENED'].map((st) => (
              <button
                key={st || 'all'}
                onClick={() => setStatusFilter(st)}
                className={`px-2.5 py-0.5 rounded-md text-xs transition-all ${
                  statusFilter === st
                    ? 'bg-charcoal-800 text-white font-medium shadow-sm'
                    : 'text-charcoal-500 hover:text-charcoal-800 hover:bg-ivory-200'
                }`}
              >
                {st ? st.replace('_', ' ') : 'Active'}
              </button>
            ))}
          </div>

          {/* Sort selector with Department-aware sorting */}
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold text-charcoal-400 uppercase tracking-wide">Sort:</span>
            <select
              value={sortOrder}
              onChange={(e) => setSortOrder(e.target.value)}
              className="bg-white text-charcoal-800 border border-ivory-300 rounded-lg px-2.5 py-1 text-xs focus:outline-none focus:border-civic-500 cursor-pointer shadow-subtle"
            >
              <option value="priority_score_desc">⚡ Priority Score (Highest first, oldest tiebreaker)</option>
              <option value="department_asc">🏢 Department (A-Z) → Highest Priority</option>
              <option value="department_desc">🏢 Department (Z-A) → Highest Priority</option>
              {profile?.department && (
                <option value="my_department_first">⭐ My Department First → Highest Priority</option>
              )}
              <option value="created_at_desc">🕒 Newest first</option>
              <option value="created_at_asc">⏳ Oldest first</option>
              <option value="priority_score_asc">Lowest Priority first</option>
            </select>
          </div>
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="w-8 h-8 text-civic-500 animate-spin" />
        </div>
      ) : viewMode === 'map' ? (
        <MapView
          markers={tickets.map((t) => ({
            ...t,
            label: t.category,
          }))}
          height="500px"
          onMarkerClick={(marker) => navigate(`/officer/ticket/${marker.id}`)}
        />
      ) : (
        <div className="space-y-3">
          {tickets.map((ticket, index) => {
            const showDeptHeader =
              (sortOrder.startsWith('department') || sortOrder === 'my_department_first' || !departmentFilter) &&
              ticket.department &&
              (index === 0 || tickets[index - 1].department !== ticket.department)

            return (
              <div key={ticket.id} className="space-y-2">
                {showDeptHeader && (
                  <div className="flex items-center justify-between gap-2 pt-4 pb-1.5 px-1 border-b border-ivory-300 text-xs font-semibold text-charcoal-700 uppercase tracking-wider">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full bg-civic-500" />
                      <span className="text-charcoal-900 font-bold">{ticket.department}</span>
                    </div>
                    <span className="text-[11px] text-charcoal-400 normal-case font-normal">
                      {tickets.filter((t) => t.department === ticket.department).length} open tickets in this dept
                    </span>
                  </div>
                )}
                <TicketCard
                  ticket={ticket}
                  showPriority={true}
                  onClick={() => navigate(`/officer/ticket/${ticket.id}`)}
                />
              </div>
            )
          })}
          {tickets.length === 0 && (
            <div className="text-center py-16 text-charcoal-400">
              <p className="text-lg">🎉 No active tickets!</p>
              <p className="text-sm mt-2">The queue is empty. Great job!</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
