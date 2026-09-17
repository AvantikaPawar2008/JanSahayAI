import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import {
  FileText,
  Clock,
  CheckCircle2,
  AlertCircle,
  Users,
  ChevronRight,
  PlusCircle,
  Loader2,
  MapPin,
  RefreshCw,
  Sparkles,
} from 'lucide-react'
import useAuth from '../../hooks/useAuth'
import { supabase } from '../../supabaseClient'
import UrgencyBadge from '../../components/UrgencyBadge'

export default function TicketHistoryPage() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [reports, setReports] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState(null)

  const fetchMyReports = async () => {
    if (!user) return
    setError(null)

    try {
      // Query ticket_reports joined to master_tickets
      // RLS ensures only this citizen's reports & linked master_tickets are returned
      const { data, error: fetchErr } = await supabase
        .from('ticket_reports')
        .select(`
          id,
          master_ticket_id,
          raw_text,
          transcript,
          image_url,
          location_source,
          created_at,
          master_tickets (
            id,
            category,
            sub_category,
            department,
            urgency,
            status,
            upvote_count,
            description,
            created_at,
            lat,
            lng
          )
        `)
        .order('created_at', { ascending: false })

      if (fetchErr) throw fetchErr

      // Group reports by master_ticket_id to prevent duplicate cards for the same ticket
      const ticketMap = new Map()
      for (const rep of data || []) {
        const mtId = rep.master_ticket_id
        if (!ticketMap.has(mtId)) {
          ticketMap.set(mtId, {
            ...rep,
            master_ticket: rep.master_tickets,
            all_reports: [rep],
          })
        } else {
          ticketMap.get(mtId).all_reports.push(rep)
        }
      }

      setReports(Array.from(ticketMap.values()))
    } catch (err) {
      console.error('Error fetching ticket history:', err)
      setError('Unable to load your reported issues. Please try again.')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    fetchMyReports()
  }, [user])

  const handleRefresh = () => {
    setRefreshing(true)
    fetchMyReports()
  }

  const getStatusColor = (status) => {
    switch (status) {
      case 'RESOLVED':
      case 'CLOSED':
        return 'bg-emerald-50 text-emerald-700 border-emerald-200'
      case 'RESOLVED_PENDING_CITIZEN':
        return 'bg-civic-50 text-civic-800 border-civic-300'
      case 'IN_PROGRESS':
        return 'bg-blue-50 text-blue-700 border-blue-200'
      case 'ASSIGNED':
        return 'bg-purple-50 text-purple-700 border-purple-200'
      case 'REOPENED':
        return 'bg-coral-50 text-coral-700 border-coral-200'
      default:
        return 'bg-amber-50 text-amber-800 border-amber-200'
    }
  }

  const formatStatus = (status) => {
    switch (status) {
      case 'RESOLVED_PENDING_CITIZEN':
        return 'Resolved — Please Verify'
      case 'IN_PROGRESS':
        return 'In Progress'
      case 'REOPENED':
        return 'Reopened'
      default:
        return status || 'OPEN'
    }
  }

  return (
    <div className="page-enter max-w-4xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-8">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-civic-50 text-civic-700 border border-civic-200">
              Citizen Dashboard
            </span>
            <span className="text-xs text-charcoal-400 font-mono">My Activity</span>
          </div>
          <h1 className="text-3xl font-extrabold text-charcoal-900 tracking-tight">My Reported Issues</h1>
          <p className="text-charcoal-500 text-sm mt-1">
            Track real-time status updates and resolution progress for complaints you have submitted
          </p>
        </div>

        <div className="flex items-center gap-3 w-full sm:w-auto">
          <button
            onClick={handleRefresh}
            disabled={refreshing || loading}
            className="btn-secondary px-3 py-2 flex items-center justify-center text-charcoal-600 shadow-sm"
            title="Refresh list"
          >
            <RefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} />
          </button>
          <Link
            to="/citizen/report"
            className="btn-primary flex-1 sm:flex-initial flex items-center justify-center gap-2 text-sm px-4 py-2 shadow-sm font-semibold"
          >
            <PlusCircle className="w-4 h-4 text-white" /> Report New Issue
          </Link>
        </div>
      </div>

      {/* Loading state */}
      {loading ? (
        <div className="min-h-[40vh] flex flex-col items-center justify-center gap-3 text-charcoal-400">
          <Loader2 className="w-8 h-8 text-civic-600 animate-spin" />
          <p className="text-sm font-medium">Loading your reported tickets...</p>
        </div>
      ) : error ? (
        <div className="bg-white rounded-2xl border border-coral-200 shadow-card p-6 text-center space-y-3">
          <AlertCircle className="w-8 h-8 text-coral-600 mx-auto" />
          <p className="text-coral-700 text-sm font-medium">{error}</p>
          <button onClick={handleRefresh} className="btn-secondary text-xs px-4 py-2">
            Retry
          </button>
        </div>
      ) : reports.length === 0 ? (
        /* Empty State */
        <div className="bg-white rounded-2xl border border-ivory-300 shadow-card p-12 text-center space-y-4 animate-slide-up">
          <div className="w-16 h-16 rounded-2xl bg-civic-50 border border-civic-200 flex items-center justify-center mx-auto text-civic-700">
            <FileText className="w-8 h-8" />
          </div>
          <div>
            <h3 className="text-lg font-bold text-charcoal-900">No Reported Issues Yet</h3>
            <p className="text-charcoal-500 text-sm max-w-md mx-auto mt-1 leading-relaxed">
              You haven't filed any complaints yet. Spot a pothole, leaking pipe, or broken streetlight? Help improve your city by reporting it.
            </p>
          </div>
          <Link
            to="/citizen/report"
            className="btn-primary inline-flex items-center gap-2 text-sm px-6 py-2.5 mt-2 shadow-sm"
          >
            <PlusCircle className="w-4 h-4 text-white" /> Report an Issue Now
          </Link>
        </div>
      ) : (
        /* Report Cards List */
        <div className="space-y-4 animate-slide-up">
          <div className="flex items-center justify-between text-xs text-charcoal-400 px-1 font-medium">
            <span>Showing {reports.length} {reports.length === 1 ? 'issue' : 'issues'}</span>
            <span>Click any ticket to view live tracking &amp; proof</span>
          </div>

          {reports.map((item) => {
            const mt = item.master_ticket || {}
            const upvotes = mt.upvote_count || 1
            const otherReports = upvotes - 1

            return (
              <div
                key={item.id}
                onClick={() => navigate(`/citizen/track/${item.master_ticket_id}`)}
                className="bg-white rounded-2xl border border-ivory-300 shadow-card hover:shadow-card-hover hover:border-civic-300 transition-all cursor-pointer group p-5"
              >
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`text-xs px-2.5 py-0.5 rounded-full font-semibold border ${getStatusColor(mt.status)}`}>
                      {formatStatus(mt.status)}
                    </span>
                    {mt.urgency && <UrgencyBadge urgency={mt.urgency} size="sm" />}
                    {mt.department && (
                      <span className="text-xs px-2.5 py-0.5 rounded-md bg-ivory-100 text-charcoal-700 border border-ivory-300 font-medium">
                        {mt.department}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5 text-xs text-charcoal-400 font-medium">
                    <Clock className="w-3.5 h-3.5" />
                    <span>
                      {new Date(item.created_at).toLocaleDateString('en-IN', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric',
                      })}
                    </span>
                  </div>
                </div>

                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 space-y-1.5">
                    <h3 className="text-base font-bold text-charcoal-900 group-hover:text-civic-700 transition-colors flex items-center gap-2">
                      {mt.category || 'Civic Grievance'}
                      {mt.sub_category && (
                        <span className="text-xs font-normal text-charcoal-400 font-mono">
                          ({mt.sub_category})
                        </span>
                      )}
                    </h3>

                    <p className="text-sm text-charcoal-600 line-clamp-2 leading-relaxed">
                      {item.raw_text || item.transcript || mt.description || 'No description provided.'}
                    </p>

                    <div className="flex flex-wrap items-center gap-4 pt-2 text-xs text-charcoal-500">
                      {/* Upvote / duplicate count badge */}
                      {otherReports > 0 && (
                        <span className="inline-flex items-center gap-1.5 text-civic-800 font-semibold bg-civic-50 px-2 py-0.5 rounded-md border border-civic-200">
                          <Users className="w-3.5 h-3.5 text-civic-600" />
                          {otherReports} other {otherReports === 1 ? 'citizen' : 'citizens'} also reported this
                        </span>
                      )}

                      {/* Location source */}
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="w-3.5 h-3.5 text-civic-600" />
                        {item.location_source === 'manual' ? 'Pin placed on map' : 'Live GPS'}
                      </span>

                      {/* Photo thumbnail indicator */}
                      {item.image_url && (
                        <span className="inline-flex items-center gap-1 text-emerald-700 font-medium">
                          <Sparkles className="w-3.5 h-3.5" /> Photo Attached
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Thumbnail / Arrow */}
                  <div className="flex items-center gap-3">
                    {item.image_url && (
                      <img
                        src={item.image_url}
                        alt="Evidence"
                        className="w-14 h-14 rounded-xl object-cover border border-ivory-300 flex-shrink-0 shadow-sm"
                      />
                    )}
                    <ChevronRight className="w-5 h-5 text-charcoal-400 group-hover:text-civic-600 group-hover:translate-x-0.5 transition-all flex-shrink-0" />
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
