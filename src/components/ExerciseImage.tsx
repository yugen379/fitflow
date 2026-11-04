import React, { useState } from 'react';
import { Exercise } from '../types';
// Photo choice lives in one place: category, then (for Strength) primary
// muscle, from a list of photos that were each opened and checked by eye.
import { getExerciseImage } from '../lib/exerciseImage';

const PALETTE: Record<string, { from: string; to: string; accent: string }> = {
  Strength:    { from: '#15181E', to: '#06070A', accent: '#C6FF3D' },
  Cardio:      { from: '#2A1518', to: '#06070A', accent: '#FF6B6B' },
  HIIT:        { from: '#1E1A0A', to: '#06070A', accent: '#FFD166' },
  Yoga:        { from: '#16182A', to: '#06070A', accent: '#A78BFA' },
  Flexibility: { from: '#0E2026', to: '#06070A', accent: '#7DD3FC' },
  Recovery:    { from: '#0E1A26', to: '#06070A', accent: '#7DD3FC' },
};

interface Props {
  exercise: Exercise;
  className?: string;
  width?: number;
  /** legacy props kept for backwards compat with callers */
  iconSize?: number;
  showIcon?: boolean;
  preferYoutube?: boolean;
}

export const ExerciseImage: React.FC<Props> = ({
  exercise,
  className = 'absolute inset-0 w-full h-full',
  width = 800,
}) => {
  const palette = PALETTE[exercise.category] || PALETTE.Strength;
  const photoUrl = getExerciseImage(exercise, width);
  const [photoLoaded, setPhotoLoaded] = useState(false);
  const [photoFailed, setPhotoFailed] = useState(false);

  return (
    <div className={`${className} overflow-hidden relative`} aria-hidden="true">
      {/* Always-visible gradient base (cannot fail, no network) */}
      <div
        className="absolute inset-0"
        style={{ background: `linear-gradient(135deg, ${palette.from} 0%, ${palette.to} 100%)` }}
      />
      <div
        className="absolute inset-0"
        style={{ background: `radial-gradient(circle at 80% 20%, ${palette.accent}22 0%, transparent 55%)` }}
      />

      {/* Verified Unsplash photo, fades in only on successful load */}
      {!photoFailed && (
        <img
          src={photoUrl}
          alt=""
          loading="lazy"
          decoding="async"
          onLoad={() => setPhotoLoaded(true)}
          onError={() => setPhotoFailed(true)}
          className="absolute inset-0 w-full h-full object-cover transition-opacity duration-300"
          style={{ opacity: photoLoaded ? 1 : 0 }}
        />
      )}
    </div>
  );
};
