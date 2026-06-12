import confetti from 'canvas-confetti';
import { haptic } from './haptics';

const VOLT = ['#C6FF3D', '#9CFF1F', '#E7FF8C'];
const VOLT_AND_FRIENDS = ['#C6FF3D', '#9CFF1F', '#E7FF8C', '#FF6B6B', '#7DD3FC'];

/** Mild celebration — set logged, water topped up. */
export const celebrateSmall = () => {
  haptic('light');
  confetti({
    particleCount: 24,
    spread: 60,
    startVelocity: 18,
    gravity: 1.2,
    ticks: 90,
    colors: VOLT,
    origin: { x: 0.5, y: 0.85 },
    scalar: 0.7,
    disableForReducedMotion: true,
  });
};

/** Workout complete celebration. */
export const celebrateSession = () => {
  haptic('success');
  confetti({
    particleCount: 90,
    spread: 75,
    startVelocity: 38,
    gravity: 0.95,
    ticks: 180,
    colors: VOLT_AND_FRIENDS,
    origin: { x: 0.5, y: 0.55 },
    scalar: 0.95,
    disableForReducedMotion: true,
  });
};

/** Personal record — explosive, side-emitting bursts. */
export const celebratePR = () => {
  haptic('heavy');
  const burst = (x: number, angle: number) => {
    confetti({
      particleCount: 70,
      angle,
      spread: 60,
      startVelocity: 55,
      gravity: 1,
      ticks: 220,
      colors: VOLT_AND_FRIENDS,
      origin: { x, y: 0.7 },
      scalar: 1.1,
      shapes: ['square', 'circle'],
      disableForReducedMotion: true,
    });
  };
  burst(0.15, 60);
  burst(0.85, 120);
  setTimeout(() => burst(0.5, 90), 220);
};

/** Level up — single wide burst from center. */
export const celebrateLevelUp = () => {
  haptic('success');
  confetti({
    particleCount: 130,
    spread: 100,
    startVelocity: 45,
    gravity: 0.9,
    ticks: 220,
    colors: VOLT_AND_FRIENDS,
    origin: { x: 0.5, y: 0.5 },
    scalar: 1.05,
    disableForReducedMotion: true,
  });
};
