import { Component, type ErrorInfo, type PropsWithChildren, type ReactNode } from "react";

interface ErrorBoundaryState {
  error: Error | null;
}

export class ErrorBoundary extends Component<PropsWithChildren, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("UAV Ground Control Station UI crashed", error, info);
  }

  render(): ReactNode {
    if (!this.state.error) {
      return this.props.children;
    }

    return (
      <div className="flex h-screen items-center justify-center bg-slate-950 p-6 text-slate-100">
        <div className="max-w-2xl rounded-xl border border-red-400/30 bg-red-950/40 p-5 shadow-glow">
          <div className="text-xs font-semibold uppercase tracking-[0.22em] text-red-200">UI Error</div>
          <h1 className="mt-2 text-xl font-semibold">UAV Ground Control Station hit a rendering error.</h1>
          <p className="mt-2 text-sm text-slate-300">
            The app stayed open so the error can be inspected. Restart the app after rebuilding with the latest fix.
          </p>
          <pre className="mt-4 max-h-56 overflow-auto rounded-lg bg-black/40 p-3 text-xs text-red-100">
            {this.state.error.message}
          </pre>
        </div>
      </div>
    );
  }
}
