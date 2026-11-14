import { useEffect, useReducer } from "react";
import { subscribeSettings } from "./settings";

/** Re-renders the component when settings change (also from another tab). */
export function useSettingsVersion(): number {
  const [version, bump] = useReducer((n) => n + 1, 0);
  useEffect(() => subscribeSettings(bump), []);
  return version;
}
