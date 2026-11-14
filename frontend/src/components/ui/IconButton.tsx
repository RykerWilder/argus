import type { AriaAttributes } from "react";
import { Check } from "lucide-react";
import type { LucideIcon } from "lucide-react";

interface IconButtonProps extends AriaAttributes {
  /** Accessible name and tooltip text. */
  label: string;
  icon: LucideIcon;
  /** Shows the checkmark and `doneLabel` instead of the icon. */
  done?: boolean;
  doneLabel?: string;
  href?: string;
  onClick?: () => void;
  className?: string;
}

// Icon button: the name appears in a tooltip on hover or keyboard focus, and is also the
// accessible name. With `href` it becomes a link that opens in a new tab.
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
