
export type SourceId = "iptracker" | "proxycheck" | "abuseipdb" | "shodan" | "domainwhois" | "virustotal";

export interface Source {
  id: SourceId;
  name: string;
  covers: string;
  /** Path under /api, if different from the id. */
  endpoint?: string;
}
