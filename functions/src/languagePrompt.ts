/**
 * The server's copy of src/i18n/aiLanguage.ts `languagePromptLine`: one
 * instruction line telling the model which language to write the user-facing
 * text in. Only for prompts whose output the user reads; never for the parsing
 * prompts (decomposeMeal, quickAdd, photo/label reads, workout exercises),
 * whose names the app looks up in English tables.
 *
 * The input comes from the request payload or the user doc, so it is
 * untrusted: only the five known codes ever reach the prompt (anything else is
 * English, which adds nothing), so a crafted `language` cannot inject prompt
 * text. English returns '' so English prompts stay byte-identical.
 *
 * Pure, no imports. proof:ailanguage imports both copies and checks they
 * produce the same line for every input.
 */
const NAMES = {
  ms: "Malay (Bahasa Melayu)",
  id: "Indonesian (Bahasa Indonesia)",
  es: "Spanish (Español)",
  pt: "Portuguese (Português)",
  hi: "Hindi (हिन्दी)",
} as const;
type AiLang = keyof typeof NAMES;
const CODES = Object.keys(NAMES) as AiLang[];

export const languagePromptLine = (raw?: unknown): string => {
  if (typeof raw !== "string" || !(CODES as string[]).includes(raw)) return "";
  return `Write every sentence the user will read in ${NAMES[raw as AiLang]}. ` +
    "Keep food names, exercise names, numbers (digits 0-9) and unit symbols as given, " +
    "and keep JSON keys and fixed option values in English.";
};

/** The line with its leading newline, or "" for English: drops into a prompt after another line. */
export const languageLineAfter = (raw?: unknown): string => {
  const line = languagePromptLine(raw);
  return line ? `\n${line}` : "";
};
