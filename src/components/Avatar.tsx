import React, { useState } from 'react';

interface Props {
  src?: string | null;
  name?: string;
  size?: number;
  className?: string;
}

const colorFromString = (s: string) => {
  let hash = 0;
  for (let i = 0; i < s.length; i++) hash = s.charCodeAt(i) + ((hash << 5) - hash);
  const hue = Math.abs(hash) % 360;
  return `hsl(${hue}, 60%, 35%)`;
};

const initials = (name?: string) => {
  if (!name) return '·';
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return '·';
  if (parts.length === 1) return parts[0][0]?.toUpperCase() || '·';
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

export const Avatar: React.FC<Props> = ({ src, name, size = 40, className = '' }) => {
  const [errored, setErrored] = useState(false);
  const showFallback = errored || !src;

  if (showFallback) {
    return (
      <div
        className={`rounded-full flex items-center justify-center font-semibold text-white ${className}`}
        style={{
          width: size,
          height: size,
          background: name ? colorFromString(name) : '#1F2937',
          fontSize: size * 0.4,
        }}
        aria-label={name}
      >
        {initials(name)}
      </div>
    );
  }

  return (
    <img
      src={src!}
      alt={name || ''}
      width={size}
      height={size}
      onError={() => setErrored(true)}
      loading="lazy"
      className={`rounded-full object-cover ${className}`}
      style={{ width: size, height: size }}
    />
  );
};
