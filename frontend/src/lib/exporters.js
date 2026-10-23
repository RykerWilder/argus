// Esportazione di un report in JSON, Markdown o STIX 2.1 (toCSV resta disponibile
// nel codice ma non è più nel menu).
// Tutto avviene nel browser: si costruisce un modello comune dal report (IP,
// dominio o URL) e da quello si generano i tre formati.

import { defang } from "./defang";

// ── modello comune ─────────────────────────────────────────

export function exportModel(report, target) {
  const generatedAt = new Date().toISOString();
  const keyFacts = (report.highlights || [])
    .filter((h) => h.value)
    .map((h) => ({ label: h.label, value: h.value, detail: h.sub || "" }));

  const sections = (report.panels || []).map((p) => ({
    source: p.name,
    status: p.status,
    error: p.error || null,
    rows: (p.rows || []).map((r) => ({ label: r.label, value: r.value })),
  }));

  const extra = [];
  if (target.kind === "ip") {
    if (report.cidr) {
      sections.unshift({
        source: report.cidr.source || "BGP",
        status: "ok",
        rows: [
          { label: "CIDR", value: report.cidr.cidr },
          report.cidr.firstAddress && { label: "Address range", value: `${report.cidr.firstAddress} – ${report.cidr.lastAddress}` },
          report.cidr.size && { label: "Addresses", value: String(report.cidr.size) },
          report.cidr.registry && { label: "Registry", value: report.cidr.registry },
        ].filter(Boolean),
      });
    }
    const abuse = (report.panels || []).find((p) => p.id === "abuseipdb");
    if (abuse?.categories?.length) {
      extra.push({ title: "AbuseIPDB categories", columns: ["Category", "Reports"], rows: abuse.categories.map((c) => [c.name, String(c.count)]) });
    }
    if (abuse?.reports?.length) {
      extra.push({
        title: "AbuseIPDB reports",
        columns: ["Reported at (UTC)", "Reporter", "Country", "Categories", "Comment"],
        rows: abuse.reports.map((r) => [
          r.reportedAt || "",
          r.reporterId ? `#${r.reporterId}` : "anonymous",
          r.reporterCountryName || r.reporterCountry || "",
          (r.categories || []).join(", "),
          r.comment || "",
        ]),
      });
    }
  } else {
    const ips = [...(report.resolves?.ipv4 || []), ...(report.resolves?.ipv6 || [])];
    if (ips.length) extra.push({ title: "Resolves to", columns: ["IP address"], rows: ips.map((ip) => [ip]) });
    if (report.flagged?.length) {
      extra.push({ title: "VirusTotal engines flagging it", columns: ["Engine", "Category", "Result"], rows: report.flagged.map((f) => [f.engine, f.category, f.result || ""]) });
    }
    if (report.dnsRecords?.length) {
      extra.push({ title: "DNS records", columns: ["Type", "Value", "TTL"], rows: report.dnsRecords.map((r) => [r.type, r.value, r.ttl ?? ""]) });
    }
    if (report.redirects?.length) {
      extra.push({ title: "Redirect chain", columns: ["Step", "URL"], rows: report.redirects.map((u, i) => [String(i + 1), u]) });
    }
  }

  return {
    kind: target.kind,
    value: target.value,
    defanged: defang(target),
    generatedAt,
    verdict: report.verdict,
    keyFacts,
    sections,
    extra,
    report,
  };
}

// ── file ───────────────────────────────────────────────────

