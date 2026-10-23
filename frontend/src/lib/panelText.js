// Testo dei risultati di un solo riquadro, per copiarlo negli appunti.

export function panelText({ source, subject, rows = [], sections = [], error }) {
  const lines = [`${source} results for ${subject}`, ""];
  if (error) {
    lines.push(`Unavailable: ${error}`);
    return lines.join("\n");
  }
  const width = Math.min(28, Math.max(0, ...rows.map((r) => r.label.length)));
  for (const r of rows) {
    const [first, ...rest] = String(r.value).split("\n");
    lines.push(`${r.label.padEnd(width)}  ${first}`);
    for (const more of rest) lines.push(`${" ".repeat(width)}  ${more}`);
    if (r.differs) lines.push(`${" ".repeat(width)}  (differs from ${r.differs})`);
  }
  for (const s of sections) {
    if (!s.lines?.length) continue;
    lines.push("", `${s.title}:`);
    for (const l of s.lines) lines.push(`  ${l}`);
  }
  return lines.join("\n").trimEnd() + "\n";
}
