import React, { useState } from 'react';
import { Exercise } from '../types';

// Verified Unsplash photo IDs — these are already used elsewhere in the app
// (the Home page Featured workouts row) so they're confirmed live.
const HIIT_PHOTO     = '1517836357463-d25dfeac3438'; // box jump / HIIT
const STRENGTH_PHOTO = '1541534741688-6078c6bfb5c5'; // dumbbells / strength

const PHOTO_FOR_CATEGORY: Record<string, string> = {
  Strength:    STRENGTH_PHOTO,
  Cardio:      HIIT_PHOTO,
  HIIT:        HIIT_PHOTO,
  Yoga:        STRENGTH_PHOTO,
  Flexibility: STRENGTH_PHOTO,
  Recovery:    STRENGTH_PHOTO,
};

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
  const photoId = PHOTO_FOR_CATEGORY[exercise.category] || STRENGTH_PHOTO;
  const photoUrl = `https://images.unsplash.com/photo-${photoId}?w=${width}&q=80&auto=format&fit=crop`;
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
