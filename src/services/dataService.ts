import { collection, addDoc, query, where, getDocs, orderBy, limit, serverTimestamp, doc, updateDoc, increment, deleteDoc, getDoc, setDoc } from 'firebase/firestore';
import { db, handleFirestoreError } from '../lib/firebase';
import { MealRecord, WorkoutRecord, Post, UserProfile } from '../types';
import { addToOfflineQueue } from './offlineService';
import { saveToCatalog } from './foodCatalogService';
import { awardXp } from './xpService';
import { XP_AWARDS } from './missionUtils';

export const checkAndUpdateStreak = async (userId: string) => {
  try {
    const userRef = doc(db, 'users', userId);
    const userSnap = await getDoc(userRef);
    if (!userSnap.exists()) return;

    const userData = userSnap.data() as UserProfile;
    const lastUpdate = userData.updatedAt?.toDate() || userData.createdAt?.toDate();
    const now = new Date();
    
    if (lastUpdate) {
      const diffTime = Math.abs(now.getTime() - lastUpdate.getTime());
      const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      
      if (diffDays === 1) {
        // Daily login/activity - increment streak
        await updateDoc(userRef, {
          streak: increment(1),
          updatedAt: serverTimestamp()
        });
      } else if (diffDays > 1) {
        // Streak broken
        await updateDoc(userRef, {
          streak: 1,
          updatedAt: serverTimestamp()
        });
      }
    } else {
      // First activity
      await updateDoc(userRef, {
        streak: 1,
        updatedAt: serverTimestamp()
      });
    }
  } catch (error) {
    console.error("Streak update error:", error);
  }
};

const cleanObject = (obj: any) => {
  const newObj: any = {};
  Object.keys(obj).forEach(key => {
    if (obj[key] !== undefined) {
      newObj[key] = obj[key];
    }
  });
  return newObj;
};

export const logMeal = async (userId: string, meal: Omit<MealRecord, 'id' | 'timestamp' | 'userId'>) => {
  if (!navigator.onLine) {
    try { await addToOfflineQueue({ type: 'logMeal', payload: meal, userId }); } catch { /* swallow */ }
    return 'offline-queued';
  }
  try {
    const docRef = await addDoc(collection(db, 'meals'), {
      ...cleanObject(meal),
      userId,
      timestamp: serverTimestamp(),
    });
    try { await checkAndUpdateStreak(userId); } catch { /* streak is best-effort */ }
    // XP only on the confirmed write — the offline-queued path earns it on replay.
    // Fire-and-forget: the XP bar reacts via the profile snapshot, not this call.
    void awardXp(userId, XP_AWARDS.meal);
    // Grow the shared food catalog (#3) — best-effort, never blocks the log.
    saveToCatalog({
      name: (meal as any).name,
      calories: (meal as any).calories,
      protein: (meal as any).protein,
      carbs: (meal as any).carbs,
      fats: (meal as any).fats,
    });
    // Denormalize lastMealAt for the server-side meal-time nudge (engagementUtils):
    // the function suppresses a nudge once anything's been logged today. Best-effort.
    try { await updateDoc(doc(db, 'users', userId), { lastMealAt: serverTimestamp() }); } catch { /* best-effort */ }
    return docRef.id;
  } catch (error) {
    handleFirestoreError(error, 'create', 'meals');
    // Don't bubble the error — queue and pretend success so the UI stays calm.
    try { await addToOfflineQueue({ type: 'logMeal', payload: meal, userId }); } catch { /* swallow */ }
    return 'queued';
  }
};