export function fileName(model, ext) {
  const safe = model.value.replace(/^https?:\/\//, "").replace(/[^a-z0-9.-]+/gi, "_").slice(0, 60);
  return `argus-${model.kind}-${safe}-${model.generatedAt.slice(0, 10)}.${ext}`;
}

export function download(content, name, type) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// ── CSV ────────────────────────────────────────────────────

// I valori arrivano da fonti esterne (commenti dei report, titoli di pagina):
// quelli che iniziano con = + - @ vengono preceduti da ' per evitare che un
// foglio di calcolo li esegua come formule.
function cell(v) {
  let s = v === null || v === undefined ? "" : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCSV(model) {
  const lines = [["section", "field", "value", "detail"]];
  lines.push(["Indicator", "Type", model.kind, ""]);
  lines.push(["Indicator", "Value", model.value, ""]);
  lines.push(["Indicator", "Defanged", model.defanged, ""]);
  lines.push(["Indicator", "Generated at (UTC)", model.generatedAt, ""]);
  if (model.verdict) lines.push(["Verdict", model.verdict.title, (model.verdict.reasons || []).join("; "), ""]);
  for (const f of model.keyFacts) lines.push(["Key facts", f.label, f.value, f.detail]);
  for (const s of model.sections) {
    if (s.status === "error") lines.push([s.source, "Error", s.error || "Unavailable", ""]);
    for (const r of s.rows) lines.push([s.source, r.label, r.value, ""]);
  }
  for (const t of model.extra) {
    for (const row of t.rows) lines.push([t.title, row[0], row[1] ?? "", row.slice(2).filter((v) => v !== "").join(" | ")]);
  }
  return "﻿" + lines.map((l) => l.map(cell).join(",")).join("\r\n") + "\r\n";
}

// ── Markdown ───────────────────────────────────────────────

const md = (v) =>
  String(v ?? "")
    .replace(/\|/g, "\\|")
    .replace(/\r?\n/g, "<br>")
    .replace(/([*_`[\]<>])/g, "\\$1")
    .replace(/\\<br\\>/g, "<br>");

function table(columns, rows) {
  return [
    `| ${columns.map(md).join(" | ")} |`,
    `| ${columns.map(() => "---").join(" | ")} |`,
    ...rows.map((r) => `| ${r.map(md).join(" | ")} |`),
  ].join("\n");
}

export function toMarkdown(model) {
  const kindLabel = { ip: "IP address", domain: "Domain", url: "URL" }[model.kind];
  const out = [
    `# Argus report: \`${model.defanged}\``,
    "",
    `- **Type:** ${kindLabel}`,
    `- **Indicator (defanged):** \`${model.defanged}\``,
    `- **Generated:** ${model.generatedAt.replace("T", " ").slice(0, 16)} UTC`,
  ];
  if (model.verdict) {
    out.push(`- **Verdict:** ${md(model.verdict.title)}${model.verdict.reasons?.length ? ` (${md(model.verdict.reasons.join(", "))})` : ""}`);
  }
  if (model.keyFacts.length) {
    out.push("", "## Key facts", "", table(["Fact", "Value", "Detail"], model.keyFacts.map((f) => [f.label, f.value, f.detail])));
  }
  for (const s of model.sections) {
    out.push("", `## ${md(s.source)}`, "");
    if (s.status === "error") out.push(`_Unavailable: ${md(s.error || "no data")}_`);
    else if (!s.rows.length) out.push("_All values are already listed above._");
    else out.push(table(["Field", "Value"], s.rows.map((r) => [r.label, r.value])));
  }
  for (const t of model.extra) {
    const rows = t.rows.slice(0, 200);
    out.push("", `## ${md(t.title)}`, "", table(t.columns, rows));
    if (t.rows.length > rows.length) out.push("", `_${t.rows.length - rows.length} more not shown._`);
  }
  out.push("", "---", "_Generated by Argus._", "");
  return out.join("\n");
}

// ── STIX 2.1 ───────────────────────────────────────────────

const ARGUS_IDENTITY = "identity--5b6f1c3e-7a2d-4c8b-9e1f-0a4d2b6c8e10";
const uuid = () =>
  globalThis.crypto?.randomUUID?.() ??
  "10000000-1000-4000-8000-100000000000".replace(/[018]/g, (c) =>
    (c ^ (Math.random() * 16) >> (c / 4)).toString(16),
  );
const quote = (v) => String(v).replace(/\\/g, "\\\\").replace(/'/g, "\\'");

function scoFor(kind, value) {
  if (kind === "ip") {
    const type = value.includes(":") ? "ipv6-addr" : "ipv4-addr";
    return { type, spec_version: "2.1", id: `${type}--${uuid()}`, value };
  }
  if (kind === "domain") return { type: "domain-name", spec_version: "2.1", id: `domain-name--${uuid()}`, value };
  return { type: "url", spec_version: "2.1", id: `url--${uuid()}`, value };
}

function indicatorTypes(model) {
  const r = model.report;
  const types = new Set();
  const level = model.verdict?.level;
  if (level === "high") types.add("malicious-activity");
  else if (level === "medium") types.add("anomalous-activity");
  else if (level === "low") types.add("benign");
  else types.add("unknown");
  const vpn = r.highlights?.find((h) => h.key === "vpn");
  if (vpn?.detected) types.add("anonymization");
  return [...types];
}

function confidence(model) {
  const r = model.report;
  if (model.kind === "ip") {
    const scores = [r.abuseScore, r.risk].filter((v) => typeof v === "number");
    return scores.length ? Math.max(...scores) : undefined;
  }
  const d = r.detectionScore;
  return d && d.percent !== undefined ? Math.round(Math.min(100, d.value * 10)) : undefined;
}

export function toSTIX(model) {
  const now = model.generatedAt;
  const identity = {
    type: "identity",
    spec_version: "2.1",
    id: ARGUS_IDENTITY,
    created: "2026-01-01T00:00:00.000Z",
    modified: "2026-01-01T00:00:00.000Z",
    name: "Argus",
    identity_class: "system",
  };
  const sco = scoFor(model.kind, model.value);
  const objects = [identity, sco];

  // IP a cui risolve il dominio
  if (model.kind !== "ip") {
    const ips = [...(model.report.resolves?.ipv4 || []), ...(model.report.resolves?.ipv6 || [])];
    const ipObjs = ips.map((ip) => scoFor("ip", ip));
    if (ipObjs.length && model.kind === "domain") sco.resolves_to_refs = ipObjs.map((o) => o.id);
    objects.push(...ipObjs);
  }

  const description = [
    model.verdict ? `Verdict: ${model.verdict.title}.` : null,
    model.verdict?.reasons?.length ? `Reasons: ${model.verdict.reasons.join(", ")}.` : null,
    ...model.keyFacts.map((f) => `${f.label}: ${f.value}${f.detail ? ` (${f.detail})` : ""}.`),
  ]
    .filter(Boolean)
    .join(" ");

  const conf = confidence(model);
  const indicator = {
    type: "indicator",
    spec_version: "2.1",
    id: `indicator--${uuid()}`,
    created: now,
    modified: now,
    created_by_ref: ARGUS_IDENTITY,
    name: `Argus: ${model.defanged}`,
    description,
    indicator_types: indicatorTypes(model),
    pattern: `[${sco.type}:value = '${quote(model.value)}']`,
    pattern_type: "stix",
    pattern_version: "2.1",
    valid_from: now,
    ...(conf !== undefined ? { confidence: Math.round(conf) } : {}),
    labels: ["argus", model.kind],
  };
  objects.push(indicator, {
    type: "relationship",
    spec_version: "2.1",
    id: `relationship--${uuid()}`,
    created: now,
    modified: now,
    created_by_ref: ARGUS_IDENTITY,
    relationship_type: "based-on",
    source_ref: indicator.id,
    target_ref: sco.id,
  });

  const noteLines = model.sections
    .filter((s) => s.status !== "error" && s.rows.length)
    .map((s) => `${s.source}\n${s.rows.map((r) => `  ${r.label}: ${String(r.value).replace(/\n/g, ", ")}`).join("\n")}`);
  if (noteLines.length) {
    objects.push({
      type: "note",
      spec_version: "2.1",
      id: `note--${uuid()}`,
      created: now,
      modified: now,
      created_by_ref: ARGUS_IDENTITY,
      abstract: `Argus lookup of ${model.defanged}`,
      content: noteLines.join("\n\n"),
      object_refs: [indicator.id, sco.id],
    });
  }

  return JSON.stringify({ type: "bundle", id: `bundle--${uuid()}`, objects }, null, 2);
}

// ── JSON (risposte grezze delle fonti) ────────────────────

export function toJSON(model) {
  const sources = model.report.sources || {};
  const payload = Object.fromEntries(
    Object.entries(sources).map(([k, v]) => [k, v.status === "ok" ? v.data : { error: v.error }]),
  );
  return JSON.stringify({ query: model.value, type: model.kind, generatedAt: model.generatedAt, ...payload }, null, 2);
}

export const FORMATS = [
  { id: "json", label: "JSON", hint: "Raw answers from every source", ext: "json", type: "application/json", build: toJSON },
  { id: "md", label: "Markdown", hint: "Tickets and notes", ext: "md", type: "text/markdown;charset=utf-8", build: toMarkdown },
  { id: "stix", label: "STIX 2.1", hint: "MISP, OpenCTI and other TIPs", ext: "stix.json", type: "application/json", build: toSTIX },
];
