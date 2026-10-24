import { Link, useLocation } from "react-router-dom";
import ToolsMenu from "./ToolsMenu";

// Navigazione del sito: l'unico posto in cui si decide quali voci esistono.
// Per aggiungere, togliere o rinominare una voce basta cambiare una riga qui:
// tutte le pagine usano <Header /> e <Footer />, che leggono queste liste.

/** Voci dell'header, nell'ordine in cui compaiono. */
export const HEADER_ITEMS = [
  { id: "tools", menu: true }, // menu a tendina, vedi TOOLS in ToolsMenu.jsx
  { id: "history", label: "History", to: "/history" },
  { id: "settings", label: "Settings", to: "/settings" },
];

/** Voci del footer. */
export const FOOTER_ITEMS = [{ id: "sources", label: "Sources", to: "/sources" }];

function isCurrent(pathname, to) {
  return pathname === to || pathname.startsWith(`${to}/`);
}

function NavLink({ item, className = "nav-link" }) {
  const { pathname } = useLocation();
  const current = isCurrent(pathname, item.to);
  return (
    <Link
      to={item.to}
      className={`${className} ${current ? "is-current" : ""}`}
      aria-current={current ? "page" : undefined}
    >
      {item.label}
    </Link>
  );
}

/** Le voci dell'header (da mettere dentro <nav className="site-header__nav">). */
export function MainNav() {
  return HEADER_ITEMS.map((item) =>
    item.menu ? <ToolsMenu key={item.id} /> : <NavLink key={item.id} item={item} />,
  );
}

/** Le voci del footer. */
export function FooterNav() {
  return (
    <nav className="site-footer__nav" aria-label="Footer">
      {FOOTER_ITEMS.map((item) => (
        <NavLink key={item.id} item={item} className="site-footer__link" />
      ))}
    </nav>
  );
}
