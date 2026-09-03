import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { Mascot } from './Mascot';
import { startTheme } from './theme';
import './mascot.css';

startTheme();

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <Mascot />
    </StrictMode>,
  );
}
