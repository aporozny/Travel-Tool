import React from 'react';

// Catches a rendering error anywhere below it and shows a recovery screen
// instead of a blank page. Before this existed, one bad value in any screen
// (for example the Safety screen reading coordinates the server never sent)
// blanked the entire app, including the SOS button.

interface State { failed: boolean }

export default class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { failed: false };

  static getDerivedStateFromError(): State {
    return { failed: true };
  }

  componentDidCatch(error: unknown, info: unknown) {
    console.error('Screen crashed:', error, info);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8f7f4', padding: 24, fontFamily: 'Arial, sans-serif' }}>
        <div style={{ maxWidth: 420, background: '#fff', borderRadius: 16, padding: 32, textAlign: 'center', border: '1px solid #F0EDE8' }}>
          <div style={{ color: '#C9A84C', fontSize: 22, fontWeight: 700, marginBottom: 12 }}>&#9672; Drift</div>
          <h2 style={{ margin: '0 0 8px', color: '#1A1A1A' }}>Something went wrong</h2>
          <p style={{ color: '#9B9590', fontSize: 14, lineHeight: 1.5, margin: '0 0 20px' }}>
            This screen hit a problem. Your account and bookings are safe. Reload to carry on.
            If you are in an emergency, contact your local emergency services directly.
          </p>
          <button onClick={() => window.location.reload()} style={{ background: '#C9A84C', color: '#fff', border: 0, borderRadius: 8, padding: '12px 24px', fontSize: 15, fontWeight: 600, cursor: 'pointer' }}>
            Reload
          </button>
        </div>
      </div>
    );
  }
}
