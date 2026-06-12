import React from 'react';
import { LogoMark } from './Logo';

interface Props { children: React.ReactNode; }
interface State { hasError: boolean; error?: Error; }

export class ErrorBoundary extends React.Component<Props, State> {
  declare state: State;
  declare props: Props;

  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    if (typeof console !== 'undefined') {
      console.error('FitFlow error boundary:', error, info.componentStack);
    }
    import('../lib/telemetry').then(({ captureError }) => {
      captureError(error, { componentStack: info.componentStack });
    }).catch(() => {});
  }

  reset = () => {
    window.location.assign('/');
  };

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="min-h-screen bg-bg flex flex-col items-center justify-center px-6 text-center">
        <LogoMark size={56} />
        <h1 className="font-display text-3xl font-bold text-white mt-8 tracking-tight">Something broke.</h1>
        <p className="text-text-dim text-sm max-w-xs mt-3 leading-relaxed">
          We hit an unexpected error. Your data is safe. Try going back to the home screen.
        </p>
        {this.state.error?.message && (
          <pre className="text-xs text-text-mute max-w-sm mt-4 px-4 py-3 bg-surface rounded-xl border border-white/[0.06] overflow-auto">
            {this.state.error.message}
          </pre>
        )}
        <button onClick={this.reset} className="btn-3d mt-8 h-12 px-8">
          Back to home
        </button>
      </div>
    );
  }
}
