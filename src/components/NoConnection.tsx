import { Component, useEffect, type ReactNode } from 'react'

// Shown instead of a blank screen when a page can't open: no internet and that page was never saved on this device
// (its code can't be fetched). It retries by itself the moment the connection comes back.
function NoConnectionPage({ offline, onRetry }: { offline: boolean; onRetry: () => void }) {
  useEffect(() => {
    window.addEventListener('online', onRetry)
    return () => window.removeEventListener('online', onRetry)
  }, [onRetry])
  return (
    <div className="centre-page">
      <div className="card narrow no-conn">
        <div className="no-conn-icon" aria-hidden="true">📡</div>
        <h1>{offline ? 'No connection' : "This page couldn't load"}</h1>
        <p>
          {offline
            ? "You're offline and this page hasn't been saved on this device yet. Pages you've opened before still work without a signal. This one will open as soon as you're back online."
            : 'Something stopped this page loading, most likely a weak or dropped connection. Try again in a moment.'}
        </p>
        <div className="no-conn-actions">
          <button className="primary" onClick={onRetry}>Try again</button>
          <a className="button" href="/">Go to home</a>
        </div>
        <p className="muted small">{offline ? 'Waiting for the connection…' : ''}</p>
      </div>
    </div>
  )
}

export default class ConnectionBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(e: unknown) {
    console.error(e)
  }
  retry = () => this.setState({ failed: false })
  render() {
    if (!this.state.failed) return this.props.children
    return <NoConnectionPage offline={!navigator.onLine} onRetry={this.retry} />
  }
}
