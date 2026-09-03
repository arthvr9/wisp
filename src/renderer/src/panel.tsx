import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { Panel } from './Panel';
import './panel.css';

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <Panel />
    </StrictMode>,
  );
}
