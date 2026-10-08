import { untracked, useSignalEffect } from "@preact/signals";
import { useEffect } from "preact/hooks";
import { clearAllTooltipTimers, edgeHighlight, insertModifierHeld, tooltip } from "../signals";

/**
 * Tracks Ctrl (Cmd on macOS) so the insert edges of the hovered change show
 * up as soon as the key is pressed. Key events only reach a focused webview,
 * so the rows also read the modifier from their mouse events. Change tooltips
 * stay hidden while an edge is shown.
 */
export function useInsertModifier() {
  useSignalEffect(() => {
    if (edgeHighlight.value) {
      untracked(() => {
        clearAllTooltipTimers();
        tooltip.value = null;
      });
    }
  });

  useEffect(() => {
    const update = (e: KeyboardEvent) => {
      insertModifierHeld.value = e.ctrlKey || e.metaKey;
    };
    const release = () => {
      insertModifierHeld.value = false;
    };
    window.addEventListener("keydown", update);
    window.addEventListener("keyup", update);
    window.addEventListener("blur", release);
    return () => {
      window.removeEventListener("keydown", update);
      window.removeEventListener("keyup", update);
      window.removeEventListener("blur", release);
    };
  }, []);
}
