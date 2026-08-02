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
          background: '#07090f', color: '#e6e8ec',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontFamily: "'JetBrains Mono', monospace"
        }}>
          <div style={{
            maxWidth: '500px', padding: '32px',
            background: '#10141d', border: '1px solid #f2545b',
            borderRadius: '6px', textAlign: 'center'
          }}>
            <div style={{ fontSize: '32px', marginBottom: '12px', color: '#f2545b' }}>!</div>
            <div style={{ fontSize: '14px', fontWeight: 600, letterSpacing: '1px', marginBottom: '12px' }}>
              SPECTRE C2 ENCOUNTERED AN ERROR
            </div>
            <div style={{
              fontSize: '11px', color: '#5a6270', marginBottom: '16px',
              maxHeight: '120px', overflow: 'auto', textAlign: 'left',
              background: '#0b0e15', padding: '8px', borderRadius: '3px'
            }}>
              {this.state.error?.message || 'Unknown error'}
            </div>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
              <button onClick={this.handleReload} style={{
                padding: '6px 16px', background: '#3dd68c', color: '#000',
                border: 'none', borderRadius: '3px', cursor: 'pointer',
                fontFamily: 'inherit', fontSize: '11px', fontWeight: 600
              }}>RELOAD APP</button>
              <button onClick={this.handleDismiss} style={{
                padding: '6px 16px', background: 'transparent', color: '#5a6270',
                border: '1px solid #2a3342', borderRadius: '3px', cursor: 'pointer',
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
