import { useMemo } from 'react';
import { useAuth } from './useAuth';
import {
  resolveUnitPrefs, formatWeight, weightParts, formatWeightInput, weightUnitLabel,
  formatHeight, formatHeightInput, heightUnitLabel, formatDistance, formatPace,
  formatEnergy, energyValue, formatVolume, parseWeight, parseHeight,
  type UnitPrefs,
} from '../lib/units';

const deviceLocale = () => {
  try { return typeof navigator !== 'undefined' ? navigator.language : 'en'; } catch { return 'en'; }
};

/**
 * The signed-in person's display units plus formatters/parsers already bound to
 * them. Formatters take METRIC (kg, cm, km, s/km, kcal, ml); parsers return
 * metric or null. Never store what a formatter returns.
 *
 * Light by design: it pulls in only src/lib/units.ts (pure, no imports) and the
 * auth context every screen already has, so it is safe in lazy chunks.
 */
export const useUnits = () => {
  const { profile } = useAuth();
  const stored = profile?.units;
  const legacy = profile?.weightUnit;
  // Keyed on the three values, not the map: every profile snapshot is a new
  // object, and rebinding on each one would re-render every consumer.
  const system = stored?.system, weight = stored?.weight, energy = stored?.energy;
  return useMemo(
    () => bindUnits(resolveUnitPrefs({ system, weight, energy }, legacy, deviceLocale())),
    [system, weight, energy, legacy],
  );
};

/** Formatters/parsers bound to explicit prefs (Onboarding uses this for its local unit switch). */
export const bindUnits = (prefs: UnitPrefs) => ({
  prefs,
  formatWeight: (kg: number | null | undefined) => formatWeight(kg, prefs),
  weightParts: (kg: number | null | undefined) => weightParts(kg, prefs),
  formatWeightInput: (kg: number | null | undefined) => formatWeightInput(kg, prefs),
  weightUnitLabel: weightUnitLabel(prefs),
  formatHeight: (cm: number | null | undefined) => formatHeight(cm, prefs),
  formatHeightInput: (cm: number | null | undefined) => formatHeightInput(cm, prefs),
  heightUnitLabel: heightUnitLabel(prefs),
  formatDistance: (km: number | null | undefined) => formatDistance(km, prefs),
  formatPace: (secPerKm: number | null | undefined) => formatPace(secPerKm, prefs),
  formatEnergy: (kcal: number | null | undefined) => formatEnergy(kcal, prefs),
  energyValue: (kcal: number) => energyValue(kcal, prefs),
  formatVolume: (ml: number | null | undefined) => formatVolume(ml, prefs),
  parseWeight: (input: string) => parseWeight(input, prefs),
  parseHeight: (input: string) => parseHeight(input, prefs),
});

export type BoundUnits = ReturnType<typeof bindUnits>;
