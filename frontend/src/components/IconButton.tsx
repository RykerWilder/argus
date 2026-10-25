import type { AriaAttributes } from "react";
import { Check } from "lucide-react";
import type { LucideIcon } from "lucide-react";

interface IconButtonProps extends AriaAttributes {
  /** Nome accessibile e testo del tooltip. */
  label: string;
  icon: LucideIcon;
  /** Mostra la spunta e `doneLabel` al posto dell'icona. */
  done?: boolean;
  doneLabel?: string;
  href?: string;
  onClick?: () => void;
  className?: string;
}

// Pulsante a icona: il nome compare in un tooltip al passaggio del mouse o con
// il focus da tastiera, ed è anche il nome accessibile. Con `href` diventa un
// link che si apre in una nuova scheda.
export default function IconButton({ label, icon: Icon, done, doneLabel = "Copied", href, onClick, className = "", ...props }: IconButtonProps) {
  const content = (
    <>
      {done ? <Check size={18} strokeWidth={1.75} aria-hidden="true" /> : <Icon size={18} strokeWidth={1.75} aria-hidden="true" />}
      <span className="icon-btn__tip" role="tooltip">
        {done ? doneLabel : label}
      </span>
    </>
  );
  if (href) {
    return (
      <a className={`icon-btn ${className}`} href={href} target="_blank" rel="noopener noreferrer" aria-label={label} {...props}>
        {content}
      </a>
    );
  }
  return (
    <button type="button" className={`icon-btn ${done ? "is-done" : ""} ${className}`} aria-label={label} onClick={onClick} {...props}>
      {content}
    </button>
  );
}
