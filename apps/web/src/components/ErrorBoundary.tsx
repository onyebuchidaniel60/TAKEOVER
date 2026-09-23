// React error boundaries. The top-level boundary keeps a render
// crash branded ("Something went wrong." + reload); the admin route group
// gets its own boundary so an admin-surface crash never takes down the
// consumer marketplace. Fallbacks show human sentences, never error objects.
import { Component, type ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
  /** Short section name used in the fallback heading. */
  section: string;
  /** Overridable for tests (defaults to a real page reload). */
  onReload?: () => void;
}

interface ErrorBoundaryState {
  crashed: boolean;
}

export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { crashed: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { crashed: true };
  }

  componentDidCatch(): void {
    // Deliberately not rendered and not shipped anywhere: crashes stay
    // client-side in the MVP (no error-monitoring service wired).
  }

  private handleReload = (): void => {
    if (this.props.onReload) {
      this.props.onReload();
      return;
    }
    window.location.reload();
  };

  render(): ReactNode {
    if (this.state.crashed) {
      return (
        <main className="mx-auto max-w-3xl px-4 py-6 sm:px-6">
          <div
            className="rounded-xl border bg-surface-2 p-6 text-center border-danger"
            role="alert"
          >
            <p className="text-h3 font-semibold text-danger">Something went wrong.</p>
            <p className="mx-auto mt-1 max-w-sm text-body text-danger">
              {this.props.section} hit a problem loading. Reload to try again — your holds
              and openings are safe.
            </p>
            <button
              type="button"
              onClick={this.handleReload}
              className="mt-4 min-h-touch rounded-lg bg-danger px-4 py-2 text-body font-medium text-accent-ink"
            >
              Reload
            </button>
          </div>
        </main>
      );
    }
    return this.props.children;
  }
}
