import React from 'react';
import { ArgonStudioShell } from './components/argon/ArgonStudioShell';
import './styles/editor.css';
import './styles/studio.css';
import './styles/argon.css';
import './styles/aether-concept.css';
import './styles/rh-cinematic.css';
import './styles/rh-atelier.css';
import './styles/rh-obsidian-neon.css';
import './styles/rh-survey.css';

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
          className="flex h-screen w-screen flex-col items-center justify-center bg-[#080A0F] p-6 text-[#F8FAFC]"
        >
          <div className="max-w-lg rounded-xl border border-white/10 bg-[#0D1119] p-6 shadow-2xl">
            <h1 className="font-display text-3xl font-semibold text-amber-400">Workspace Rendering Error</h1>
            <p className="mt-2 text-sm text-slate-400">{this.state.error.message}</p>
            <div className="mt-4 flex gap-3">
              <button
                type="button"
                onClick={() => this.setState({ error: null })}
                className="rounded-lg bg-amber-500 px-3 py-2 text-sm font-semibold text-slate-950"
              >
                Retry Render
              </button>
              <button
                type="button"
                onClick={() => window.location.reload()}
                className="rounded-lg border border-white/15 px-3 py-2 text-sm font-semibold text-slate-200"
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
