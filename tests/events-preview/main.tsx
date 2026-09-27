import React from 'react';
import { createRoot } from 'react-dom/client';
import { EventsManager } from '../../apps/admin/src/EventsManager';
import '../../packages/candidate-ui/src/styles.css';
createRoot(document.getElementById('root')!).render(<main className="content"><EventsManager/></main>);
