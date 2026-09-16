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
  const [refreshing, setRefreshing] = useState(false)

  const departments = [
    'Water Supply & Sewerage',
    'Roads & Infrastructure',
    'Solid Waste Management',
    'Electrical & Streetlighting',
    'Health & Sanitation',
  ]

  const fetchQueue = async () => {
    try {
      const params = new URLSearchParams()
      if (departmentFilter) params.set('department', departmentFilter)
      
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
  }, [departmentFilter, session])

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
              <span className="text-xs px-2.5 py-0.5 rounded-full font-medium bg-amber-500/15 text-amber-300 border border-amber-500/30 flex items-center gap-1.5">
                <Shield className="w-3 h-3 text-amber-400" />
                {profile.department} Team
              </span>
            </div>
          )}
          <h1 className="text-3xl font-bold gradient-text">
            {profile?.department ? `${profile.department} — Queue` : 'Officer Queue'}
          </h1>
          <p className="text-white/50 text-sm mt-1">
            {tickets.length} active {tickets.length === 1 ? 'ticket' : 'tickets'} sorted by real-time municipal priority score
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleRefresh}
            disabled={refreshing}
            className="btn-secondary px-3 py-2"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={() => setViewMode(viewMode === 'list' ? 'map' : 'list')}
            className="btn-secondary px-3 py-2"
          >
            {viewMode === 'list' ? <MapIcon className="w-4 h-4" /> : <List className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Urgency Stats */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        {[
          { key: 'CRITICAL', label: 'Critical', color: 'from-red-500/20 to-red-600/10 border-red-500/30', text: 'text-red-400' },
          { key: 'HIGH', label: 'High', color: 'from-orange-500/20 to-orange-600/10 border-orange-500/30', text: 'text-orange-400' },
          { key: 'MEDIUM', label: 'Medium', color: 'from-amber-500/20 to-amber-600/10 border-amber-500/30', text: 'text-amber-400' },
          { key: 'LOW', label: 'Low', color: 'from-emerald-500/20 to-emerald-600/10 border-emerald-500/30', text: 'text-emerald-400' },
        ].map(({ key, label, color, text }) => (
          <div key={key} className={`rounded-xl border bg-gradient-to-br ${color} p-4 text-center`}>
            <p className={`text-2xl font-bold ${text}`}>{urgencyStats[key]}</p>
            <p className="text-xs text-white/40 mt-1">{label}</p>
          </div>
        ))}
      </div>

      {/* Department Filter */}
      <div className="glass-card-static mb-6">
        <div className="flex items-center gap-3 overflow-x-auto pb-1">
          <Filter className="w-4 h-4 text-white/40 flex-shrink-0" />
          <button
            onClick={() => setDepartmentFilter('')}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex-shrink-0
              ${!departmentFilter ? 'bg-civic-600/30 text-civic-300 border border-civic-500/30' : 'text-white/40 hover:text-white/60'}`}
          >
            All
          </button>
          {departments.map((dept) => (
            <button
              key={dept}
              onClick={() => setDepartmentFilter(dept)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all flex-shrink-0
                ${departmentFilter === dept ? 'bg-civic-600/30 text-civic-300 border border-civic-500/30' : 'text-white/40 hover:text-white/60'}`}
            >
              {dept.split(' ')[0]}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex justify-center py-16">
          <Loader2 className="w-8 h-8 text-civic-400 animate-spin" />
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
          {tickets.map((ticket) => (
            <TicketCard
              key={ticket.id}
              ticket={ticket}
              showPriority={true}
              onClick={() => navigate(`/officer/ticket/${ticket.id}`)}
            />
          ))}
          {tickets.length === 0 && (
            <div className="text-center py-16 text-white/30">
              <p className="text-lg">🎉 No active tickets!</p>
              <p className="text-sm mt-2">The queue is empty. Great job!</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
