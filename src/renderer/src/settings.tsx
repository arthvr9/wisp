import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { SettingsPage } from './SettingsPage';
import { startTheme } from './theme';
import './settings.css';

startTheme();

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <SettingsPage />
    </StrictMode>,
  );
}
