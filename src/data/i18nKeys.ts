/**
 * Sentences shown from typed data constants that cannot hold msg() themselves
 * (src/data/taxonomy.ts uses `as const` arrays whose literal types the app and
 * proof:library rely on). Listing them here gives them translation keys; the
 * screens show them with tDyn(). Nothing imports this file at runtime.
 */
import { msg } from '../i18n/i18n';

export const TAXONOMY_KEYS = [
  // CATEGORIES
  msg('Strength'), msg('Cardio'), msg('HIIT'), msg('Yoga'), msg('Flexibility'), msg('Recovery'),
  // MUSCLE_GROUPS
  msg('Chest'), msg('Back'), msg('Legs'), msg('Shoulders'), msg('Arms'), msg('Core'), msg('Full Body'),
  // EQUIPMENT
  msg('None'), msg('Dumbbells'), msg('Barbell'), msg('Resistance Band'), msg('Machine'), msg('Kettlebell'),
  msg('Pull-up Bar'), msg('Bench'), msg('Yoga Mat'), msg('Jump Rope'), msg('Box'), msg('Cable'), msg('Wall'),
  // DIFFICULTIES
  msg('Beginner'), msg('Intermediate'), msg('Advanced'),
] as const;
