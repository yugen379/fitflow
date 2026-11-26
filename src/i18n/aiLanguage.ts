/**
 * One instruction line telling the model which language to WRITE in, for the
 * prompts whose output the user reads (coach chat, briefing, daily challenge,
 * weekly recap, meal plan, recipes, form cues).
 *
 * Never used for the parsing prompts (meal decomposition, quick-add, photo and
 * label reads, barcode, workout exercises): the app looks their names up in
 * English tables, so those must stay English. proof:ailanguage guards that.
 *
 * English returns '' so every English prompt stays byte-identical. The input is
 * untrusted (a payload field or a user doc), so only the five known codes ever
 * produce text; anything else is English, and a crafted value can't inject
 * prompt text. functions/src/languagePrompt.ts is the server copy, and
 * proof:ailanguage checks both say exactly the same thing for every input.
 *
 * No imports, so geminiService and the proof harnesses can use it freely.
 */
const NAMES = {
  ms: 'Malay (Bahasa Melayu)',
  id: 'Indonesian (Bahasa Indonesia)',
  es: 'Spanish (Español)',
  pt: 'Portuguese (Português)',
  hi: 'Hindi (हिन्दी)',
} as const;
type AiLang = keyof typeof NAMES;
const CODES = Object.keys(NAMES) as AiLang[];

export const languagePromptLine = (raw?: unknown): string => {
  if (typeof raw !== 'string' || !(CODES as string[]).includes(raw)) return '';
  return `Write every sentence the user will read in ${NAMES[raw as AiLang]}. ` +
    'Keep food names, exercise names, numbers (digits 0-9) and unit symbols as given, ' +
    'and keep JSON keys and fixed option values in English.';
};

/** The line with its leading newline, or '' for English: drops into a prompt after another line. */
export const languageLineAfter = (raw?: unknown): string => {
  const line = languagePromptLine(raw);
  return line ? `\n${line}` : '';
};
