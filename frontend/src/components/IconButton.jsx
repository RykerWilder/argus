import { Check } from "lucide-react";

// Pulsante a icona: il nome compare in un tooltip al passaggio del mouse o con
// il focus da tastiera, ed è anche il nome accessibile. Con `href` diventa un
// link che si apre in una nuova scheda.
export default function IconButton({ label, icon: Icon, done, doneLabel = "Copied", href, onClick, className = "", ...props }) {
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
