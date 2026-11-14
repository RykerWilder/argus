import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { DomainTarget, FqdnResponse, UrlTarget } from "../../types";
import { request } from "../../lib/api";
import { buildAnatomy, guessParts } from "../../lib/report/anatomy";
import type { HostParts } from "../../lib/report/anatomy";

// The whole domain or URL, split into its parts. Hovering (or tabbing to) a part
// highlights it and shows what it represents below.
//
// Animations: the parts enter one after another, a bar slides under the indicated
// part, the others dim and the explanation enters from below. With "reduce motion"
// only the color changes remain.

const STAGGER_MS = 35;
const STAGGER_MAX = 900;

export default function Anatomy({ target }: { target: DomainTarget | UrlTarget }) {
  const host = target.kind === "url" ? target.host : target.value;
  const hostIsIp = target.kind === "url" && target.hostIsIp;
  const [parts, setParts] = useState<HostParts | null>(() => (hostIsIp ? null : guessParts(host)));
  const [active, setActive] = useState<number | null>(null);
  const [marker, setMarker] = useState<{ left: number; top: number; width: number } | null>(null);
  const valueRef = useRef<HTMLDivElement>(null);
  const segRefs = useRef<(HTMLSpanElement | null)[]>([]);

  useEffect(() => {
    if (hostIsIp) return;
    const controller = new AbortController();
    setParts(guessParts(host));
    // if the backend does not answer, the browser's guessed split stays
    request<FqdnResponse>(`/api/fqdn?host=${encodeURIComponent(host)}`, { signal: controller.signal, timeout: 8_000 })
      .then((data) => {
        if (!controller.signal.aborted && data?.suffix) setParts({ ...data, suffix: data.suffix, guessed: false });
      })
      .catch(() => {});
    return () => controller.abort();
  }, [host, hostIsIp]);

  const segments = useMemo(() => buildAnatomy(target, parts), [target, parts]);
  const current = active !== null ? segments[active] : null;

  // position of the bar under the active part (also follows line wraps)
  useLayoutEffect(() => {
    if (active === null) return;
    const el = segRefs.current[active];
    const box = valueRef.current;
    if (!el || !box) return;
    const rects = el.getClientRects();
    const r = rects[rects.length - 1] || el.getBoundingClientRect();
    const b = box.getBoundingClientRect();
    setMarker({ left: r.left - b.left, top: r.bottom - b.top, width: r.width });
  }, [active, segments]);

  // order of entry: only the real parts, separators follow the previous one
  let order = 0;

  return (
    <section className="anatomy" aria-label={`Parts of the ${target.kind === "url" ? "URL" : "domain"}`}>
      <p className="anatomy__label muted">
        {target.kind === "url" ? "Anatomy of the URL" : "Anatomy of the domain"}
      </p>
      <div className="anatomy__stage" ref={valueRef}>
        <p
          className={`anatomy__value mono ${active !== null ? "has-active" : ""}`}
          onPointerLeave={() => setActive(null)}
        >
          {segments.map((s, i) => {
            const delay = Math.min(STAGGER_MAX, order * STAGGER_MS);
            if (s.type !== "sep") order += 1;
            return s.type === "sep" ? (
              <span key={i} className="anatomy__sep" style={{ animationDelay: `${delay}ms` }}>
                {s.text}
              </span>
            ) : (
              <span
                key={i}
                ref={(el) => {
                  segRefs.current[i] = el;
                }}
                className={`anatomy__seg anatomy__seg--${s.type} ${active === i ? "is-active" : ""}`}
                style={{ animationDelay: `${delay}ms` }}
                tabIndex={0}
                onPointerEnter={() => setActive(i)}
                onFocus={() => setActive(i)}
                onBlur={() => setActive((a) => (a === i ? null : a))}
                aria-describedby="anatomy-caption"
              >
                {s.text}
              </span>
            );
          })}
        </p>
        <span
          className={`anatomy__marker ${active !== null && marker ? "is-visible" : ""}`}
          style={marker ? { transform: `translate(${marker.left}px, ${marker.top}px)`, width: marker.width } : undefined}
          aria-hidden="true"
        />
      </div>
      <div id="anatomy-caption" className="anatomy__caption" aria-live="polite">
        {current ? (
          <div key={active} className="anatomy__caption-inner">
            <strong>{current.title}</strong>
            <span className="mono anatomy__part">{current.text}</span>
            <p>{current.body}</p>
          </div>
        ) : (
          <div key="idle" className="anatomy__caption-inner">
            <p className="muted">
              Point at a part to see what it is.
              {parts?.guessed && !hostIsIp && " Suffix detection is approximate until the backend responds."}
            </p>
          </div>
        )}
      </div>
    </section>
  );
}
