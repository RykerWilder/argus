import type { ComponentPropsWithoutRef, ElementType, ReactNode } from "react";
import { Link } from "react-router-dom";
import { FooterNav, MainNav } from "./MainNav";

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

// children: elementi della pagina messi prima della navigazione (es. la ricerca
// rapida). actions: elementi della pagina messi dopo (es. "New analysis").
// Le voci di navigazione vere e proprie stanno tutte in MainNav.jsx.
interface HeaderProps {
  children?: ReactNode;
  actions?: ReactNode;
}

export default function Header({ children, actions }: HeaderProps) {
  return (
    <header className="site-header">
      <Logo />
      <nav className="site-header__nav" aria-label="Main">
        {children}
        <MainNav />
        {actions}
      </nav>
    </header>
  );
}

type BracketProps<T extends ElementType> = {
  /** Elemento o componente da rendere (un <button> se manca). */
  as?: T;
  children: ReactNode;
  className?: string;
} & Omit<ComponentPropsWithoutRef<T>, "as" | "children" | "className">;

export function Bracket<T extends ElementType = "button">({ as, children, className = "", ...props }: BracketProps<T>) {
  const As: ElementType = as ?? "button";
  return (
    <As className={`bracket ${className}`} {...props}>
      <span aria-hidden="true">[</span>
      <span className="bracket__label">{children}</span>
      <span aria-hidden="true">]</span>
    </As>
  );
}

// Footer: sulla home solo copyright e link, discreti; nelle altre pagine quello
// completo con copyright, autore e motto. I link sono in MainNav.jsx.
export function Footer({ minimal = false }: { minimal?: boolean }) {
  const year = new Date().getFullYear();
  const start = (
    <div className="site-footer__start">
      <span className="site-footer__copy">© {year} RykerWilder</span>
      <FooterNav />
    </div>
  );
  if (minimal) {
    return <footer className="site-footer site-footer--minimal">{start}</footer>;
  }
  return (
    <footer className="site-footer">
      {start}
      <span className="site-footer__credit">
        Developed by <strong>RykerWilder</strong>
      </span>
      <span className="site-footer__motto">From a SOC analyst, for SOC analysts</span>
    </footer>
  );
}
