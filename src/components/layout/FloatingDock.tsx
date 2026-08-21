/**
 * Floating spatial navigation dock.
 *
 * A frosted glass bar that hovers above the content rather than sitting on the
 * edge of the screen, with an active pill that slides between tabs using a
 * shared `layoutId` — so the indicator physically travels rather than fading
 * out and in somewhere else. That continuity is the whole point: it tells you
 * where you came from.
 *
 * Carried over from the previous dock because they were right:
 *   • swipe down to dismiss, swipe up (or tap the tab) to bring it back;
 *   • route chunks prefetch the moment a finger lands on a tab, so the
 *     navigation itself resolves from cache.
 *
 * Accessibility: every item is a real link with a visible label, the active one
 * carries `aria-current`, and every target clears 44px.
 */

import React, { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { AnimatePresence, motion } from 'motion/react';
import type { PanInfo } from 'motion/react';
import { ChefHat, ChevronUp, Dumbbell, Home, Play, Trophy, User, Utensils } from 'lucide-react';

import { cn } from '../../lib/utils';
import { haptic } from '../../lib/haptics';
import { prefetchPathHandlers } from '../../lib/prefetch';
import { SPRING } from '../../lib/motion';
import { spawnRipple } from '../ui/WaterRipple';

const navItems = [
  { id: 'home', label: 'Home', icon: Home, path: '/' },
  { id: 'library', label: 'Library', icon: Play, path: '/library' },
  { id: 'track', label: 'Track', icon: Utensils, path: '/track' },
  { id: 'workout', label: 'Train', icon: Dumbbell, path: '/workout' },
  { id: 'kitchen', label: 'Meals', icon: ChefHat, path: '/meal-plan' },
  { id: 'arena', label: 'Compete', icon: Trophy, path: '/challenges' },
  { id: 'profile', label: 'You', icon: User, path: '/profile' },
];

export const FloatingDock: React.FC = () => {
  const [hidden, setHidden] = useState(false);

  const handleDragEnd = (_event: unknown, info: PanInfo) => {
    if (info.offset.y > 28 || info.velocity.y > 400) {
      void haptic('medium');
      setHidden(true);
    } else if (info.offset.y < -28 || info.velocity.y < -400) {
      void haptic('medium');
      setHidden(false);
    }
  };

  return (
    <>
      <AnimatePresence>
        {!hidden && (
          <motion.div
            key="dock"
            initial={{ y: 120, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 140, opacity: 0 }}
            transition={SPRING.fluid}
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0.05, bottom: 0.6 }}
            onDragEnd={handleDragEnd}
            className="fixed bottom-4 left-1/2 -translate-x-1/2 w-[94%] max-w-md z-[60] safe-area-bottom touch-pan-x"
          >
            {/* Grab handle — communicates the swipe affordance. */}
            <div className="flex justify-center pb-1.5 cursor-grab active:cursor-grabbing select-none">
              <div className="w-10 h-1 rounded-full bg-white/15" />
            </div>

            <nav
              id="bottom-nav"
              aria-label="Primary"
              className="glass-spatial h-[4.25rem] px-2 flex justify-between items-center gap-0.5"
              style={{ borderRadius: '1.5rem' }}
            >
              {navItems.map((item) => {
                // Both the ripple and the prefetcher want onPointerDown, and a
                // spread would silently win over an inline handler declared
                // above it. Compose explicitly so a tap does both.
                const prefetch = prefetchPathHandlers(item.path);
                return (
                <NavLink
                  key={item.id}
                  to={item.path}
                  end={item.path === '/'}
                  onPointerEnter={prefetch.onPointerEnter}
                  onFocus={prefetch.onFocus}
                  onPointerDown={(event) => {
                    void haptic('selection');
                    spawnRipple(event.currentTarget, event.clientX, event.clientY, 'lime');
                    prefetch.onPointerDown();
                  }}
                  className="flex-1 min-w-0 relative overflow-hidden rounded-2xl isolate"
                >
                  {({ isActive }) => (
                    <div className="relative flex flex-col items-center justify-center py-2 min-h-[3.25rem]">
                      {isActive && (
                        <motion.div
                          layoutId="dock-pill"
                          transition={SPRING.snap}
                          className="absolute inset-x-0.5 inset-y-0 rounded-2xl"
                          style={{
                            background: 'rgba(204,255,0,0.11)',
                            border: '1px solid rgba(204,255,0,0.28)',
                            boxShadow: '0 0 22px -6px rgba(204,255,0,0.55), inset 0 1px 0 rgba(255,255,255,0.1)',
                          }}
                        />
                      )}
                      <div
                        className={cn(
                          'relative flex flex-col items-center justify-center gap-1 transition-colors duration-200',
                          isActive ? 'text-accent' : 'text-text-dim',
                        )}
                      >
                        <item.icon size={19} strokeWidth={isActive ? 2.4 : 1.9} aria-hidden="true" />
                        <span className="text-[9.5px] font-semibold tracking-tight leading-none">{item.label}</span>
                      </div>
                    </div>
                  )}
                </NavLink>
                );
              })}
            </nav>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Pull-tab, so a dismissed dock is always recoverable. */}
      <AnimatePresence>
        {hidden && (
          <motion.button
            key="dock-tab"
            type="button"
            initial={{ y: 60, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 60, opacity: 0 }}
            transition={SPRING.snap}
            onClick={() => {
              void haptic('medium');
              setHidden(false);
            }}
            aria-label="Show navigation"
            className="fixed bottom-4 left-1/2 -translate-x-1/2 z-[60] w-16 h-11 rounded-2xl glass-spatial flex items-center justify-center text-text-dim active:scale-95 transition-transform"
          >
            <ChevronUp size={18} aria-hidden="true" />
          </motion.button>
        )}
      </AnimatePresence>
    </>
  );
};

export default FloatingDock;
