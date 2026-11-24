import { useEffect, useRef } from 'react';
import { Capacitor } from '@capacitor/core';

// ---------------------------------------------------------------------------
// Android hardware/gesture Back.
//
// Without @capacitor/app, Capacitor's default Back finished the activity: a
// user mid-workout pressed Back and the whole app closed, losing the session.
// Now Back is resolved in this order:
//   1. the most recently registered overlay handler (workout, sheet, modal)
//   2. the router's fallback (previous route, then the Home tab)
//   3. on Home with nothing open: minimise (never kill) the app
// ---------------------------------------------------------------------------

type Handler = () => boolean; // return true when the Back press was consumed
const handlers: Handler[] = [];
let fallback: (() => boolean) | null = null;
let installed = false;

export const setBackFallback = (fn: () => boolean) => { fallback = fn; };

export const registerBackHandler = (fn: Handler) => {
  handlers.push(fn);
  return () => {
    const i = handlers.lastIndexOf(fn);
    if (i >= 0) handlers.splice(i, 1);
  };
};

/** Pure resolver, exported for tests. */
export const resolveBack = (): 'handler' | 'fallback' | 'minimize' => {
  for (let i = handlers.length - 1; i >= 0; i--) {
    if (handlers[i]()) return 'handler';
  }
  if (fallback && fallback()) return 'fallback';
  return 'minimize';
};

export const installBackButton = async () => {
  if (installed || !Capacitor.isNativePlatform()) return;
  installed = true;
  const { App } = await import('@capacitor/app');
  App.addListener('backButton', () => {
    if (resolveBack() === 'minimize') App.minimizeApp();
  });
};

/** Consume Back while `active` is true; `onBack` returns whether it handled it. */
export const useBackHandler = (active: boolean, onBack: () => boolean | void) => {
  const ref = useRef(onBack);
  ref.current = onBack;
  useEffect(() => {
    if (!active) return;
    return registerBackHandler(() => ref.current() !== false);
  }, [active]);
};
