import React from 'react';
import { ArgonStudioShell } from './components/argon/ArgonStudioShell';
import './styles/editor.css';
import './styles/studio.css';
import './styles/argon.css';
import './styles/aether-concept.css';

interface ErrorBoundaryState {
  error: Error | null;
}

class StudioErrorBoundary extends React.Component<{ children: React.ReactNode }, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  override componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('ARGON Studio render error:', error, info);
  }

  override render() {
    if (this.state.error) {
      return (
        <div
          role="alert"
          className="flex h-screen w-screen flex-col items-center justify-center bg-slate-950 p-6 text-slate-100"
        >
          <div className="max-w-lg rounded-xl border border-rose-500/40 bg-slate-900 p-6 shadow-xl">
            <h1 className="text-base font-bold text-rose-300">Workspace Rendering Error</h1>
            <p className="mt-2 text-xs text-slate-300">{this.state.error.message}</p>
            <div className="mt-4 flex gap-3">
              <button
                type="button"
                onClick={() => this.setState({ error: null })}
                className="rounded bg-amber-500 px-3 py-1.5 text-xs font-semibold text-slate-950 hover:bg-amber-400"
              >
                Retry Render
              </button>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="rounded bg-slate-800 px-3 py-1.5 text-xs font-semibold text-slate-200 hover:bg-slate-700"
              >
                Reload Studio
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export const App: React.FC = () => {
  return (
    <StudioErrorBoundary>
      <ArgonStudioShell
        onBackToProjects={() => {
          localStorage.removeItem('ai_floor_planner_active_project');
          window.location.reload();
        }}
      />
    </StudioErrorBoundary>
  );
};

export default App;
