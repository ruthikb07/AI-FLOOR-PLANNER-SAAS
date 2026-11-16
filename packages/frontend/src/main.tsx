import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { hydrateProjectStorage } from './services/storage';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element not found');
}

/**
 * Project storage is hydrated BEFORE the first render.
 *
 * Canonical building geometry lives in IndexedDB, which is asynchronous, but
 * the editor and every workspace read projects synchronously. The durable store
 * serves those reads from an in-memory mirror, and this is where that mirror is
 * filled — so the app must not render until it resolves, or a reload would show
 * an empty project list and then replace the user's work with a fresh default.
 *
 * Hydration also migrates any project still held in `localStorage` from before
 * geometry moved to IndexedDB. It resolves even when IndexedDB is unavailable,
 * so a failure degrades the session rather than preventing startup.
 */
async function bootstrap(): Promise<void> {
  try {
    const result = await hydrateProjectStorage();
    if (result.migrated > 0) {
      console.info(`Migrated ${result.migrated} project(s) from localStorage to durable storage.`);
    }
    for (const failure of result.failed) {
      // The legacy copy is deliberately left in place when migration fails, so
      // nothing is lost; the user is told rather than silently losing a project.
      console.error(
        `Project ${failure.projectId} could not be migrated to durable storage and remains in `
        + `legacy storage: ${failure.reason}`,
      );
    }
    if (!result.durableAvailable) {
      console.error(
        'Durable project storage is unavailable, so work in this session will not survive a reload. '
        + 'Export the project to keep it.',
      );
    }
  } catch (error) {
    // Never block startup on storage. The app opens; saves then report their
    // own failure honestly instead of the whole UI failing to appear.
    console.error('Project storage could not be prepared:', error);
  }

  ReactDOM.createRoot(rootElement!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}

void bootstrap();
