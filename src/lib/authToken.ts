/**
 * Auth-token registry.
 *
 * A twenty-line indirection that exists to break one import edge. `firebase.ts`
 * used to hand its token supplier directly to `geminiService`, which statically
 * imports `@google/genai` — so every cold start, signed in or not, downloaded
 * and parsed the whole Gemini SDK before anything could paint.
 *
 * Now `firebase.ts` writes here and `geminiService` reads from here. Neither
 * imports the other, and the SDK arrives only when the AI features are used.
 */

export type AuthTokenSupplier = () => Promise<string | null>;

const noToken: AuthTokenSupplier = async () => null;

let supplier: AuthTokenSupplier = noToken;

/** Called once by `lib/firebase.ts` during boot. */
export const setAuthTokenSupplier = (fn: AuthTokenSupplier): void => {
  supplier = typeof fn === 'function' ? fn : noToken;
};

/** Never throws: a failed token lookup degrades to an anonymous call. */
export const getAuthToken = async (): Promise<string | null> => {
  try {
    return await supplier();
  } catch {
    return null;
  }
};
