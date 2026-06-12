import React, { useState } from 'react';
import { NavLink } from 'react-router-dom';
import { motion, AnimatePresence, PanInfo } from 'motion/react';
import { Home, Utensils, Dumbbell, User, Play, ChefHat, Trophy, ChevronUp } from 'lucide-react';
import { cn } from '../lib/utils';
import { haptic } from '../lib/haptics';

const navItems = [
  { id: 'home', label: 'Home', icon: Home, path: '/' },
  { id: 'library', label: 'Library', icon: Play, path: '/library' },
  { id: 'track', label: 'Track', icon: Utensils, path: '/track' },
  { id: 'workout', label: 'Train', icon: Dumbbell, path: '/workout' },
  { id: 'kitchen', label: 'Meals', icon: ChefHat, path: '/meal-plan' },
  { id: 'arena', label: 'Compete', icon: Trophy, path: '/challenges' },
  { id: 'profile', label: 'You', icon: User, path: '/profile' },
];

export const BottomNav: React.FC = () => {
  // Hidden state — user can swipe nav down to dismiss it and tap the tab to bring it back.
  const [hidden, setHidden] = useState(false);

  const handleDragEnd = (_e: any, info: PanInfo) => {
    // Swipe down with enough velocity or distance → hide.
    // Swipe up enough → show (works on the small pull-tab when hidden).
    if (info.offset.y > 28 || info.velocity.y > 400) {
      haptic('medium');
      setHidden(true);
    } else if (info.offset.y < -28 || info.velocity.y < -400) {
      haptic('medium');
      setHidden(false);
    }
  };

  return (
    <>
      <AnimatePresence>
        {!hidden && (
          <motion.div
            key="nav"
            initial={{ y: 120, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 140, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 360, damping: 32 }}
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0.05, bottom: 0.6 }}
            onDragEnd={handleDragEnd}
            className="fixed bottom-4 left-1/2 -translate-x-1/2 w-[94%] max-w-md z-[60] safe-area-bottom touch-pan-x"
          >
            {/* Drag handle — visually communicates the swipe affordance. */}
            <div className="flex justify-center pb-1.5 cursor-grab active:cursor-grabbing select-none">
              <div className="w-10 h-1 rounded-full bg-white/15" />
            </div>
            <nav
              id="bottom-nav"
              className="glass h-16 px-2 flex justify-between items-center gap-1 rounded-2xl"
              style={{ borderRadius: '1.25rem' }}
            >
              {navItems.map((item) => (
                <NavLink
                  key={item.id}
                  to={item.path}
                  end={item.path === '/'}
                  onClick={() => haptic('selection')}
                  className="flex-1 min-w-0"
                >
                  {({ isActive }) => (
                    <div className="relative flex flex-col items-center justify-center py-1.5">
                      {isActive && (
                        <motion.div
                          layoutId="nav-pill"
                          transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                          className="absolute inset-x-1 inset-y-0 bg-accent/12 border border-accent/25 rounded-xl"
                        />
                      )}
                      <div
                        className={cn(
                          'relative flex flex-col items-center justify-center gap-1 transition-colors',
                          isActive ? 'text-accent' : 'text-text-dim hover:text-white',
                        )}
                      >
                        <item.icon size={18} strokeWidth={isActive ? 2.4 : 2} />
                        <span className="text-[10px] font-semibold tracking-tight leading-none">
                          {item.label}
                        </span>
                      </div>
                    </div>
                  )}
                </NavLink>
              ))}
            </nav>
          </motion.div>
        )}
      </AnimatePresence>

      {/* When hidden — a small pull tab at the bottom edge. Swipe it up OR tap to restore the nav. */}
      <AnimatePresence>
        {hidden && (
          <motion.button
            key="peek"
            initial={{ y: 30, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 30, opacity: 0 }}
            drag="y"
            dragConstraints={{ top: -80, bottom: 0 }}
            dragElastic={{ top: 0.6, bottom: 0.05 }}
            onDragEnd={handleDragEnd}
            onClick={() => { haptic('light'); setHidden(false); }}
            transition={{ type: 'spring', stiffness: 320, damping: 28 }}
            className="fixed bottom-2 left-1/2 -translate-x-1/2 z-[60] w-20 h-7 rounded-full glass flex items-center justify-center text-text-dim active:text-accent shadow-[0_8px_24px_-6px_rgba(0,0,0,0.6)]"
            aria-label="Show navigation"
          >
            <ChevronUp size={14} />
          </motion.button>
        )}
      </AnimatePresence>
    </>
  );
};
