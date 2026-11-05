/**
 * The AI rewrite of the Home coach briefing. The app works out what to say, and
 * the model only changes the wording, so nothing here may alter the facts.
 *
 * The prompt asks the model to keep every number, but a prompt can't enforce
 * that, and these are calorie, protein and water targets. sanitizePolish does:
 * any rewritten text with a number the original lacks is dropped, and the app
 * then shows its own wording for that field.
 */
const clip = (v: unknown, max: number) => String(v ?? "").slice(0, max);
const MAX_NUDGES = 8;

interface BaseNudge { id: string; title: string; message: string }
export interface BaseBriefing { headline: string; subtitle: string; nudges: BaseNudge[] }

/** The briefing comes from the client, so it is bounded before reaching a prompt. */
export const boundBriefing = (raw: any): BaseBriefing => ({
  headline: clip(raw?.headline, 200),
  subtitle: clip(raw?.subtitle, 300),
  nudges: (Array.isArray(raw?.nudges) ? raw.nudges : []).slice(0, MAX_NUDGES).map((n: any) => ({
    id: clip(n?.id, 60),
    title: clip(n?.title, 150),
    message: clip(n?.message, 500),
  })),
});

export const briefingPrompt = (goal: unknown, base: BaseBriefing) =>
  `You are FitFlow Coach. Rewrite this daily briefing in your own voice: direct, warm, specific, motivating.
Plain text only — no markdown, no emojis. Keep each "message" to ONE or TWO short sentences.
Preserve every "id" EXACTLY. Do NOT add, drop, or reorder nudges, and do NOT change any numbers or targets mentioned.
User goal: ${clip(goal, 100) || "general fitness"}.
Briefing to rewrite:
${JSON.stringify(base)}
Return ONLY valid JSON, same shape: {"headline":string,"subtitle":string,"nudges":[{"id":string,"title":string,"message":string}]}`;

const numbersIn = (s: string) => (s.match(/\d+(?:[.,]\d+)*/g) || []).map((n) => n.replace(/,/g, ""));

/** Rewritten text, or undefined when absent or it brings in a new number. */
const accept = (polished: unknown, original: string, max: number): string | undefined => {
  if (typeof polished !== "string") return undefined;
  const text = polished.replace(/[*_`#]/g, "").trim();
  if (!text) return undefined;
  const allowed = new Set(numbersIn(original));
  return numbersIn(text).every((n) => allowed.has(n)) ? text.slice(0, max) : undefined;
};

export const sanitizePolish = (base: BaseBriefing, polished: any) => {
  if (!polished || typeof polished !== "object" || Array.isArray(polished)) return null;
  const given = Array.isArray(polished.nudges) ? polished.nudges : [];
  const byId = new Map(given.filter((n: any) => n && typeof n.id === "string").map((n: any) => [n.id, n]));
  return {
    headline: accept(polished.headline, base.headline, 200),
    subtitle: accept(polished.subtitle, base.subtitle, 300),
    // Built from the original list, so the model can't add or drop a nudge.
    nudges: base.nudges.map((n) => {
      const p: any = byId.get(n.id);
      const source = `${n.title} ${n.message}`;
      return { id: n.id, title: accept(p?.title, source, 150), message: accept(p?.message, source, 500) };
    }),
  };
};
