/**
 * Redux Toolkit store for the biomechanics lab.
 *
 * Scope note: this store is deliberately NOT the whole app. FitFlow's auth,
 * profile and toast state already live in React context and Firestore
 * snapshots, and rewriting those into Redux would be churn with no payoff. What
 * genuinely benefits from RTK is the live session + 3D viewport + telemetry
 * triangle, because that is where high-frequency updates, cache invalidation
 * and optimistic writes actually bite. The Provider therefore wraps the app
 * once, and everything else keeps working exactly as before.
 */

import { combineReducers, configureStore } from '@reduxjs/toolkit';
import { setupListeners } from '@reduxjs/toolkit/query';
import { useDispatch, useSelector, useStore } from 'react-redux';
import type { TypedUseSelectorHook } from 'react-redux';

import { fitnessApi } from './fitnessApi';
import { telemetryMiddleware } from './telemetryMiddleware';
import viewportReducer from './viewportSlice';
import workoutReducer from './workoutSlice';

/**
 * The reducer map is declared separately so `RootState` can be derived from it
 * rather than from the store instance — deriving from the instance makes the
 * type circular the moment the store's own options mention it.
 */
export const rootReducer = combineReducers({
  workout: workoutReducer,
  viewport: viewportReducer,
  [fitnessApi.reducerPath]: fitnessApi.reducer,
});

export type RootState = ReturnType<typeof rootReducer>;

export const createBiomechanicsStore = (preloadedState?: Partial<RootState>) => {
  const store = configureStore({
    reducer: rootReducer,
    preloadedState,
    middleware: (getDefaultMiddleware) =>
      getDefaultMiddleware({
        // Every value we put in the store is already plain JSON (timestamps are
        // normalised to epoch ms at the RTK Query boundary), so the checks stay
        // on. They are dev-only and they have caught real bugs here.
        serializableCheck: {
          // Telemetry snapshots arrive several times a second; the deep scan is
          // pure overhead on a payload whose shape we control.
          ignoredActions: ['workout/telemetryCommitted'],
          ignoredPaths: ['workout.telemetry', 'workout.setActivationSum'],
        },
        immutableCheck: {
          ignoredPaths: ['workout.setActivationSum'],
        },
      })
        .concat(fitnessApi.middleware)
        .concat(telemetryMiddleware),
    devTools: import.meta.env.DEV,
  });

  // Enables refetchOnReconnect / refetchOnFocus behaviour for RTK Query.
  setupListeners(store.dispatch);

  return store;
};

export const store = createBiomechanicsStore();

export type BiomechanicsStore = ReturnType<typeof createBiomechanicsStore>;
export type AppDispatch = BiomechanicsStore['dispatch'];

// ---------------------------------------------------------------------------
// Typed hooks — always use these, never the untyped react-redux exports.
// ---------------------------------------------------------------------------

export const useAppDispatch: () => AppDispatch = useDispatch;
export const useAppSelector: TypedUseSelectorHook<RootState> = useSelector;
export const useAppStore: () => BiomechanicsStore = useStore as () => BiomechanicsStore;
