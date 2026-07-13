export type BillingPlan = 'monthly' | 'yearly';

export type SubscriptionStatus =
  | 'trialing'
  | 'active'
  | 'past_due'
  | 'canceled'
  | 'expired'
  | 'free';

/**
 * Macro targets. Free users get `percent` mode (ratios of total calories);
 * premium users can switch to `grams` mode and lock exact protein/fat/carb grams.
 */
export interface MacroTargets {
  mode: 'percent' | 'grams';
  /** percent mode — must sum to ~100 */
  proteinPct?: number;
  carbsPct?: number;
  fatsPct?: number;
  /** grams mode (premium) — exact daily targets */
  proteinG?: number;
  carbsG?: number;
  fatsG?: number;
}

/** One set of nutrition overrides applied on a given day type. */
export interface DayTargetValues {
  calories?: number;
  carbsG?: number;
  proteinG?: number;
}

/**
 * Goal-by-day scheduling (premium). `enabled` gates the feature; `schedule`
 * maps weekday index (0=Sun..6=Sat) to a day type so workout days can carry
 * higher calorie/carb limits than rest days.
 */
export interface DayTargets {
  enabled: boolean;
  workout: DayTargetValues;
  rest: DayTargetValues;
  /** 0..6 -> 'workout' | 'rest'; days not listed fall back to base targets. */
  schedule: Record<string, 'workout' | 'rest'>;
}

export interface UserProfile {
  uid: string;
  displayName: string;
  photoURL: string;
  age?: number;
  weight?: number;
  height?: number;
  goal?: 'fat_loss' | 'muscle_gain' | 'maintenance' | 'athletic_performance';
  healthConditions?: string[];
  dietaryPreferences?: string[];
  subscriptionType: 'free' | 'premium';
  // --- Billing / subscription (all server-trusted except trialStartedAt which is fixed at signup) ---
  /** Server timestamp set once at signup; the 6-day cardless trial is measured from this. Immutable. */
  trialStartedAt?: any;
  /** Lifecycle for display: trialing | active | past_due | canceled | expired | free. Written by server/webhook. */
  subscriptionStatus?: SubscriptionStatus;
  /** Which paid plan the user is on (null until they actually pay). */
  plan?: BillingPlan | null;
  stripeCustomerId?: string;
  stripeSubscriptionId?: string;
  /** Epoch ms of the current paid period end / renewal date. */
  currentPeriodEnd?: number;
  cancelAtPeriodEnd?: boolean;
  /** Epoch ms when a past_due grace period ends; Pro stays unlocked until then. */
  graceUntil?: number;
  subscriptionUpdatedAt?: any;
  /** localStorage/Firestore guard so the day-5 "trial ending" push only fires once. */
  trialEndingNotifiedAt?: any;
  // --- Premium nutrition customization ---
  macroTargets?: MacroTargets;
  /** Per-day-type calorie/carb overrides (workout vs rest day scheduling). */
  dayTargets?: DayTargets;
  streak: number;
  badges: string[];
  points: number;
  level: number;
  createdAt: any;
  updatedAt?: any;
  googleFitConnected?: boolean;
  // (googleFitAccessToken/googleFitExpiry removed — OAuth tokens never touch
  // Firestore; the device keeps its own token in localStorage.)
  preferredWorkoutTime?: string; // e.g., "08:00"
  fcmToken?: string;
  notificationsEnabled?: boolean;
  latestBodyFat?: number;
  latestMuscleMass?: number;
  voiceSpeed?: 'normal' | 'slow';
  voiceCoachingEnabled?: boolean;
  weightUnit?: 'kg' | 'lbs';
  goalWeight?: number;
}

export interface Exercise {
  id: string;
  name: string;
  category: string;
  muscleGroups: string[];
  difficulty: string;
  duration: number;
  calories_per_minute: number;
  description: string;
  instructions: string[];
  equipment: string[];
  youtubeId: string;
  tips?: string[];
  commonMistakes?: string[];
}

export interface ProgressionLog {
  suggestedWeight: number;
  suggestedReps: number;
  lastUpdated: any;
  trend: 'up' | 'down' | 'stable';
}

export interface BodyMetric {
  id: string;
  userId: string;
  weight: number;
  unit: 'kg' | 'lbs';
  bodyFat?: number;
  timestamp: any;
}

export interface Challenge {
  id: string;
  name: string;
  description: string;
  type: 'steps' | 'consistency' | 'calories';
  goal: number;
  startDate: any;
  endDate: any;
  participantCount: number;
}

export interface ChallengeParticipant {
  userId: string;
  username: string;
  photoURL?: string;
  joinedAt: any;
  currentProgress: number;
}

export interface MealPlanDay {
  breakfast: any[];
  lunch: any[];
  dinner: any[];
}

export interface SyncData {
  steps: number;
  activeMinutes: number;
  caloriesBurned: number;
  timestamp: any;
}

export interface AppNotification {
  id: string;
  userId: string;
  title: string;
  body: string;
  timestamp: any;
  read: boolean;
  type: 'reminder' | 'achievement' | 'system';
}

export interface WaterLog {
  id: string;
  userId: string;
  amount: number; // In ml
  timestamp: any;
}

export interface SleepLog {
  id: string;
  userId: string;
  hours: number;
  quality: 1 | 2 | 3 | 4 | 5;
  timestamp: any;
}

export interface WellnessLog {
  id: string;
  userId: string;
  mood: string;
  stressLevel: number; // 1-10
  notes?: string;
  timestamp: any;
}

export interface ActivityRoute {
  id: string;
  userId: string;
  type: 'run' | 'cycle' | 'walk';
  path: { lat: number; lng: number }[];
  distance: number; // km
  duration: number; // seconds
  pace: number; // min/km
  timestamp: any;
}

export interface MealRecord {
  id: string;
  userId: string;
  name: string;
  calories: number;
  protein?: number;
  carbs?: number;
  fats?: number;
  mealType?: string;
  timestamp: any;
  imageUrl?: string;
}

export interface WorkoutRecord {
  id: string;
  userId: string;
  type: string;
  duration: number; // in minutes
  caloriesBurned: number;
  timestamp: any;
  notes?: string;
  exerciseLogs?: any[];
  formChecks?: {
    exerciseName: string;
    samples: number;
    avgRating: number;
    worstStatus: 'good' | 'fix' | 'danger';
    topCues: string[];
    durationSec: number;
  }[];
}

export interface Post {
  id: string;
  userId: string;
  username: string;
  userPhoto: string;
  mediaUrl?: string;
  content?: string;
  likesCount: number;
  commentsCount: number;
  createdAt: any;
}

export interface Comment {
  id: string;
  userId: string;
  username: string;
  userPhoto: string;
  content: string;
  createdAt: any;
}

export type ReportTargetType = 'post' | 'comment' | 'user';

export interface Report {
  id?: string;
  reporterId: string;
  targetType: ReportTargetType;
  targetId: string;
  reportedUserId: string;
  postId?: string;
  reason: string;
  createdAt: any;
}

export interface DailySummary {
  caloriesConsumed: number;
  caloriesBurned: number;
  steps: number;
  activeMinutes: number;
}
