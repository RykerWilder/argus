import { useEffect, useRef, useState } from "react";
import { Copy, ExternalLink } from "lucide-react";
import IconButton from "./IconButton";
import { copyText } from "../lib/clipboard";

// Strumenti nell'intestazione di ogni riquadro: copia dei soli risultati del
// riquadro e link alla pagina di analisi sul sito del servizio.
export default function PanelTools({ name, getText, link, children }) {
  const [done, setDone] = useState(false);
  const timer = useRef(0);
  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    if (await copyText(getText())) {
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
