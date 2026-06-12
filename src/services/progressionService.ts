import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { ProgressionLog } from '../types';

interface ProgressionRecord extends ProgressionLog {
  bestWeight?: number;
  bestReps?: number;
  bestEstimated1RM?: number;
}

const epley1RM = (weight: number, reps: number) =>
  reps === 1 ? weight : weight * (1 + reps / 30);

export const analyzeProgression = async (userId: string, exerciseId: string): Promise<ProgressionLog | null> => {
  try {
    const ref = doc(db, `users/${userId}/progression`, exerciseId);
    const snap = await getDoc(ref);
    if (snap.exists()) return snap.data() as ProgressionLog;
    return null;
  } catch (error) {
    console.error('Progression error:', error);
    return null;
  }
};

export interface PRInfo {
  isWeightPR: boolean;
  isRepsPR: boolean;
  isOneRMPR: boolean;
  previousBest?: { weight: number; reps: number; oneRM: number };
}

export const updateProgression = async (
  userId: string,
  exerciseId: string,
  performance: { completed: boolean; difficulty: number; weight?: number; reps?: number },
): Promise<PRInfo> => {
  const ref = doc(db, `users/${userId}/progression`, exerciseId);
  const snap = await getDoc(ref);
  let current: ProgressionRecord = {
    suggestedWeight: 20,
    suggestedReps: 10,
    lastUpdated: serverTimestamp(),
    trend: 'stable',
  };
  if (snap.exists()) current = snap.data() as ProgressionRecord;

  let next = { ...current };

  if (performance.difficulty <= 2 && performance.completed) {
    next.suggestedWeight = (current.suggestedWeight || 20) + 2.5;
    next.trend = 'up';
  } else if (performance.difficulty >= 4) {
    next.suggestedWeight = Math.max(0, (current.suggestedWeight || 20) - 2.5);
    next.trend = 'down';
  } else {
    next.trend = 'stable';
  }

  const pr: PRInfo = { isWeightPR: false, isRepsPR: false, isOneRMPR: false };

  if (performance.weight && performance.reps && performance.completed) {
    const setOneRM = epley1RM(performance.weight, performance.reps);
    pr.previousBest = current.bestWeight
      ? {
          weight: current.bestWeight,
          reps: current.bestReps || 0,
          oneRM: current.bestEstimated1RM || 0,
        }
      : undefined;
    if (!current.bestWeight || performance.weight > current.bestWeight) {
      next.bestWeight = performance.weight;
      pr.isWeightPR = true;
    }
    if (
      performance.weight === current.bestWeight &&
      performance.reps > (current.bestReps || 0)
    ) {
      next.bestReps = performance.reps;
      pr.isRepsPR = true;
    } else if (!current.bestReps) {
      next.bestReps = performance.reps;
    }
    if (!current.bestEstimated1RM || setOneRM > current.bestEstimated1RM) {
      next.bestEstimated1RM = Math.round(setOneRM * 10) / 10;
      pr.isOneRMPR = true;
    }
  }

  next.lastUpdated = serverTimestamp();

  await setDoc(ref, next);
  return pr;
};
