/**
 * Keeps the five bottom-nav tabs alive, the way a native tab bar does.
 *
 * Before: every tab switch DESTROYED the page you left and rebuilt the one you
 * tapped from nothing — re-render, re-subscribe every Firestore listener, show
 * "Loading your day…" again, create fresh WebGL contexts and recompile their
 * shaders. Measured on a 4x-throttled CPU, a tab tap reached its content in
 * 300–900 ms, and Home in ~3 s, even though the tap itself registered in ~100 ms.
 *
 * Now each visited tab stays mounted inside React's <Activity>. Switching back
 * is a visibility flip of an already-built screen. While hidden, a tab keeps
 * its DOM and state (scroll, half-typed coach message, last-known numbers), and
 * React pauses its effects — Firestore listeners and animation loops detach and
 * re-attach on return, so hidden tabs cost nothing.
 *
 * Tabs are mounted on first visit (or when prefetch warms them), never all up
 * front, so first launch does no extra work.
 */
import React, { Activity, Suspense, createContext, useContext, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { ErrorBoundary } from '../ErrorBoundary';
import { LiquidSkeleton } from './SpatialPageTransition';

// Why <Activity> and not `content-visibility: hidden` (which keeps a hidden
// subtree's style and layout): measured A/B, two runs each, 4x CPU — Activity
// median 311 ms per tab switch, content-visibility 1289 ms. Keeping hidden tabs
// LIVE meant their listeners and animations competed with the tab being opened.
// Pausing hidden tabs is what makes switching fast.

/** False inside a hidden tab — lets continuous work (WebGL loops) pause. */
const TabVisibleContext = createContext(true);
export const useTabVisible = () => useContext(TabVisibleContext);

/**
 * Use as the `key` of every three.js <Canvas> inside a tab.
 *
 * When <Activity> hides a tab, react-three-fiber's cleanup FORCE-LOSES the
 * WebGL context, but <Activity> keeps the very same <canvas> element. On
 * reveal, fiber re-attached to that dead canvas and drew nothing — on Android
 * the WebView painted its "context lost" icon where the macro spheres belong
 * (found on an Android 16 emulator, v1.6.3 review). The generation advances
 * when a tab is HIDDEN, so the replacement canvas is prepared while hidden and
 * the scene starts exactly once, on a fresh context, when the tab returns.
 */
const CanvasGenerationContext = createContext(0);
export const useCanvasKey = () => useContext(CanvasGenerationContext);

export interface DockTab {
  path: string;
  Page: React.ComponentType;
}

export const DockTabs: React.FC<{ tabs: DockTab[]; pathname: string }> = ({ tabs, pathname }) => {
  const isTab = tabs.some((t) => t.path === pathname);
  const [visited, setVisited] = useState<string[]>(() => (isTab ? [pathname] : []));
  // Derived-state update during render (React's documented pattern): the new
  // tab mounts in the same commit as the navigation, with no extra frame.
  if (isTab && !visited.includes(pathname)) setVisited((v) => (v.includes(pathname) ? v : [...v, pathname]));
  const visitedRef = useRef(visited);
  visitedRef.current = visited;

  // Pre-build the tabs not yet visited, hidden, in idle time — one per idle
  // slot so a real tap is never queued behind them. A hidden <Activity> renders
  // at the lowest priority and runs NO effects, so this builds the screen only:
  // no Firestore listeners, no WebGL, no timers until the tab is first shown.
  // That turns even the FIRST tap on a tab into a reveal instead of a build.
  useLayoutEffect(() => {
    const ric: (cb: () => void) => number =
      (window as any).requestIdleCallback
        ? (cb) => (window as any).requestIdleCallback(cb, { timeout: 4000 })
        : (cb) => window.setTimeout(cb, 1200);
    const cancel: (id: number) => void =
      (window as any).cancelIdleCallback ? (id) => (window as any).cancelIdleCallback(id) : window.clearTimeout;
    let id = 0;
    let stopped = false;
    const next = () => {
      if (stopped) return;
      const missing = tabs.find((t) => !visitedRef.current.includes(t.path));
      if (!missing) return;
      setVisited((v) => (v.includes(missing.path) ? v : [...v, missing.path]));
      visitedRef.current = [...visitedRef.current, missing.path];
      id = ric(next);
    };
    // Let the first screen finish (data, animations) before starting.
    const start = window.setTimeout(() => { id = ric(next); }, 1500);
    return () => { stopped = true; window.clearTimeout(start); cancel(id); };
  }, [tabs]);

  // Each tab remembers its own scroll position; every other page opens at the top.
  const scrollByPath = useRef(new Map<string, number>());
  const current = useRef(pathname);
  useLayoutEffect(() => {
    const onScroll = () => { scrollByPath.current.set(current.current, window.scrollY); };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);
  useLayoutEffect(() => {
    current.current = pathname;
    window.scrollTo(0, isTab ? scrollByPath.current.get(pathname) ?? 0 : 0);
  }, [pathname, isTab]);

  // Each page element is created ONCE. A fresh <Page /> per render made React
  // re-render every kept-alive page on every tab switch; a stable element lets
  // it skip the whole subtree unless the page's own state or context changed.
  const pages = useMemo(() => new Map(tabs.map(({ path, Page }) => [path, (
    <ErrorBoundary>
      <Suspense fallback={<LiquidSkeleton />}>
        <Page />
      </Suspense>
    </ErrorBoundary>
  )])), [tabs]);

  return (
    <>
      {tabs.filter((t) => visited.includes(t.path)).map(({ path }) => {
        return (
          <Activity key={path} mode={path === pathname ? 'visible' : 'hidden'}>
            <TabPane active={path === pathname}>{pages.get(path)}</TabPane>
          </Activity>
        );
      })}
    </>
  );
};

/**
 * A short opacity fade when a tab is revealed. Opacity only: a transform here
 * would make this element the containing block for every `position: fixed`
 * sheet inside the page (see SpatialPageTransition), and it runs on the
 * compositor, so it costs the main thread nothing.
 */
const TabPane: React.FC<{ active: boolean; children: React.ReactNode }> = ({ active, children }) => {
  const ref = useRef<HTMLElement>(null);
  const [generation, setGeneration] = useState(0);
  const [wasActive, setWasActive] = useState(active);
  if (wasActive !== active) {
    setWasActive(active);
    if (!active) setGeneration((g) => g + 1);
  }
  useLayoutEffect(() => {
    if (active) ref.current?.animate?.([{ opacity: 0.4 }, { opacity: 1 }], { duration: 140, easing: 'ease-out' });
  }, [active]);
  return (
    <TabVisibleContext.Provider value={active}>
      <CanvasGenerationContext.Provider value={generation}>
        <main ref={ref} className="relative">{children}</main>
      </CanvasGenerationContext.Provider>
    </TabVisibleContext.Provider>
  );
};
