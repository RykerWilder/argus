// Defang: makes an indicator non-clickable so it can be pasted into tickets, emails and
// chats safely (8.8.8[.]8 / example[.]com / hxxps[://]example[.]com/x).
// Refang: the inverse operation, applied to what is typed into the search.

import type { TargetRef } from "../../types";

const dots = (s: string) => s.replace(/\./g, "[.]");

export function defang(target: TargetRef | null | undefined): string {
  if (!target) return "";
  if (target.kind === "ip") {
    return target.value.includes(":") ? target.value.replace(/:/g, "[:]") : dots(target.value);
  }
  if (target.kind === "domain") return dots(target.value);

  // URL: scheme, separator and host dots; the rest stays readable
  let url: URL;
  try {
    url = new URL(target.value);
  } catch {
    return dots(target.value).replace(/^http/i, "hxxp");
  }
  const scheme = url.protocol.replace(":", "").replace(/^http/i, "hxxp");
  const auth = url.username ? `${url.username}${url.password ? `:${url.password}` : ""}[@]` : "";
  const host = url.hostname.startsWith("[")
    ? url.hostname.replace(/:/g, "[:]")
    : dots(url.hostname);
  const port = url.port ? `:${url.port}` : "";
  return `${scheme}[://]${auth}${host}${port}${url.pathname}${url.search}${url.hash}`;
}

export function refang(input: string | null | undefined): string {
  return (input || "")
    .trim()
    .replace(/^h[x*]{2}p(s?)/i, "http$1")
    .replace(/^f[x*]p/i, "ftp")
    .replace(/\[:\/\/\]|\(:\/\/\)|\[:\]\/\//g, "://")
    .replace(/\s*(\[\.\]|\(\.\)|\{\.\}|\[dot\]|\(dot\))\s*/gi, ".")
    .replace(/\[:\]/g, ":")
    .replace(/\[@\]|\[at\]|\(at\)/gi, "@");
}
