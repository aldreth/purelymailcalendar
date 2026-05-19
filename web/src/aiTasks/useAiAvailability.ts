import { useEffect, useState } from "react";
import { isAiSupported, probeAvailability, type AiAvailability } from "./chromeAi";

type State = {
  status: AiAvailability;
  /** Convenience: `status !== "unavailable"`. UI gates on this. */
  supported: boolean;
  /** True once the first probe has resolved. Before that we hide the
   * Tasks tab to avoid a flash of UI that then disappears. */
  ready: boolean;
};

/** Probe Chrome's LanguageModel API once on mount and again when the
 * page becomes visible again (the model can shift between `downloading`
 * and `available` while the tab is backgrounded). */
export function useAiAvailability(): State {
  const [state, setState] = useState<State>({ status: "unavailable", supported: false, ready: false });

  useEffect(() => {
    let cancelled = false;
    async function refresh() {
      const status = await probeAvailability();
      if (cancelled) return;
      setState({ status, supported: isAiSupported(status), ready: true });
    }
    refresh();
    function onVis() {
      if (document.visibilityState === "visible") refresh();
    }
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVis);
    };
  }, []);

  return state;
}
