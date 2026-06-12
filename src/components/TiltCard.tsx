import React, { useRef, useState } from 'react';
import { motion, useMotionValue, useSpring, useTransform } from 'motion/react';

interface Props {
  children: React.ReactNode;
  className?: string;
  /** Max rotation in degrees on each axis. */
  max?: number;
  /** Disable the glare highlight. */
  noGlare?: boolean;
  /** Disable the tilt entirely (e.g. for users with reduced motion). */
  disabled?: boolean;
  onClick?: () => void;
}

/**
 * Card that tilts toward the touch / cursor with smooth spring physics and
 * a moving specular highlight. Works on mouse, touch, and gyroscope-less
 * mobile devices. The transform is 3D so child shadows feel attached.
 */
export const TiltCard: React.FC<Props> = ({ children, className = '', max = 8, noGlare = false, disabled = false, onClick }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(false);

  const x = useMotionValue(0); // -1..1
  const y = useMotionValue(0);
  const sx = useSpring(x, { stiffness: 220, damping: 18, mass: 0.4 });
  const sy = useSpring(y, { stiffness: 220, damping: 18, mass: 0.4 });

  const rotateX = useTransform(sy, [-1, 1], [max, -max]);
  const rotateY = useTransform(sx, [-1, 1], [-max, max]);
  const glareX = useTransform(sx, [-1, 1], ['10%', '90%']);
  const glareY = useTransform(sy, [-1, 1], ['10%', '90%']);

  const handleMove = (clientX: number, clientY: number) => {
    if (disabled || !ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const px = ((clientX - r.left) / r.width) * 2 - 1;
    const py = ((clientY - r.top) / r.height) * 2 - 1;
    x.set(px);
    y.set(py);
  };

  const reset = () => {
    setActive(false);
    x.set(0);
    y.set(0);
  };

  return (
    <motion.div
      ref={ref}
      onClick={onClick}
      onMouseEnter={() => setActive(true)}
      onMouseLeave={reset}
      onMouseMove={(e) => handleMove(e.clientX, e.clientY)}
      onTouchStart={(e) => { setActive(true); const t = e.touches[0]; handleMove(t.clientX, t.clientY); }}
      onTouchMove={(e) => { const t = e.touches[0]; handleMove(t.clientX, t.clientY); }}
      onTouchEnd={reset}
      style={{ rotateX, rotateY, transformPerspective: 1000, transformStyle: 'preserve-3d' }}
      className={`relative ${className}`}
      whileTap={{ scale: 0.985 }}
    >
      <div style={{ transform: 'translateZ(0)' }}>
        {children}
      </div>
      {!noGlare && active && !disabled && (
        <motion.div
          aria-hidden
          className="pointer-events-none absolute inset-0 rounded-[inherit] mix-blend-overlay"
          style={{
            background: `radial-gradient(circle at ${glareX.get()} ${glareY.get()}, rgba(255,255,255,0.22), transparent 55%)`,
          }}
        />
      )}
    </motion.div>
  );
};
