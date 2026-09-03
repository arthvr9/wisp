import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { Panel } from './PanelPage';
import { startTheme } from './theme';
import './panel.css';

startTheme();

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <Panel />
    </StrictMode>,
  );
}
