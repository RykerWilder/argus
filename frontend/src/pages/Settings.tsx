import { useEffect } from "react";
import type { ComponentType } from "react";
import { Link } from "react-router-dom";
import Header, { Footer } from "../components/layout/Header";
import SecuritySection from "../components/settings/SecuritySection";
import PreferencesSection from "../components/settings/PreferencesSection";
import ApiKeysSection from "../components/settings/ApiKeysSection";

// Settings: sidebar on the left and, on the right, the chosen section.
// Search preferences, account, second factor and API keys live on the server, in the
// database (see lib/user/settings.ts and lib/user/account.ts). Only the search history
// stays in the browser.
export const SECTIONS: { id: string; label: string; Component: ComponentType }[] = [
  { id: "security", label: "Security", Component: SecuritySection },
  { id: "preferences", label: "Preferences", Component: PreferencesSection },
  { id: "api-keys", label: "API keys", Component: ApiKeysSection },
];

export default function Settings({ section }: { section: string }) {
  const current = SECTIONS.find((s) => s.id === section) || SECTIONS[1];
  const Section = current.Component;

  useEffect(() => {
    document.title = `${current.label} · Settings · Argus`;
    return () => {
      document.title = "Argus";
    };
  }, [current.label]);

  return (
    <div className="page page--settings">
      <Header />

      <main className="settings">
        <h1>Settings</h1>

        <div className="settings__layout">
          <nav className="settings__nav" aria-label="Settings sections">
            <ul>
              {SECTIONS.map((s) => (
                <li key={s.id}>
                  <Link
                    to={`/settings/${s.id}`}
                    className={`settings__nav-link ${s.id === current.id ? "is-active" : ""}`}
                    aria-current={s.id === current.id ? "page" : undefined}
                  >
                    {s.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>

          <section key={current.id} className="settings__content" aria-labelledby="settings-title">
            <h2 id="settings-title">{current.label}</h2>
            <Section />
          </section>
        </div>
      </main>
      <Footer />
    </div>
  );
}
