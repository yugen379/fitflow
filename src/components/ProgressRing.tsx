import React from 'react';

interface ProgressRingProps {
  progress: number;
  size: number;
  strokeWidth: number;
  color?: string;
}

export const ProgressRing: React.FC<ProgressRingProps> = ({ progress, size, strokeWidth, color = "var(--color-accent)" }) => {
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (progress / 100) * circumference;

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="drop-shadow-[0_0_8px_rgba(0,209,255,0.3)]">
      <defs>
        <linearGradient id="ring-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor={color} />
          <stop offset="100%" stopColor="var(--color-accent-alt)" />
        </linearGradient>
        <filter id="glow">
          <feGaussianBlur stdDeviation="2" result="coloredBlur"/>
          <feMerge>
            <feMergeNode in="coloredBlur"/>
            <feMergeNode in="SourceGraphic"/>
          </feMerge>
        </filter>
      </defs>
      {/* Background track */}
      <circle
        stroke="rgba(255,255,255,0.05)"
        strokeWidth={strokeWidth}
        fill="transparent"
        r={radius}
        cx={size / 2}
        cy={size / 2}
      />
      {/* Progress ring with glow */}
      <circle
        stroke="url(#ring-gradient)"
        strokeWidth={strokeWidth}
        strokeDasharray={circumference}
        style={{ strokeDashoffset: offset }}
        strokeLinecap="round"
        fill="transparent"
        r={radius}
        cx={size / 2}
        cy={size / 2}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        className="transition-all duration-1000 ease-out"
        filter="url(#glow)"
      />
    </svg>
  );
};
