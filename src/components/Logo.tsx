import React from 'react';
import { motion } from 'motion/react';

interface LogoProps {
  className?: string;
  showText?: boolean;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  variant?: 'default' | 'mono';
}

const sizeMap = {
  sm: { box: 28, text: 'text-base' },
  md: { box: 40, text: 'text-2xl' },
  lg: { box: 56, text: 'text-4xl' },
  xl: { box: 88, text: 'text-6xl' },
};

export const LogoMark: React.FC<{ size?: number; className?: string; mono?: boolean }> = ({ size = 40, className = '', mono = false }) => {
  const id = React.useId().replace(/:/g, '');
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 64 64"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="FitFlow"
      role="img"
    >
      <defs>
        <linearGradient id={`ff-volt-${id}`} x1="8" y1="56" x2="56" y2="8" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#9CFF1F" />
          <stop offset="55%" stopColor="#C6FF3D" />
          <stop offset="100%" stopColor="#E7FF8C" />
        </linearGradient>
        <linearGradient id={`ff-bg-${id}`} x1="0" y1="0" x2="64" y2="64" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stopColor="#0E1014" />
          <stop offset="100%" stopColor="#06070A" />
        </linearGradient>
      </defs>
      {!mono && <rect x="0" y="0" width="64" height="64" rx="16" fill={`url(#ff-bg-${id})`} />}
      {!mono && <rect x="0.5" y="0.5" width="63" height="63" rx="15.5" fill="none" stroke="rgba(255,255,255,0.08)" />}
      <path
        d="M18 46 C 18 30, 26 22, 42 22 L 46 22"
        stroke={mono ? 'currentColor' : `url(#ff-volt-${id})`}
        strokeWidth="6.5"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M22 34 L 36 34"
        stroke={mono ? 'currentColor' : `url(#ff-volt-${id})`}
        strokeWidth="6.5"
        strokeLinecap="round"
        fill="none"
      />
      <circle cx="46" cy="22" r="3.5" fill={mono ? 'currentColor' : '#C6FF3D'} />
      {!mono && <circle cx="46" cy="22" r="6" fill="#C6FF3D" opacity="0.25" />}
    </svg>
  );
};

export const Logo: React.FC<LogoProps> = ({ className = '', showText = true, size = 'md', variant = 'default' }) => {
  const s = sizeMap[size];

  return (
    <div className={`flex items-center gap-3 ${className}`}>
      <motion.div
        initial={{ scale: 0.9, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 260, damping: 22 }}
        className="relative shrink-0"
      >
        <LogoMark size={s.box} mono={variant === 'mono'} />
      </motion.div>

      {showText && (
        <span
          className={`font-display font-extrabold tracking-tight text-white ${s.text}`}
          style={{ letterSpacing: '-0.035em' }}
        >
          Fit<span className="text-accent">Flow</span>
        </span>
      )}
    </div>
  );
};
