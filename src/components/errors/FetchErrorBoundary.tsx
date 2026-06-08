'use client';

import React from 'react';

interface Props {
  children: React.ReactNode;
}

interface State {
  hasError: boolean;
  status?: number;
  message?: string;
}

export default class FetchErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: any): State {
    return {
      hasError: true,
      status: error?.status,
      message: error?.message,
    };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('FetchErrorBoundary caught:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div role="alert" aria-live="assertive" className="p-6 bg-red-50 text-red-700 rounded-xl border border-red-200">
          <h2 className="text-lg font-bold mb-1">Errore di caricamento dati</h2>
          {this.state.status && <p className="text-sm mb-2">Status: {this.state.status}</p>}
          <p className="text-sm">{this.state.message || 'Impossibile recuperare i dati dal server.'}</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-3 px-3 py-1.5 text-sm bg-primary-600 text-white rounded-lg"
          >
            Ricarica
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
