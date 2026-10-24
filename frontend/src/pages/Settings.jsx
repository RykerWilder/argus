import { useEffect } from "react";
import { Link } from "react-router-dom";
import Header, { Bracket, Footer } from "../components/Header";
import ToolsMenu from "../components/ToolsMenu";
import SecuritySection from "../components/settings/SecuritySection";
import PreferencesSection from "../components/settings/PreferencesSection";
import ApiKeysSection from "../components/settings/ApiKeysSection";

// Impostazioni: sidebar a sinistra e, a destra, la sezione scelta.
// Per ora le preferenze restano nel browser (localStorage, vedi lib/settings.js).
export const SECTIONS = [
  { id: "security", label: "Security", Component: SecuritySection },
  { id: "preferences", label: "Preferences", Component: PreferencesSection },
  { id: "api-keys", label: "API keys", Component: ApiKeysSection },
];

export default function Settings({ section }) {
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
      <Header>
        <ToolsMenu />
        <Link to="/history" className="nav-link nav-link--hide-sm">History</Link>
        <Link to="/sources" className="nav-link nav-link--hide-sm">Sources</Link>
        <Link to="/settings" className="nav-link is-current" aria-current="page">Settings</Link>
        <Bracket as={Link} to="/">New search</Bracket>
      </Header>

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

          <section className="settings__content" aria-labelledby="settings-title">
            <h2 id="settings-title">{current.label}</h2>
            <Section />
          </section>
        </div>
      </main>
      <Footer />
    </div>
  );
}