export const logWorkout = async (userId: string, workout: Omit<WorkoutRecord, 'id' | 'timestamp' | 'userId'>) => {
  if (!navigator.onLine) {
    try { await addToOfflineQueue({ type: 'logWorkout', payload: workout, userId }); } catch { /* swallow */ }
    return 'offline-queued';
  }
  try {
    const docRef = await addDoc(collection(db, 'workouts'), {
      ...cleanObject(workout),
      userId,
      timestamp: serverTimestamp(),
    });
    try { await checkAndUpdateStreak(userId); } catch { /* streak is best-effort */ }
    // XP only on the confirmed write — the offline-queued path earns it on replay.
    // Fire-and-forget: the XP bar reacts via the profile snapshot, not this call.
    void awardXp(userId, XP_AWARDS.workout);
    return docRef.id;
  } catch (error) {
    handleFirestoreError(error, 'create', 'workouts');
    try { await addToOfflineQueue({ type: 'logWorkout', payload: workout, userId }); } catch { /* swallow */ }
    return 'queued';
  }
};

export const createPost = async (userId: string, username: string, userPhoto: string, content: string, mediaUrl?: string) => {
  try {
    const postData: any = {
      userId,
      username,
      userPhoto,
      content,
      likesCount: 0,
      commentsCount: 0,
      createdAt: serverTimestamp()
    };
    
    if (mediaUrl !== undefined) {
      postData.mediaUrl = mediaUrl;
    }

    const docRef = await addDoc(collection(db, 'posts'), postData);
    return docRef.id;
  } catch (error) {
    handleFirestoreError(error, 'create', 'posts');
  }
};

export const updatePost = async (postId: string, content: string) => {
  try {
    const postRef = doc(db, 'posts', postId);
    await updateDoc(postRef, {
      content,
      updatedAt: serverTimestamp()
    });
  } catch (error) {
    handleFirestoreError(error, 'update', `posts/${postId}`);
  }
};

export const deletePost = async (postId: string) => {
  try {
    const postRef = doc(db, 'posts', postId);
    await deleteDoc(postRef);
  } catch (error) {
    handleFirestoreError(error, 'delete', `posts/${postId}`);
  }
};

export const getFeed = async () => {
  try {
    const q = query(collection(db, 'posts'), orderBy('createdAt', 'desc'), limit(20));
    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Post));
  } catch (error) {
    handleFirestoreError(error, 'list', 'posts');
  }
};

export const likePost = async (postId: string, userId: string) => {
  try {
    const postRef = doc(db, 'posts', postId);
    const likeRef = doc(db, `posts/${postId}/likes`, userId);
    
    // Check if already liked to avoid double increment
    const likeSnap = await getDoc(likeRef);
    if (likeSnap.exists()) return;

    await updateDoc(postRef, {
      likesCount: increment(1)
    });
    
    await setDoc(likeRef, {
      userId,
      timestamp: serverTimestamp()
    });
  } catch (error) {
    handleFirestoreError(error, 'update', `posts/${postId}`);
  }
};

export const addComment = async (postId: string, userId: string, username: string, userPhoto: string, content: string) => {
  try {
    const commentRef = await addDoc(collection(db, `posts/${postId}/comments`), {
      userId,
      username,
      userPhoto,
      content,
      createdAt: serverTimestamp()
    });
    
    // Update comment count on post
    const postRef = doc(db, 'posts', postId);
    await updateDoc(postRef, {
      commentsCount: increment(1)
    });
    
    return commentRef.id;
  } catch (error) {
    handleFirestoreError(error, 'create', `posts/${postId}/comments`);
  }
};

export const getComments = async (postId: string) => {
  try {
    const q = query(
      collection(db, `posts/${postId}/comments`),
      orderBy('createdAt', 'asc'),
      limit(50)
    );
    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
  } catch (error) {
    handleFirestoreError(error, 'list', `posts/${postId}/comments`);
  }
};

// --- Community safety: report content & block users (Google Play UGC policy) ---

export const reportContent = async (params: {
  reporterId: string;
  targetType: 'post' | 'comment' | 'user';
  targetId: string;
  reportedUserId: string;
  reason: string;
  postId?: string;
}) => {
  try {
    const data: any = {
      reporterId: params.reporterId,
      targetType: params.targetType,
      targetId: params.targetId,
      reportedUserId: params.reportedUserId,
      reason: params.reason,
      createdAt: serverTimestamp(),
    };
    if (params.postId !== undefined) data.postId = params.postId;
    await addDoc(collection(db, 'reports'), data);
  } catch (error) {
    handleFirestoreError(error, 'create', 'reports');
  }
};

