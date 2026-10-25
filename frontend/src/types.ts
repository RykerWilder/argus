// Tipi condivisi di Argus: indicatori, risposte del backend, report costruiti dal
// frontend e report dell'analisi email. Qui non c'è codice eseguibile.
//
// Le risposte del backend (FastAPI) non vengono validate a runtime: i tipi
// descrivono quello che il backend invia oggi (vedi backend/routers/*.py). I
// campi che il frontend tratta come facoltativi sono dichiarati facoltativi.

// ── Indicatori ─────────────────────────────────────────────

export type TargetKind = "ip" | "domain" | "url";

export interface IpTarget {
  kind: "ip";
  value: string;
}
export interface DomainTarget {
  kind: "domain";
  value: string;
}
export interface UrlTarget {
  kind: "url";
  value: string;
  host: string;
  hostIsIp: boolean;
}
/** Un indicatore valido, già riconosciuto da `classify()`. */
export type Target = IpTarget | DomainTarget | UrlTarget;

export interface InvalidTarget {
  kind: "invalid";
  error: string;
}
export type ClassifiedTarget = Target | InvalidTarget;

/** Quanto basta per costruire un percorso o una versione "defanged". */
export interface TargetRef {
  kind: TargetKind;
  value: string;
}

// ── Fonti ──────────────────────────────────────────────────

export type SourceId = "iptracker" | "proxycheck" | "abuseipdb" | "domainwhois" | "virustotal";

export interface Source {
  id: SourceId;
  name: string;
  covers: string;
  /** Percorso sotto /api, se diverso dall'id. */
  endpoint?: string;
}

// ── Risposte del backend ───────────────────────────────────

/** Prefisso BGP (Team Cymru). */
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
  // solo domini
  popularity?: VtPopularity[];
  dnsRecords?: VtDnsRecord[];
  certificate?: VtCertificate | null;
  registrar?: string | null;
  createdAt?: string | null;
  // solo URL
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

/** Il corpo della risposta di ogni fonte, per id. */
export interface SourceDataMap {
  iptracker: IpTrackerData;
  proxycheck: ProxyCheckData;
  abuseipdb: AbuseIpdbData;
  domainwhois: DomainWhoisData;
  virustotal: VirusTotalData;
}
export type SourceData = SourceDataMap[SourceId];

// ── Ricerca ────────────────────────────────────────────────

export type ResultStatus = "pending" | "ok" | "error";

export type SourceResult =
  | { status: "pending" }
  | { status: "ok"; data: SourceData; ms: number }
  | { status: "error"; error: string; code?: number; ms: number };

export type SourceError = Extract<SourceResult, { status: "error" }>;

/** Un risultato per ogni fonte interrogata (assente se non interrogata). */
export type LookupResults = Partial<Record<SourceId, SourceResult>>;

export interface Lookup {
  target: Target;
  /** Solo per le ricerche di un indirizzo IP. */
  ip?: string;
  finishedAt: number;
  results: LookupResults;
}

// ── Report ─────────────────────────────────────────────────

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
  /** Nome della fonte che riporta un valore diverso. */
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

/** Il report di un indicatore: IP oppure dominio/URL. */
export type Report = IpReport | DomainReport;

// ── Cronologia ─────────────────────────────────────────────

export interface HistoryEntry {
  id: number;
  kind: TargetKind;
  value: string;
  firstSearchedAt: string;
  lastSearchedAt: string;
  times: number;
  verdictLevel: VerdictLevel;
  verdictTitle: string | null;
  summary: string | null;
}

export interface HistoryData {
  entries: HistoryEntry[];
  counts: Partial<Record<TargetKind, number>>;
}

// ── Mappa ──────────────────────────────────────────────────

/** Una tappa numerata su un percorso (per esempio un server attraversato da un'email). */
export interface RouteStop {
  lat: number;
  lon: number;
  countryCode?: string | null;
  label: string;
  title?: string;
}

// ── Analisi email (POST /api/email/analyze) ────────────────

export interface EmailAddress {
  name: string | null;
  address: string | null;
  domain: string | null;
}

export interface EmailSummary {
  subject: string | null;
  from: EmailAddress | null;
  sender: EmailAddress | null;
  replyTo: EmailAddress[];
  returnPath: EmailAddress | null;
  to: EmailAddress[];
  cc: EmailAddress[];
  date: string | null;
  dateIso: string | null;
  messageId: string | null;
  mailer: string | null;
}

export interface AuthMethod {
  method: string;
  result: string | null;
  comment?: string | null;
  props?: Record<string, string | null | undefined>;
  policy?: { p?: string | null } | null;
  server?: string | null;
}

export interface DkimSignature {
  domain: string | null;
  selector: string | null;
  algorithm: string | null;
  headers: string[];
}

export interface AuthResults {
  server?: string | null;
  methods: AuthMethod[];
}

export interface EmailAuthentication {
  spf: AuthMethod | null;
  dkim: AuthMethod | null;
  dkimAll: AuthMethod[];
  dmarc: AuthMethod | null;
  arc: AuthMethod | null;
  compauth: AuthMethod | null;
  signatures: DkimSignature[];
  results: AuthResults[];
  arcResults: AuthResults[];
}

export interface SpamResult {
  engine: string;
  value: string | null;
  detail?: string | null;
  spam: boolean;
}

export interface EmailHop {
  index: number;
  from: { host: string | null; rdns: string | null; ip: string | null; public: boolean } | null;
  by: { host: string | null; ip: string | null } | null;
  protocol: string | null;
  tls: boolean;
  tlsVersion: string | null;
  id: string | null;
  for: string | null;
  date: string | null;
  delaySeconds: number | null;
  raw: string;
}

export interface EmailOrigin {
  ip: string;
  host: string | null;
  hop: number | null;
  source: string;
}

export interface EmailFinding {
  level: string;
  title: string;
  detail?: string | null;
}

export interface EmailIndicators {
  ips: { value: string; role: string; host: string | null }[];
  domains: { value: string; role: string }[];
  emails: { value: string; role: string }[];
  urls: string[];
}

export interface EmailAttachment {
  filename: string;
  /** Il backend invia il nome in snake_case (dataclass serializzata così com'è). */
  content_type: string | null;
  size: number;
  sha256: string;
  sha1: string;
  md5: string;
}

export interface EmailGeo {
  country: string | null;
  countryCode: string | null;
  region: string | null;
  city: string | null;
  lat: number;
  lon: number;
  isp: string | null;
  org: string | null;
  as: string | null;
}

export interface EmailReport {
  source: "headers" | "eml" | "msg";
  summary: EmailSummary;
  authentication: EmailAuthentication;
  spam: SpamResult[];
  hops: EmailHop[];
  origin: EmailOrigin | null;
  transitSeconds: number | null;
  findings: EmailFinding[];
  verdict: Verdict;
  indicators: EmailIndicators;
  attachments: EmailAttachment[];
  headers: { name: string; value: string }[];
  notes: string[];
  bodyIncluded: boolean;
  geo: Record<string, EmailGeo>;
}
