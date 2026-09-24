import React from 'react';
import { setSessionToken } from '../../packages/candidate-db/src/index';
setSessionToken(async () => 'fixture-only');
import { createRoot } from 'react-dom/client';
import { KanbanWorkspace } from '../../packages/candidate-ui/src/KanbanWorkspace';
import '../../packages/candidate-ui/src/styles.css';
createRoot(document.getElementById('root')!).render(<main className="content"><KanbanWorkspace admin={!location.search.includes('candidate')} /></main>);
