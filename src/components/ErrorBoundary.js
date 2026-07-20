import React from 'react';

export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo });
    console.error('[SPECTRE] ErrorBoundary caught:', error, errorInfo);
  }

  handleReload = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
    window.location.reload();
  };

  handleDismiss = () => {
    this.setState({ hasError: false, error: null, errorInfo: null });
  };

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 99999,
          background: '#070b10', color: '#e2e8f0',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: "'JetBrains Mono', monospace"
        }}>
          <div style={{
            maxWidth: '500px', padding: '32px',
            background: '#0f172a', border: '1px solid #ef4444',
            borderRadius: '6px', textAlign: 'center'
          }}>
            <div style={{ fontSize: '32px', marginBottom: '12px', color: '#ef4444' }}>!</div>
            <div style={{ fontSize: '14px', fontWeight: 600, letterSpacing: '1px', marginBottom: '12px' }}>
              SPECTRE C2 ENCOUNTERED AN ERROR
            </div>
            <div style={{
              fontSize: '11px', color: '#64748b', marginBottom: '16px',
              maxHeight: '120px', overflow: 'auto', textAlign: 'left',
              background: '#0a0f14', padding: '8px', borderRadius: '3px'
            }}>
              {this.state.error?.message || 'Unknown error'}
            </div>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
              <button onClick={this.handleReload} style={{
                padding: '6px 16px', background: '#22c55e', color: '#000',
                border: 'none', borderRadius: '3px', cursor: 'pointer',
                fontFamily: 'inherit', fontSize: '11px', fontWeight: 600
              }}>RELOAD APP</button>
              <button onClick={this.handleDismiss} style={{
                padding: '6px 16px', background: 'transparent', color: '#64748b',
                border: '1px solid #334155', borderRadius: '3px', cursor: 'pointer',
                fontFamily: 'inherit', fontSize: '11px'
              }}>DISMISS</button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
