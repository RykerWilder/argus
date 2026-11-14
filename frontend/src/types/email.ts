import type { Verdict } from "./report";

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
  /** The backend sends the name in snake_case (dataclass serialized as is). */
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
