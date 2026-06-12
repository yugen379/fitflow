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
  streak: number;
  badges: string[];
  points: number;
  level: number;
  createdAt: any;
  updatedAt?: any;
  googleFitConnected?: boolean;
  googleFitAccessToken?: string;
  googleFitExpiry?: number;
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

export interface DailySummary {
  caloriesConsumed: number;
  caloriesBurned: number;
  steps: number;
  activeMinutes: number;
}
