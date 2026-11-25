import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './index.css';
import './voice';
import { assetUrl, hasInline } from './assets';

if (hasInline) {
  const bg = (f: string) => `url("${assetUrl('/assets/table/' + f)}")`;
  document.documentElement.style.backgroundImage = bg(
    window.innerWidth > window.innerHeight ? 'landscape.webp' : 'portrait.webp',
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
