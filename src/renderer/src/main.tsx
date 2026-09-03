import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { Mascot } from './Mascot';
import './mascot.css';

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <Mascot />
    </StrictMode>,
  );
}
