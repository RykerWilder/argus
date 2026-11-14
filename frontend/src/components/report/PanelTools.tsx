import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Copy, ExternalLink } from "lucide-react";
import IconButton from "../ui/IconButton";
import { copyText } from "../../lib/clipboard";
import type { SourceLink } from "../../lib/report/panelLinks";

interface PanelToolsProps {
  /** Name of the source, for the copy button's label. */
  name: string;
  /** Text to copy; without it, the button does not appear. */
  getText?: () => string;
  link?: SourceLink | null;
  children?: ReactNode;
}

// Tools in the header of each panel: copy only that panel's results and a link to
// the analysis page on the service's site.
export default function PanelTools({ name, getText, link, children }: PanelToolsProps) {
  const [done, setDone] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    if (getText && (await copyText(getText()))) {
      setDone(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setDone(false), 1600);
    }
  }

  return (
    <div className="panel__tools">
      {children}
      {getText && <IconButton label={`Copy ${name} results`} icon={Copy} done={done} onClick={copy} className="icon-btn--sm" />}
      {link && <IconButton label={link.label} icon={ExternalLink} href={link.href} className="icon-btn--sm" />}
    </div>
  );
}
