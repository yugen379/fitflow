/**
 * The server's copy of src/lib/units.ts `unitsPromptLine`: one instruction
 * line telling the model which units to PRESENT in. Every number the server
 * puts in a prompt stays metric (kg, km, ml, g, kcal); only the wording the
 * person reads changes.
 *
 * The input comes from the request payload or the user doc, so it is
 * untrusted: only the known enum values ever reach the prompt (anything else
 * falls back to metric), so a crafted `units` map cannot inject prompt text.
 *
 * Pure, no imports. proof:units imports both copies and checks they produce
 * the same line for every combination.
 */
const WEIGHTS = ["kg", "lb", "st"] as const;
type Weight = (typeof WEIGHTS)[number];

export const unitsPromptLine = (raw?: unknown): string => {
  const o = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const imperial = o.system === "imperial";
  const w: Weight = (WEIGHTS as readonly unknown[]).includes(o.weight) ? (o.weight as Weight) : imperial ? "lb" : "kg";
  const e = o.energy === "kJ" ? "kJ" : "kcal";
  if (!imperial && w === "kg" && e === "kcal") {
    return "Use METRIC units only (ml, litres, km, kg, minutes) — the app shows water in ml, never ounces or miles.";
  }
  const parts = [
    `body weight in ${w === "st" ? "stones and pounds" : w}`,
    `lifting loads in ${w === "lb" ? "lb" : "kg"}`,
    imperial ? "height in feet and inches" : "height in cm",
    imperial ? "distance in miles and pace per mile" : "distance in km and pace per km",
    imperial ? "water and drinks in US fl oz" : "water and drinks in ml or litres",
    imperial ? "food portions in oz (macros stay in grams)" : "food portions in grams",
    `food and burned energy in ${e}`,
  ];
  return `Present every quantity in the user's units: ${parts.join(", ")}. ` +
    "Numbers given to you here are metric (kg, km, ml, g, kcal); convert them " +
    "(1 kg = 2.2046 lb, 1 km = 0.6214 mi, 1 US fl oz = 29.57 ml, 1 oz = 28.35 g, 1 kcal = 4.184 kJ) " +
    "and never mix unit systems in one reply.";
};
