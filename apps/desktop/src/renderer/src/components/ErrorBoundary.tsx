import React from "react";
import { AlertCircle, RefreshCcw } from "lucide-react";

export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error };
  }

  componentDidCatch(error: Error): void {
    console.error(error);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <main className="error-boundary">
        <div>
          <AlertCircle size={28} />
          <h1>Studio view failed</h1>
          <p>{this.state.error.message}</p>
          <button className="button primary" onClick={() => window.location.reload()}>
            <RefreshCcw size={16} />
            Reload
          </button>
        </div>
      </main>
    );
  }
}
