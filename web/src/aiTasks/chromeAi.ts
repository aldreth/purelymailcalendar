/**
 * Detection for Chrome's Built-in AI Prompt API (Gemini Nano).
 *
 * The feature lives at `self.LanguageModel` on recent Chrome desktop;
 * older origin-trial builds exposed it as `self.ai.languageModel`. We
 * check both so the gate keeps working as the API name settles.
 *
 * Mobile gate: even when the API reports `available` on Android Chrome,
 * the model startup + on-device CPU pressure make it a rough UX on
 * phones. We add a coarse-pointer check so the Tasks tab stays hidden
 * on touch-first devices regardless of what the API claims.
 */

export type AiAvailability =
  | "unavailable"
  | "downloadable"
  | "downloading"
  | "available";

type LanguageModelLike = {
  availability(): Promise<AiAvailability> | AiAvailability;
};

declare global {
  // The API is still shipping; type as loose `unknown` and feature-detect
  // shape at runtime rather than committing to a strict signature here.
  interface Window {
    LanguageModel?: LanguageModelLike;
    ai?: { languageModel?: LanguageModelLike };
  }
}

export function chromeLanguageModel(): LanguageModelLike | null {
  if (typeof self === "undefined") return null;
  const direct = (self as unknown as Window).LanguageModel;
  if (direct && typeof direct.availability === "function") return direct;
  const nested = (self as unknown as Window).ai?.languageModel;
  if (nested && typeof nested.availability === "function") return nested;
  return null;
}

/** True when the primary pointing device is coarse (i.e. touch). This is
 * a more reliable mobile gate than user-agent sniffing, and it correctly
 * leaves laptops-with-touchscreens alone (their primary pointer is the
 * mouse, so coarse-pointer is false). */
export function isCoarsePointer(): boolean {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") {
    return false;
  }
  try {
    return window.matchMedia("(pointer: coarse)").matches;
  } catch {
    return false;
  }
}

/** Run the API's availability probe with a defensive fallback. The probe
 * itself can throw if the model files are mid-eviction; we treat any
 * failure as `unavailable` so the UI never half-renders. */
export async function probeAvailability(): Promise<AiAvailability> {
  if (isCoarsePointer()) return "unavailable";
  const api = chromeLanguageModel();
  if (!api) return "unavailable";
  try {
    const out = await api.availability();
    if (out === "unavailable" || out === "downloadable" || out === "downloading" || out === "available") {
      return out;
    }
    return "unavailable";
  } catch {
    return "unavailable";
  }
}

export function isAiSupported(status: AiAvailability): boolean {
  return status !== "unavailable";
}