export const blockUser = async (userId: string, blockedUserId: string) => {
  try {
    if (!userId || !blockedUserId || userId === blockedUserId) return;
    await setDoc(doc(db, `users/${userId}/blocks`, blockedUserId), {
      blockedUserId,
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, 'create', `users/${userId}/blocks`);
  }
};

export const unblockUser = async (userId: string, blockedUserId: string) => {
  try {
    await deleteDoc(doc(db, `users/${userId}/blocks`, blockedUserId));
  } catch (error) {
    handleFirestoreError(error, 'delete', `users/${userId}/blocks/${blockedUserId}`);
  }
};

export const getDailySummary = async (userId: string) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    // Fetch meals
    const mealsQ = query(
      collection(db, 'meals'), 
      where('userId', '==', userId),
      where('timestamp', '>=', today)
    );
    const mealsSnapshot = await getDocs(mealsQ);
    const meals = mealsSnapshot.docs.map(doc => doc.data() as MealRecord);
    
    // Fetch workouts
    const workoutsQ = query(
      collection(db, 'workouts'),
      where('userId', '==', userId),
      where('timestamp', '>=', today)
    );
    const workoutsSnapshot = await getDocs(workoutsQ);
    const workouts = workoutsSnapshot.docs.map(doc => doc.data() as WorkoutRecord);
    
    const caloriesConsumed = meals.reduce((acc, m) => acc + m.calories, 0);
    const caloriesBurned = workouts.reduce((acc, w) => acc + w.caloriesBurned, 0);
    const protein = meals.reduce((acc, m) => acc + (m.protein || 0), 0);
    const carbs = meals.reduce((acc, m) => acc + (m.carbs || 0), 0);
    const fats = meals.reduce((acc, m) => acc + (m.fats || 0), 0);
    const workoutMinutes = workouts.reduce((acc, w) => acc + (w.duration || 0), 0);
    
    return {
      caloriesConsumed,
      caloriesBurned,
      protein,
      carbs,
      fats,
      workoutMinutes,
      mealCount: meals.length,
      workoutCount: workouts.length
    };
  } catch (error) {
    handleFirestoreError(error, 'list', 'summary');
  }
};

export const getMeals = async (userId: string) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const q = query(
      collection(db, 'meals'),
      where('userId', '==', userId),
      where('timestamp', '>=', today),
      orderBy('timestamp', 'desc')
    );
    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as MealRecord));
  } catch (error) {
    handleFirestoreError(error, 'list', 'meals');
  }
};

export const logWeight = async (userId: string, weight: number) => {
  try {
    const docRef = await addDoc(collection(db, 'weight_history'), {
      userId,
      weight,
      timestamp: serverTimestamp()
    });
    
    // Update current weight in user profile too
    const userRef = doc(db, 'users', userId);
    await updateDoc(userRef, { weight });
    
    return docRef.id;
  } catch (error) {
    handleFirestoreError(error, 'create', 'weight_history');
  }
};

export const getWeightHistory = async (userId: string) => {
  try {
    const q = query(
      collection(db, 'weight_history'),
      where('userId', '==', userId),
      orderBy('timestamp', 'asc'),
      limit(30)
    );
    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.map(doc => ({ 
      id: doc.id, 
      ...doc.data() 
    }));
  } catch (error) {
    handleFirestoreError(error, 'list', 'weight_history');
  }
};

export const getWorkouts = async (userId: string) => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const q = query(
      collection(db, 'workouts'),
      where('userId', '==', userId),
      where('timestamp', '>=', today),
      orderBy('timestamp', 'desc')
    );
    const querySnapshot = await getDocs(q);
    return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as WorkoutRecord));
  } catch (error) {
    handleFirestoreError(error, 'list', 'workouts');
  }
};
