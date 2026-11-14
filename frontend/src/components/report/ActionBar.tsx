import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent } from "react";
import { Braces, Copy, Download, FileText, Link2Off, Share2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import type { Report, Target } from "../../types";
import IconButton from "../ui/IconButton";
import { copyText } from "../../lib/clipboard";
import { defang } from "../../lib/search/defang";
import { FORMATS, download, exportModel, fileName } from "../../lib/report/exporters";
import type { ExportFormat } from "../../lib/report/exporters";

// Actions on the indicator, next to the result title. They are icon buttons: the name
// appears in a tooltip on hover or keyboard focus, and is also the button's accessible name.

const FORMAT_ICONS: Record<string, LucideIcon> = { json: Braces, md: FileText, stix: Share2 };

type Done = "copy" | "defang";

export default function ActionBar({ target, report }: { target: Target; report: Report }) {
  const [done, setDone] = useState<Done | null>(null);
  const [status, setStatus] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const defanged = defang(target);

  useEffect(() => () => clearTimeout(timer.current), []);

  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setMenuOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setMenuOpen(false);
        menuRef.current?.querySelector<HTMLElement>(".icon-btn")?.focus();
      }
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    menuRef.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  function flash(message: string, which: Done | null = null) {
    setStatus(message);
    setDone(which);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setStatus("");
      setDone(null);
    }, 1800);
  }

  async function copy(text: string, which: Done) {
    const ok = await copyText(text);
    flash(ok ? `Copied ${text}` : "Copy failed: select the text and copy it manually", ok ? which : null);
  }

  function exportAs(format: ExportFormat) {
    setMenuOpen(false);
    const model = exportModel(report, target);
    download(format.build(model), fileName(model, format.ext), format.type);
    flash(`Exported ${format.label}`);
  }

  function onMenuKey(e: ReactKeyboardEvent<HTMLDivElement>) {
    if (!menuRef.current) return;
    const items = [...menuRef.current.querySelectorAll<HTMLElement>("[role=menuitem]")];
    const i = items.indexOf(document.activeElement as HTMLElement);
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
