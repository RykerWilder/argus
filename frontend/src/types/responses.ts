import type { SourceId } from "./source";

/** BGP prefix (Team Cymru). */
export interface Cidr {
  cidr: string;
  asn?: string | null;
  country?: string | null;
  registry?: string | null;
  allocated?: string | null;
  firstAddress?: string;
  lastAddress?: string;
  size?: number;
  source?: string;
}

export interface IpLocation {
  continent?: string | null;
  continentCode?: string | null;
  country?: string | null;
  countryCode?: string | null;
  region?: string | null;
  regionCode?: string | null;
  city?: string | null;
  district?: string | null;
  zip?: string | null;
  lat?: number | string | null;
  lon?: number | string | null;
  timezone?: string | null;
  utcOffset?: number | null;
  currency?: string | null;
}

export interface IpConnection {
  isp?: string | null;
  org?: string | null;
  asn?: string | null;
  asName?: string | null;
  reverse?: string | null;
  isMobile?: boolean;
  isProxy?: boolean;
  isHosting?: boolean;
}

/** POST /api/iptracker */
export interface IpTrackerData {
  ip: string;
  version: 4 | 6;
  location?: IpLocation;
  connection?: IpConnection;
  network?: Cidr | null;
}

export interface ProxyOperator {
  name?: string | null;
  url?: string | null;
  anonymity?: string | null;
  popularity?: string | null;
  services?: string[];
  protocols?: string[];
  policies?: Record<string, unknown>;
}

export interface ProxyDetections {
  anonymous?: boolean;
  proxy?: boolean;
  vpn?: boolean;
  tor?: boolean;
  hosting?: boolean;
  scraper?: boolean;
  compromised?: boolean;
}

export interface ProxyNetwork {
  asn?: string | null;
  range?: string | null;
  hostname?: string | null;
  provider?: string | null;
  organisation?: string | null;
  type?: string | null;
}

export interface ProxyLocation {
  country?: string | null;
  countryCode?: string | null;
  region?: string | null;
  city?: string | null;
  lat?: number | string | null;
  lon?: number | string | null;
  timezone?: string | null;
}

/** POST /api/shodan (Shodan InternetDB). With no data on an IP: found false and empty lists. */
export interface ShodanData {
  ip: string;
  found: boolean;
  ports: number[];
  hostnames: string[];
  tags: string[];
  /** CVE identifiers, most recent first. */
  vulns: string[];
  /** Detected software, in CPE format (e.g. "cpe:/a:nginx:nginx:1.18.0"). */
  cpes: string[];
}

/** POST /api/proxycheck */
export interface ProxyCheckData {
  ip: string;
  warning?: string | null;
  detections?: ProxyDetections;
  confidence?: number | string | null;
  risk?: number | string | null;
  firstSeen?: string | null;
  lastSeen?: string | null;
  network?: ProxyNetwork;
  location?: ProxyLocation;
  deviceEstimate?: Record<string, unknown> | null;
  operator?: ProxyOperator | null;
  attackHistory?: Record<string, number> | null;
  totalAttacks?: number | null;
}

export interface AbuseReport {
  reportedAt: string;
  comment: string;
  categories: string[];
  reporterId?: number | null;
  reporterCountry?: string | null;
  reporterCountryName?: string | null;
}

export interface AbuseCategory {
  name: string;
  count: number;
}

export interface DailyCount {
  date: string;
  count: number;
}

/** POST /api/abuseipdb */
export interface AbuseIpdbData {
  ip: string;
  maxAgeInDays?: number;
  abuseScore?: number;
  isWhitelisted?: boolean;
  isTor?: boolean;
  countryCode?: string | null;
  usageType?: string | null;
  isp?: string | null;
  domain?: string | null;
  hostnames?: string[];
  totalReports?: number;
  numDistinctUsers?: number;
  lastReportedAt?: string | null;
  categories?: AbuseCategory[];
  reporterCountries?: { code: string; count: number }[];
  reports?: AbuseReport[];
  reportsReceived?: number;
  daily?: DailyCount[];
}

export interface ResolvedIps {
  ipv4: string[];
  ipv6: string[];
}

/** POST /api/domain-whois */
export interface DomainWhoisData {
  query: string;
  domain: string;
  source: string;
  registrar?: string | null;
  registrarIanaId?: string | number | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  expiresAt?: string | null;
  status?: string[];
  nameServers?: string[];
  dnssec?: boolean | null;
  registrant?: { organization?: string | null; country?: string | null };
  abuse?: { emails?: string[]; phones?: string[] };
  whoisServer?: string | null;
  resolves?: ResolvedIps;
}

export interface VtStats {
  malicious: number;
  suspicious: number;
  harmless: number;
  undetected: number;
  timeout: number;
  total: number;
}

export interface VtFlagged {
  engine: string;
  category: "malicious" | "suspicious";
  result?: string | null;
}

export interface VtDnsRecord {
  type: string;
  value: string;
  ttl?: number | null;
}

export interface VtCertificate {
  subject?: string | null;
  issuer?: string | null;
  validFrom?: string | null;
  validTo?: string | null;
}

export interface VtPopularity {
  source: string;
  rank: number;
}

/** POST /api/virustotal (dominio o URL). */
export interface VirusTotalData {
  type: "domain" | "url";
  target: string;
  found: boolean;
  status?: "completed" | "queued";
  stats?: VtStats;
  flagged?: VtFlagged[];
  reputation?: number | null;
  votes?: { harmless: number; malicious: number } | null;
  categories?: string[];
  tags?: string[];
  lastAnalysisAt?: string | null;
  newlySubmitted?: boolean;
  // domains only
  popularity?: VtPopularity[];
  dnsRecords?: VtDnsRecord[];
  certificate?: VtCertificate | null;
  registrar?: string | null;
  createdAt?: string | null;
  // URLs only
  finalUrl?: string | null;
  title?: string | null;
  httpStatus?: number | null;
  redirects?: string[];
  timesSubmitted?: number | null;
  firstSubmittedAt?: string | null;
}

/** GET /api/fqdn */
export interface FqdnResponse {
  host: string;
  isIp: boolean;
  subdomain: string | null;
  domain: string | null;
  suffix: string | null;
  registrable: string | null;
}

/** The response body of each source, by id. */
export interface SourceDataMap {
  iptracker: IpTrackerData;
  proxycheck: ProxyCheckData;
  abuseipdb: AbuseIpdbData;
  shodan: ShodanData;
  domainwhois: DomainWhoisData;
  virustotal: VirusTotalData;
}
export type SourceData = SourceDataMap[SourceId];
