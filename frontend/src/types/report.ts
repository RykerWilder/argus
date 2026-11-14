import type { LookupResults, ResultStatus } from "./lookup";
import type { AbuseCategory, AbuseReport, Cidr, DailyCount, ProxyOperator, ResolvedIps, VtCertificate, VtDnsRecord, VtFlagged, VtPopularity } from "./responses";
import type { Source } from "./source";

export type VerdictLevel = "high" | "medium" | "low" | "unknown";

export interface Verdict {
  level: VerdictLevel;
  title: string;
  reasons: string[];
}

export interface Row {
  label: string;
  value: string;
  mono?: boolean;
  highlight?: boolean;
  /** Name of the source that reports a different value. */
  differs?: string;
}

export interface Highlight {
  key: string;
  label: string;
  value: string | null;
  sub?: string | null;
  detected?: boolean;
  kind?: "mobile" | "fixed" | null;
}

interface ReportPanelBase extends Source {
  status: ResultStatus;
  error?: string;
  ms?: number;
  rows: Row[];
}

export interface IpReportPanel extends ReportPanelBase {
  // ProxyCheck.io
  operator?: ProxyOperator | null;
  warning?: string | null;
  // AbuseIPDB
  categories?: AbuseCategory[];
  reports?: AbuseReport[];
  reportWindow?: number;
  daily?: DailyCount[];
  reportsReceived?: number;
  totalReports?: number;
  remarks?: string[];
  // Shodan
  vulns?: string[];
  /** Text shown in place of the rows when the source has no data. */
  emptyText?: string;
}

export interface IpReport {
  ip: string;
  version: 4 | 6;
  location: {
    countryCode: string | null;
    country: string | null;
    city: string | null;
    region: string | null;
    lat: number | null;
    lon: number | null;
  };
  cidr: Cidr | null;
  highlights: Highlight[];
  verdict: Verdict;
  abuseScore: number | null;
  risk: number | null;
  panels: IpReportPanel[];
  allPrivate: boolean;
  sources: LookupResults;
}

export type DomainReportPanel = ReportPanelBase;

export interface DomainReport {
  kind: "domain" | "url";
  title: string;
  subtitle: string | null;
  hostIsIp: boolean;
  verdict: Verdict;
  detectionScore: { value: number; suffix: string; percent: number } | null;
  reputation: number | null;
  highlights: Highlight[];
  panels: DomainReportPanel[];
  resolves: ResolvedIps;
  flagged: VtFlagged[];
  dnsRecords: VtDnsRecord[];
  certificate: VtCertificate | null;
  popularity: VtPopularity[];
  redirects: string[];
  vtNotFound: boolean;
  vtQueued: boolean;
  allFailed: boolean;
  sources: LookupResults;
}

/** The report of an indicator: IP or domain/URL. */
export type Report = IpReport | DomainReport;
