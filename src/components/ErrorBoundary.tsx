import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[GitTools] React error:", error, info);
  }

  reset = () => this.setState({ error: null });

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="flex h-full w-full flex-col items-center justify-center gap-4 bg-background p-8 text-foreground">
        <h2 className="text-xl font-semibold text-destructive">Something went wrong</h2>
        <pre className="max-w-3xl overflow-auto rounded-md border border-border bg-card p-4 font-mono text-xs">
          {error.stack || error.message}
        </pre>
        <button
          onClick={this.reset}
          className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          Reset
        </button>
      </div>
    );
  }
}
