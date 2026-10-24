import { useEffect, useReducer } from "react";
import { subscribeSettings } from "./settings";

/** Fa ridisegnare il componente quando le impostazioni cambiano (anche da un'altra scheda). */
export function useSettingsVersion() {
  const [version, bump] = useReducer((n) => n + 1, 0);
  useEffect(() => subscribeSettings(bump), []);
  return version;
}
