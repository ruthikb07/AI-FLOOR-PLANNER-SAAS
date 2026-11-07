import React, { useState } from 'react';
import { StudioShell } from './components/studio/StudioShell';
import { ProjectDashboard } from './components/projects/ProjectDashboard';
import { NewApartmentWizard } from './components/wizard/NewApartmentWizard';
import { projectStorage } from './services/storage';
import type { MultiSheetApartmentResult } from '@ai-floor-planner/planning-engine';
import './styles/editor.css';
import './styles/studio.css';

export const App: React.FC = () => {
  // Task 1: Set initial application route/step on fresh load to Step 1: Create New Project & Requirements Intake (Wizard)
  // never auto-jump into 2D CAD Studio with fallback until user creates a project and clicks Generate.
  const [showWizard, setShowWizard] = useState<boolean>(() => {
    return !localStorage.getItem('ai_floor_planner_active_project');
  });

  const [activeProjectId, setActiveProjectId] = useState<string | null>(() => {
    return localStorage.getItem('ai_floor_planner_active_project');
  });

  const [initialApartmentResult, setInitialApartmentResult] = useState<MultiSheetApartmentResult | null>(null);

  if (showWizard) {
    return (
      <NewApartmentWizard
        onProjectCreated={(result, projectTitle, _config) => {
          const newProjectId = `proj-${Date.now()}`;
          const now = new Date().toISOString();
          try {
            projectStorage.save({
              schemaVersion: 1,
              projectId: newProjectId,
              name: projectTitle,
              createdAt: now,
              updatedAt: now,
              building: result.building,
            });
          } catch (e) {
            console.warn('Failed to save to projectStorage:', e);
          }
          localStorage.setItem('ai_floor_planner_active_project', newProjectId);
          setInitialApartmentResult(result);
          setActiveProjectId(newProjectId);
          setShowWizard(false);
        }}
        onCancel={() => {
          const stored = localStorage.getItem('ai_floor_planner_active_project');
          if (stored) {
            setShowWizard(false);
          }
        }}
      />
    );
  }

  if (!activeProjectId) {
    return (
      <ProjectDashboard
        onOpenProject={(id) => {
          localStorage.setItem('ai_floor_planner_active_project', id);
          setActiveProjectId(id);
          setShowWizard(false);
        }}
      />
    );
  }

  return (
    <StudioShell
      key={activeProjectId}
      initialApartmentResult={initialApartmentResult}
      onOpenNewProjectWizard={() => setShowWizard(true)}
      onBackToProjects={() => {
        localStorage.removeItem('ai_floor_planner_active_project');
        setActiveProjectId(null);
        setShowWizard(true);
      }}
    />
  );
};

export default App;
