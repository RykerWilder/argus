// Spiegazioni brevi degli header più comuni, mostrate nella tabella degli
// header e accanto ai dati del report.

const EXPLAIN: Record<string, string> = {
  "received": "Added by every server the message passed through. The bottom one is the first server, the top one the last.",
  "x-received": "Extra Received line added by Google's internal servers.",
  "delivered-to": "Mailbox the message was finally delivered to.",
  "return-path": "Envelope sender (MAIL FROM): where bounces go. SPF is checked against this domain.",
  "from": "Sender shown to the reader. Easy to forge: DMARC checks it is aligned with SPF or DKIM.",
  "sender": "Who actually sent the message on behalf of From (e.g. a secretary or a mailing list).",
  "reply-to": "Where replies go. Different from From is a common phishing trick.",
  "to": "Recipients written in the message (not necessarily who received it).",
  "cc": "Recipients in copy.",
  "subject": "Subject line.",
  "date": "When the sender's client says the message was written. Set by the sender, so it can be wrong.",
  "message-id": "Unique identifier created by the sending server or client.",
  "in-reply-to": "Message-ID of the message this one replies to.",
  "references": "Message-IDs of the conversation this message belongs to.",
  "mime-version": "MIME version used to format the message.",
  "content-type": "Format of the message body (plain text, HTML, multipart with attachments…).",
  "content-transfer-encoding": "How the body is encoded for transport (7bit, base64, quoted-printable…).",
  "authentication-results": "Results of SPF, DKIM and DMARC as checked by the receiving server.",
  "arc-authentication-results": "Authentication results kept by ARC when the message is forwarded.",
  "arc-seal": "ARC signature over the chain of forwarding servers.",
  "arc-message-signature": "ARC copy of the DKIM-like signature of the message.",
  "dkim-signature": "Cryptographic signature of the sending domain (d=) over the message.",
  "received-spf": "SPF result recorded by the receiving server: is this server allowed to send for the domain?",
  "x-mailer": "Software used to send the message.",
  "user-agent": "Mail client used to write the message.",
  "x-originating-ip": "IP of the client that submitted the message (added by some webmail services).",
  "x-forefront-antispam-report": "Microsoft 365 spam filter report: SCL is the spam confidence level, SFV the verdict, CIP the connecting IP.",
  "x-ms-exchange-organization-scl": "Microsoft spam confidence level: -1 trusted, 0–1 not spam, 5–6 spam, 9 high-confidence spam.",
  "x-microsoft-antispam": "Microsoft spam filter details; BCL is the bulk mail level.",
  "x-ms-exchange-organization-authas": "How Microsoft 365 authenticated the sender (Anonymous = from the internet).",
  "x-spam-status": "SpamAssassin verdict, score and rules that matched.",
  "x-spam-score": "Spam score assigned by the filter.",
  "x-spam-flag": "YES when the spam filter considers the message spam.",
  "list-unsubscribe": "Link or address to unsubscribe: typical of newsletters and bulk mail.",
  "list-id": "Identifier of the mailing list that sent the message.",
  "precedence": "Bulk or list mail marker.",
  "x-google-smtp-source": "Internal Google tracking value.",
  "x-gm-message-state": "Internal Gmail state.",
  "feedback-id": "Identifier used by large senders to track spam complaints.",
  "x-ms-has-attach": "Microsoft: yes if the message has attachments.",
  "thread-topic": "Outlook conversation topic.",
  "thread-index": "Outlook conversation index.",
  "x-originatororg": "Microsoft 365 organisation that sent the message.",
  "bimi-selector": "Brand logo (BIMI) selector of the sender.",
};

export function explainHeader(name: string | null | undefined): string | null {
  const key = (name || "").toLowerCase();
  if (EXPLAIN[key]) return EXPLAIN[key];
  if (key.startsWith("x-ms-exchange")) return "Microsoft Exchange / Microsoft 365 internal header.";
  if (key.startsWith("x-ms-")) return "Microsoft 365 header.";
  if (key.startsWith("x-google")) return "Google internal header.";
  if (key.startsWith("x-")) return "Custom header added by a server or client (not standard).";
  return null;
}

export const AUTH_EXPLAIN: Record<string, string> = {
  spf: "Is the sending server allowed to send mail for the envelope domain (Return-Path)?",
  dkim: "Is the message signed by the domain in d=, and unchanged since it was signed?",
  dmarc: "Do SPF or DKIM pass for the same domain shown in From? This is what protects the visible sender.",
  arc: "When the message was forwarded, did the earlier authentication results survive?",
  compauth: "Microsoft 365's own verdict, combining SPF, DKIM, DMARC and other signals.",
};
