import React from 'react';
import { ArgonStudioShell } from './components/argon/ArgonStudioShell';
import './styles/editor.css';
import './styles/studio.css';
import './styles/argon.css';

export const App: React.FC = () => {
  return (
    <ArgonStudioShell
      onBackToProjects={() => {
        localStorage.removeItem('ai_floor_planner_active_project');
        window.location.reload();
      }}
    />
  );
};

export default App;
