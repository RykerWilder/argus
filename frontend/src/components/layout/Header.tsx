import type { ComponentPropsWithoutRef, ElementType, ReactNode } from "react";
import { Link } from "react-router-dom";
import { FooterNav, MainNav } from "./MainNav";

export function Logo() {
  return (
    <Link to="/" className="logo" aria-label="Argus, home">
      {/* Argus Panoptes, the giant with a hundred eyes */}
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

// children: page elements placed before the navigation (e.g. the quick search).
// actions: elements placed after it (e.g. "New analysis").
// The navigation entries themselves are all in MainNav.tsx.
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
  /** Element or component to render (a <button> if missing). */
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

// Footer: on the home page only the copyright and links, discreet; on the other pages
// the full one with copyright, author and motto. The links are in MainNav.tsx.
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
