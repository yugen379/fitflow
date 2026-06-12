import React from 'react';
import { motion } from 'motion/react';

/**
 * A soft animated mesh-gradient field for atmospheric depth.
 * Each blob drifts with a unique long period so the motion never repeats
 * obviously. GPU-accelerated transforms only, runs at ~0 CPU cost.
 */
export const AnimatedMesh: React.FC<{ className?: string }> = ({ className = '' }) => (
  <div className={`absolute inset-0 overflow-hidden pointer-events-none ${className}`} aria-hidden>
    <motion.div
      className="absolute -top-40 -left-20 w-[420px] h-[420px] rounded-full"
      style={{ background: 'radial-gradient(circle, rgba(198,255,61,0.18), transparent 60%)', filter: 'blur(60px)' }}
      animate={{ x: [0, 80, -40, 0], y: [0, 60, -30, 0], scale: [1, 1.08, 0.95, 1] }}
      transition={{ duration: 24, repeat: Infinity, ease: 'easeInOut' }}
    />
    <motion.div
      className="absolute top-1/3 -right-20 w-[380px] h-[380px] rounded-full"
      style={{ background: 'radial-gradient(circle, rgba(125,211,252,0.14), transparent 60%)', filter: 'blur(70px)' }}
      animate={{ x: [0, -60, 40, 0], y: [0, -40, 60, 0], scale: [1, 0.9, 1.1, 1] }}
      transition={{ duration: 32, repeat: Infinity, ease: 'easeInOut' }}
    />
    <motion.div
      className="absolute -bottom-40 left-1/3 w-[460px] h-[460px] rounded-full"
      style={{ background: 'radial-gradient(circle, rgba(255,107,107,0.10), transparent 60%)', filter: 'blur(80px)' }}
      animate={{ x: [0, 50, -50, 0], y: [0, -30, 30, 0], scale: [1, 1.05, 0.97, 1] }}
      transition={{ duration: 28, repeat: Infinity, ease: 'easeInOut' }}
    />
    {/* Faint grid overlay — gives a “performance dashboard” feel */}
    <div
      className="absolute inset-0 opacity-[0.04]"
      style={{
        backgroundImage:
          'linear-gradient(rgba(255,255,255,1) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,1) 1px, transparent 1px)',
        backgroundSize: '48px 48px',
        maskImage: 'radial-gradient(ellipse at center, black 30%, transparent 80%)',
      }}
    />
  </div>
);
