/**
 * One day of the meal plan, as an ordered list.
 *
 * The week used to render each day as a 2x2 grid of meal names. A grid has no
 * reading order, so breakfast/lunch/dinner/snack — which is inherently a
 * sequence — was laid out as though the four were unrelated. This is a list, in
 * the order you eat them, with the type, the dish and its share of the day's
 * calories on one line.
 *
 * Ingredients expand INLINE rather than opening a modal. Comparing two days, or
 * checking what a dish needs while reading the rest of the week, was impossible
 * when every recipe took over the screen.
 */

import React from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { ChevronDown, Clock, Flame, Replace } from 'lucide-react';

import { cn } from '../lib/utils';
import { haptic } from '../lib/haptics';

export const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack'] as const;
export type MealType = (typeof MEAL_TYPES)[number];

/**
 * Roughly how a day's calories divide across meals.
 *
 * Labelled as an estimate in the UI, because the generator returns one calorie
 * figure for the whole day and never breaks it down per dish. Showing a
 * confident number per meal would be inventing precision the data does not have.
 */
export const MEAL_SHARE: Record<MealType, number> = {
  breakfast: 0.25,
  lunch: 0.35,
  dinner: 0.3,
  snack: 0.1,
};

const MEAL_ICON: Record<MealType, string> = {
  breakfast: '🌅',
  lunch: '☀️',
  dinner: '🌙',
  snack: '🍎',
};

export interface Recipe {
  ingredients?: string[];
  instructions?: string[];
  prepTime?: string;
  protein?: number;
  carbs?: number;
  fats?: number;
}

export interface MealDay {
  day: string;
  breakfast: string;
  lunch: string;
  dinner: string;
  snack: string;
  calories: number;
}

export interface MealDayCardProps {
  day: MealDay;
  dayIndex: number;
  /** Which meal is expanded, if any. */
  expanded: MealType | null;
  onToggle: (dayIndex: number, meal: MealType) => void;
  /** Cached recipes by dish name. */
  recipes: Record<string, Recipe>;
  /** Dish names currently being fetched. */
  loading: Set<string>;
  onSwap: (dayIndex: number, meal: MealType, name: string) => void;
  swapping: boolean;
  /** Highlights today's row in the week. */
  isToday?: boolean;
}

