import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Copy, ExternalLink } from "lucide-react";
import IconButton from "./IconButton";
import { copyText } from "../lib/clipboard";
import type { SourceLink } from "../lib/panelLinks";

interface PanelToolsProps {
  /** Nome della fonte, per l'etichetta del pulsante di copia. */
  name: string;
  /** Testo da copiare; senza, il pulsante non compare. */
  getText?: () => string;
  link?: SourceLink | null;
  children?: ReactNode;
}

// Strumenti nell'intestazione di ogni riquadro: copia dei soli risultati del
// riquadro e link alla pagina di analisi sul sito del servizio.
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
