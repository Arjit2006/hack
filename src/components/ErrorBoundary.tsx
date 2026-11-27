import React from 'react';
import { AlertTriangle, RotateCcw } from 'lucide-react';

interface State {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, message: error.message || 'An unexpected error occurred.' };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('EcoIntelligence ErrorBoundary caught:', error, info);
  }

  render() {
    if (this.state.hasError) {
      let friendlyMsg = this.state.message;
      try {
        const parsed = JSON.parse(this.state.message) as { error?: string; path?: string };
        if (parsed.error) {
          friendlyMsg = `Database access error on "${parsed.path || 'resource'}": ${parsed.error}`;
        }
      } catch {
        // Plain error string
      }

      return (
        <div className="min-h-screen bg-[#F6F8F7] flex items-center justify-center p-6">
          <div className="max-w-lg w-full bg-white border border-slate-200 rounded-xl p-6 space-y-4">
            <div className="flex items-center gap-3 text-red-700">
              <AlertTriangle className="w-6 h-6 shrink-0" aria-hidden="true" />
              <h2 className="text-lg font-semibold text-slate-900">Application Recovery Notice</h2>
            </div>
            <p className="text-sm text-slate-600 leading-relaxed break-words">{friendlyMsg}</p>
            <button
              type="button"
              onClick={() => {
                this.setState({ hasError: false, message: '' });
                window.location.reload();
              }}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-[#14532D] text-white rounded-lg hover:bg-[#166534] transition-colors"
            >
              <RotateCcw className="w-4 h-4" aria-hidden="true" />
              Reload Application
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