export const MealDayCard: React.FC<MealDayCardProps> = ({
  day,
  dayIndex,
  expanded,
  onToggle,
  recipes,
  loading,
  onSwap,
  swapping,
  isToday,
}) => (
  <motion.section
    initial={{ opacity: 0, y: 12 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ delay: Math.min(dayIndex * 0.04, 0.24), type: 'spring', stiffness: 220, damping: 22 }}
    className={cn('glass overflow-hidden', isToday && 'ring-1 ring-accent/30')}
    aria-label={`${day.day} meals`}
  >
    <header className="px-5 py-3 border-b border-white/[0.06] flex justify-between items-center gap-3">
      <div className="flex items-center gap-2 min-w-0">
        <p className="text-eyebrow text-accent truncate">{day.day}</p>
        {isToday ? (
          <span className="text-[9px] uppercase tracking-[0.12em] px-1.5 py-0.5 rounded-full bg-accent/12 border border-accent/30 text-accent shrink-0">
            Today
          </span>
        ) : null}
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        <Flame size={12} className="text-accent-2/70" aria-hidden="true" />
        <span className="num text-xs text-text-dim font-medium">{day.calories} kcal</span>
      </div>
    </header>

    <ul className="divide-y divide-white/[0.05]">
      {MEAL_TYPES.map((meal) => {
        const name = day[meal];
        const isOpen = expanded === meal;
        const recipe = name ? recipes[name] : undefined;
        const isLoading = !!name && loading.has(name);
        const kcal = Math.round(day.calories * MEAL_SHARE[meal]);

        return (
          <li key={meal}>
            <button
              type="button"
              onClick={() => {
                void haptic('light');
                onToggle(dayIndex, meal);
              }}
              disabled={!name}
              aria-expanded={isOpen}
              className="w-full px-5 py-3.5 flex items-start gap-3 text-left active:bg-white/[0.03] transition-colors disabled:opacity-50"
            >
              <span className="text-base leading-none mt-0.5 shrink-0" aria-hidden="true">
                {MEAL_ICON[meal]}
              </span>

              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2">
                  <span className="text-eyebrow text-text-dim">{meal}</span>
                  <span className="num text-[10px] text-text-mute tabular-nums">~{kcal} kcal</span>
                </span>
                <span className="block text-sm font-medium text-white leading-snug mt-1">
                  {name || '—'}
                </span>
              </span>

              <ChevronDown
                size={16}
                aria-hidden="true"
                className={cn(
                  'text-text-mute shrink-0 mt-1 transition-transform duration-200',
                  isOpen && 'rotate-180',
                )}
              />
            </button>

            <AnimatePresence initial={false}>
              {isOpen ? (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
                  className="overflow-hidden"
                >
                  <div className="px-5 pb-4 pt-1 space-y-4">
                    {isLoading ? (
                      <p className="text-xs text-text-dim">Getting the ingredients…</p>
                    ) : !recipe ? (
                      <p className="text-xs text-text-mute leading-relaxed">
                        No recipe yet. Tap “Load ingredients” on this day to fetch it.
                      </p>
                    ) : (
                      <>
                        {recipe.prepTime || recipe.protein != null ? (
                          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                            {recipe.prepTime ? (
                              <span className="inline-flex items-center gap-1.5 text-[11px] text-text-dim">
                                <Clock size={11} aria-hidden="true" />
                                {recipe.prepTime}
                              </span>
                            ) : null}
                            {[
                              { l: 'P', v: recipe.protein, c: 'text-accent' },
                              { l: 'C', v: recipe.carbs, c: 'text-accent-3' },
                              { l: 'F', v: recipe.fats, c: 'text-accent-2' },
                            ]
                              .filter((m) => m.v != null)
                              .map((m) => (
                                <span key={m.l} className="num text-[11px] text-text-dim">
                                  <span className={m.c}>{m.l}</span> {m.v}g
                                </span>
                              ))}
                          </div>
                        ) : null}

                        {recipe.ingredients?.length ? (
                          <div>
                            <p className="text-eyebrow text-text-dim mb-2">Ingredients</p>
                            <ul className="space-y-1.5">
                              {recipe.ingredients.map((item, i) => (
                                <li key={i} className="flex gap-2.5 text-[13px] text-white/85 leading-snug">
                                  <span className="text-accent shrink-0 mt-[2px]" aria-hidden="true">
                                    •
                                  </span>
                                  <span className="min-w-0">{item}</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        ) : null}

                        {recipe.instructions?.length ? (
                          <div>
                            <p className="text-eyebrow text-text-dim mb-2">Method</p>
                            <ol className="space-y-2">
                              {recipe.instructions.map((step, i) => (
                                <li key={i} className="flex gap-2.5 text-[13px] text-white/85 leading-relaxed">
                                  <span className="num text-accent shrink-0 tabular-nums">{i + 1}.</span>
                                  <span className="min-w-0">{step}</span>
                                </li>
                              ))}
                            </ol>
                          </div>
                        ) : null}
                      </>
                    )}

                    {name ? (
                      <button
                        type="button"
                        onClick={() => onSwap(dayIndex, meal, name)}
                        disabled={swapping}
                        className="inline-flex items-center gap-2 h-9 px-3 rounded-xl bg-white/[0.04] border border-white/[0.08] text-text-dim text-[11px] font-semibold active:scale-95 transition-transform disabled:opacity-50"
                      >
                        <Replace size={12} aria-hidden="true" />
                        {swapping ? 'Swapping…' : 'Swap this meal'}
                      </button>
                    ) : null}
                  </div>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </li>
        );
      })}
    </ul>
  </motion.section>
);

export default MealDayCard;
