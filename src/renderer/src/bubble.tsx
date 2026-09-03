import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';

import type { BubbleMessage } from '../../shared/ipc';
import './bubble.css';

function Bubble() {
  const [message, setMessage] = useState<BubbleMessage | null>(null);

  useEffect(() => window.wisp.onBubble(setMessage), []);

  if (!message) return null;
  return (
    <div className="bubble">
      <p>{message.text}</p>
      <span className="tail" />
    </div>
  );
}

const root = document.getElementById('root');
if (root) {
  createRoot(root).render(
    <StrictMode>
      <Bubble />
    </StrictMode>,
  );
}
