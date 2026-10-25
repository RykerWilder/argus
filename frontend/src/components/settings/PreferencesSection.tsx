import type { Source } from "../../types";
import Toggle from "../Toggle";
import { DOMAIN_SOURCES, IP_SOURCES } from "../../lib/lookup";
import { API_KEY_SERVICES, isServiceEnabled, setServiceEnabled } from "../../lib/settings";
import { useSettingsVersion } from "../../lib/useSettings";

// Quali servizi Argus può interrogare. Un servizio spento non viene chiamato.
const GROUPS: { id: string; title: string; used: string; sources: Source[] }[] = [
  { id: "ip", title: "IP addresses", used: "searches for IP addresses", sources: IP_SOURCES },
  { id: "domain", title: "Domains and URLs", used: "searches for domains and URLs", sources: DOMAIN_SOURCES },
];

const EXTRA: Partial<Record<string, string>> = {
  iptracker: "Also locates the servers on the map of the email header analyzer.",
};

const needsKey = (id: string) => API_KEY_SERVICES.find((s) => s.id === id)?.required;

export default function PreferencesSection() {
  useSettingsVersion();

  return (
    <>
      <p className="settings__lead muted">
        Choose which services Argus queries. A service that is turned off is never called, and its panel does not appear in the report.
      </p>

      {GROUPS.map((group) => {
        const allOff = group.sources.every((s) => !isServiceEnabled(s.id));
        return (
          <section key={group.id} className="pref-group" aria-labelledby={`pref-${group.id}`}>
            <h3 id={`pref-${group.id}`}>{group.title}</h3>
            <ul className="pref-list">
              {group.sources.map((s) => (
                <li key={s.id} className="pref">
                  <div className="pref__text">
                    <span id={`pref-${s.id}`} className="pref__name">{s.name}</span>
                    <span className="pref__covers muted">{s.covers}</span>
                    {EXTRA[s.id] && <span className="pref__covers muted">{EXTRA[s.id]}</span>}
                    {needsKey(s.id) && <span className="pref__covers muted">Needs an API key.</span>}
                  </div>
                  <Toggle
                    checked={isServiceEnabled(s.id)}
                    onChange={(on) => setServiceEnabled(s.id, on)}
                    label={`Query ${s.name}`}
                  />
                </li>
              ))}
            </ul>
            {allOff && (
              <p className="settings__warning" role="status">
                Every source is off: {group.used} are disabled.
              </p>
            )}
          </section>
        );
      })}
    </>
  );
}
