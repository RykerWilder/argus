import { useEffect, useRef, useState } from "react";
import { Braces, Copy, Download, FileText, Link2Off, Share2 } from "lucide-react";
import IconButton from "./IconButton";
import { copyText } from "../lib/clipboard";
import { defang } from "../lib/defang";
import { FORMATS, download, exportModel, fileName } from "../lib/exporters";

// Azioni sull'indicatore, accanto al titolo del risultato. Sono pulsanti a
// icona: il nome compare in un tooltip al passaggio del mouse o con il focus da
// tastiera, ed è anche il nome accessibile del pulsante.

const FORMAT_ICONS = { json: Braces, md: FileText, stix: Share2 };

export default function ActionBar({ target, report }) {
  const [done, setDone] = useState(null); // "copy" | "defang"
  const [status, setStatus] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef(null);
  const timer = useRef(0);
  const defanged = defang(target);

  useEffect(() => () => clearTimeout(timer.current), []);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e) => {
      if (!menuRef.current?.contains(e.target)) setMenuOpen(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") {
        setMenuOpen(false);
        menuRef.current?.querySelector(".icon-btn")?.focus();
      }
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    menuRef.current?.querySelector("[role=menuitem]")?.focus();
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  function flash(message, which = null) {
    setStatus(message);
    setDone(which);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setStatus("");
      setDone(null);
    }, 1800);
  }

  async function copy(text, which) {
    const ok = await copyText(text);
    flash(ok ? `Copied ${text}` : "Copy failed: select the text and copy it manually", ok ? which : null);
  }

  function exportAs(format) {
    setMenuOpen(false);
    const model = exportModel(report, target);
    download(format.build(model), fileName(model, format.ext), format.type);
    flash(`Exported ${format.label}`);
  }

  function onMenuKey(e) {
    const items = [...menuRef.current.querySelectorAll("[role=menuitem]")];
    const i = items.indexOf(document.activeElement);
    if (e.key === "ArrowDown") items[(i + 1) % items.length]?.focus();
    else if (e.key === "ArrowUp") items[(i - 1 + items.length) % items.length]?.focus();
    else return;
    e.preventDefault();
  }

  return (
    <div className="actions">
      <IconButton label="Copy" icon={Copy} done={done === "copy"} onClick={() => copy(target.value, "copy")} />
      <IconButton
        label="Copy defanged"
        icon={Link2Off}
        done={done === "defang"}
        onClick={() => copy(defanged, "defang")}
      />
      <div className="actions__menu" ref={menuRef}>
        <IconButton
          label="Export"
          icon={Download}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((o) => !o)}
        />
        {menuOpen && (
          <div className="actions__list" role="menu" aria-label="Export format" onKeyDown={onMenuKey}>
            {FORMATS.map((f) => {
              const Icon = FORMAT_ICONS[f.id] || FileText;
              return (
                <button key={f.id} type="button" role="menuitem" onClick={() => exportAs(f)}>
                  <Icon size={16} strokeWidth={1.75} aria-hidden="true" />
                  <span className="actions__item">
                    <span>{f.label}</span>
                    <span className="muted">{f.hint}</span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
      <span className="actions__status mono" role="status" aria-live="polite">
        {status}
      </span>
    </div>
  );
}
