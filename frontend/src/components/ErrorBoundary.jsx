import React from 'react'
import { AlertTriangle, RefreshCw, Home } from 'lucide-react'

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, errorInfo) {
    console.error('JanSahayAI Caught runtime error:', error, errorInfo)
  }

  handleReset = () => {
    this.setState({ hasError: false, error: null })
    if (this.props.onReset) {
      this.props.onReset()
    } else {
      window.location.reload()
    }
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback(this.state.error, this.handleReset)
      }

      return (
        <div className="min-h-[50vh] flex items-center justify-center p-6">
          <div className="bg-white rounded-3xl border border-ivory-300 shadow-card p-8 max-w-md w-full text-center space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-amber-50 border border-amber-200 text-amber-600 flex items-center justify-center mx-auto">
              <AlertTriangle className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-charcoal-900">Something went wrong</h2>
              <p className="text-xs text-charcoal-500 mt-1">
                {this.state.error?.message || 'A visual component encountered an issue.'}
              </p>
            </div>
            <div className="flex gap-2 justify-center pt-2">
              <button
                type="button"
                onClick={this.handleReset}
                className="btn-primary text-xs py-2 px-4 flex items-center gap-1.5"
              >
                <RefreshCw className="w-3.5 h-3.5" /> Reload View
              </button>
              <button
                type="button"
                onClick={() => { window.location.href = '/' }}
                className="btn-secondary text-xs py-2 px-4 flex items-center gap-1.5"
              >
                <Home className="w-3.5 h-3.5" /> Go Home
              </button>
            </div>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}
