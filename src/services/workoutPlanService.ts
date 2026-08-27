import {
  addDoc, collection, deleteDoc, doc, getDocs, limit, orderBy, query, serverTimestamp, where,
} from 'firebase/firestore';
import { db } from '../lib/firestore';
import { handleFirestoreError } from '../lib/firebase';

/**
 * Saved workout plans — sessions the user has BUILT but not yet DONE.
 *
 * The exercise-library builder used to write these straight into `workouts`,
 * the collection that means "a session you completed". Nothing ever read them
 * back, so the plan was write-only; meanwhile every consumer of `workouts`
 * counted it as training that had happened:
 *
 *   • the streak heat-map lit up a square for it,
 *   • the weekly recap added its duration and calories to the totals,
 *   • challenge progress (workouts / minutes / calories) advanced,
 *   • "Week Warrior" counted it toward 5 sessions in 7 days,
 *   • the "you haven't trained in N days" nudge was suppressed by it.
 *
 * Assembling six exercises therefore credited the user with a full session they
 * had not performed — in an app whose entire promise is an honest record. Plans
 * now live in their own collection, and the Library can hand one to the Workout
 * page to actually start.
 */
export interface PlanExercise {
  id: string;
  name: string;
  sets: number;
  reps: number;
  weight: number;
  difficulty: string;
  /** Minutes, used for the plan's estimated duration. */
  duration: number;
  caloriesPerMinute: number;
}

export interface WorkoutPlan {
  id: string;
  name: string;
  exercises: PlanExercise[];
  /** Minutes. */
  duration: number;
  calories: number;
  createdAt: Date | null;
}

const MAX_PLANS = 50;

export const saveWorkoutPlan = async (
  userId: string,
  name: string,
  exercises: PlanExercise[],
): Promise<string | null> => {
  if (!userId || !exercises.length) return null;
  const duration = exercises.reduce((a, e) => a + (e.duration || 0), 0);
  const calories = Math.round(
    exercises.reduce((a, e) => a + (e.duration || 0) * (e.caloriesPerMinute || 5), 0),
  );
  try {
    const ref = await addDoc(collection(db, 'workout_plans'), {
      userId,
      name,
      exercises,
      duration,
      calories,
      createdAt: serverTimestamp(),
    });
    return ref.id;
  } catch (error) {
    handleFirestoreError(error, 'create', 'workout_plans');
    return null;
  }
};

export const listWorkoutPlans = async (userId: string): Promise<WorkoutPlan[]> => {
  if (!userId) return [];
  try {
    const snap = await getDocs(query(
      collection(db, 'workout_plans'),
      where('userId', '==', userId),
      orderBy('createdAt', 'desc'),
      limit(MAX_PLANS),
    ));
    return snap.docs.map((d) => {
      const data = d.data();
      return {
        id: d.id,
        name: typeof data.name === 'string' ? data.name : 'Custom session',
        exercises: Array.isArray(data.exercises) ? (data.exercises as PlanExercise[]) : [],
        duration: typeof data.duration === 'number' ? data.duration : 0,
        calories: typeof data.calories === 'number' ? data.calories : 0,
        createdAt: data.createdAt?.toDate?.() ?? null,
      };
    });
  } catch (error) {
    handleFirestoreError(error, 'list', 'workout_plans');
    return [];
  }
};

export const deleteWorkoutPlan = async (planId: string): Promise<boolean> => {
  try {
    await deleteDoc(doc(db, 'workout_plans', planId));
    return true;
  } catch (error) {
    handleFirestoreError(error, 'delete', `workout_plans/${planId}`);
    return false;
  }
};
