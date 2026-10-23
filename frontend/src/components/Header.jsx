import { Link } from "react-router-dom";

export function Logo() {
  return (
    <Link to="/" className="logo" aria-label="Argus, home">
      {/* Cento occhi: Argo, il gigante dai cento occhi */}
      <svg viewBox="0 0 24 24" width="28" height="28" aria-hidden="true" className="logo__mark">
        <g fill="currentColor">
          <circle cx="4" cy="4" r="2.2" />
          <circle cx="12" cy="4" r="2.2" />
          <circle cx="20" cy="4" r="2.2" />
          <circle cx="4" cy="12" r="2.2" />
          <circle cx="20" cy="12" r="2.2" />
          <circle cx="4" cy="20" r="2.2" />
          <circle cx="12" cy="20" r="2.2" />
          <circle cx="20" cy="20" r="2.2" />
        </g>
        <circle cx="12" cy="12" r="3.4" fill="var(--accent)" />
      </svg>
      <span>Argus</span>
    </Link>
  );
}

export default function Header({ children }) {
  return (
    <header className="site-header">
      <Logo />
      <nav className="site-header__nav">{children}</nav>
    </header>
  );
}

export function Bracket({ as: As = "button", children, className = "", ...props }) {
  return (
    <As className={`bracket ${className}`} {...props}>
      <span aria-hidden="true">[</span>
      <span className="bracket__label">{children}</span>
      <span aria-hidden="true">]</span>
    </As>
  );
}

// Footer: sulla home solo il copyright, discreto; nelle altre pagine quello
// completo con copyright, autore e motto.
export function Footer({ minimal = false }) {
  const year = new Date().getFullYear();
  const copyright = <span className="site-footer__copy">© {year} RykerWilder</span>;
  if (minimal) {
    return <footer className="site-footer site-footer--minimal">{copyright}</footer>;
  }
  return (
    <footer className="site-footer">
      {copyright}
      <span className="site-footer__credit">
        Developed by <strong>RykerWilder</strong>
      </span>
      <span className="site-footer__motto">From a SOC analyst, for SOC analysts</span>
    </footer>
  );
}
