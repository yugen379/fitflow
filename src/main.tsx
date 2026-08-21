import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { warmGoogleIdentity } from './lib/gsi';
import { warmDataLayer } from './lib/prefetch';

// Both are kicked off before React renders and both are mutually exclusive in
// practice: a signed-out user gets the Google sign-in widget warming, a signed-in
// user gets Firestore warming. Neither pays for the other's download, and
// neither blocks anything.
warmGoogleIdentity();
warmDataLayer();

/**
 * Retire the inline splash from index.html.
 *
 * It is removed on the frame *after* React has committed, so there is never a
 * gap where neither the splash nor the app is on screen. If anything here
 * throws, the splash is torn out anyway — a stuck overlay would be worse than
 * a missing fade.
 */
const dismissSplash = () => {
  const splash = document.getElementById('ff-splash');
  if (!splash) return;
  requestAnimationFrame(() => {
    splash.setAttribute('data-leaving', 'true');
    const remove = () => splash.remove();
    splash.addEventListener('transitionend', remove, { once: true });
    // Belt and braces: transitionend never fires under prefers-reduced-motion.
    setTimeout(remove, 400);
  });
};

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

try {
  dismissSplash();
} catch {
  document.getElementById('ff-splash')?.remove();
}
