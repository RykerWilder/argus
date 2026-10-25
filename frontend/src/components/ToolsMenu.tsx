import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { Link, useLocation } from "react-router-dom";
import { ChevronDown, Mail } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export interface Tool {
  path: string;
  name: string;
  hint: string;
  icon: LucideIcon;
}

// Voce "Tools" dell'header: un menu con gli strumenti aggiuntivi.
// Per aggiungerne uno basta una riga in TOOLS (e la sua route in main.jsx).
export const TOOLS: Tool[] = [
  {
    path: "/tools/email-headers",
    name: "Email header analyzer",
    hint: "Route, SPF, DKIM, DMARC and indicators of an email",
    icon: Mail,
  },
];

export default function ToolsMenu({ className = "" }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const { pathname } = useLocation();
  const active = TOOLS.some((t) => pathname.startsWith(t.path));

  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        ref.current?.querySelector<HTMLElement>(".tools-menu__button")?.focus();
      }
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    ref.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function onMenuKey(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (!ref.current) return;
    const items = [...ref.current.querySelectorAll<HTMLElement>("[role=menuitem]")];
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === "ArrowDown") items[(i + 1) % items.length]?.focus();
    else if (e.key === "ArrowUp") items[(i - 1 + items.length) % items.length]?.focus();
    else return;
    e.preventDefault();
  }

  return (
    <div className={`tools-menu ${className}`} ref={ref}>
      <button
        type="button"
        className={`nav-link tools-menu__button ${active ? "is-active" : ""}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        Tools
        <ChevronDown size={14} strokeWidth={2} aria-hidden="true" />
      </button>
      {open && (
        <div className="tools-menu__list" role="menu" aria-label="Tools" onKeyDown={onMenuKey}>
          {TOOLS.map(({ path, name, hint, icon: Icon }) => (
            <Link key={path} to={path} role="menuitem" className="tools-menu__item">
              <Icon size={18} strokeWidth={1.75} aria-hidden="true" />
              <span>
                <span className="tools-menu__name">{name}</span>
                <span className="tools-menu__hint">{hint}</span>
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
