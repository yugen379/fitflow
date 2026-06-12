import { get, set } from 'idb-keyval';
import { logMeal, logWorkout } from './dataService';

const OFFLINE_QUEUE_KEY = 'offline_sync_queue';

export interface OfflineAction {
  type: 'logMeal' | 'logWorkout';
  payload: any;
  userId: string;
}

export const addToOfflineQueue = async (action: OfflineAction) => {
  const queue = await get<OfflineAction[]>(OFFLINE_QUEUE_KEY) || [];
  queue.push(action);
  await set(OFFLINE_QUEUE_KEY, queue);
};

export const syncOfflineQueue = async () => {
  if (!navigator.onLine) return;
  
  const queue = await get<OfflineAction[]>(OFFLINE_QUEUE_KEY) || [];
  if (queue.length === 0) return;

  const remainingActions: OfflineAction[] = [];

  for (const action of queue) {
    try {
      if (action.type === 'logMeal') {
        await logMeal(action.userId, action.payload);
      } else if (action.type === 'logWorkout') {
        await logWorkout(action.userId, action.payload);
      }
    } catch (error) {
      console.error('Failed to sync offline action:', action, error);
      remainingActions.push(action);
    }
  }

  await set(OFFLINE_QUEUE_KEY, remainingActions);
};

// Periodic check if online
window.addEventListener('online', syncOfflineQueue);
