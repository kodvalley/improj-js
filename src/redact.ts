/**
 * Redaction of credentials in text that may end up in logs: error messages,
 * problem details and anything a proxy echoes back. The SDK never logs on its
 * own; this is a second line of defence for applications that log errors.
 */
const TOKEN = /\bimproj_(pat|org)_[A-Za-z0-9]+/g;
const WEBHOOK_SECRET = /\bwhsec_[A-Za-z0-9_-]+/g;
const LEGACY_TOKEN = /\bimp_[A-Za-z0-9]{20,}/g;
const BEARER = /(Bearer\s+)[^\s"',;]+/gi;

/** Replaces tokens, webhook secrets and bearer credentials in `text` with a masked form. */
export function redact(text: string): string {
  let out = String(text);
  out = out.replace(TOKEN, (_m, kind: string) => `improj_${kind}_***`);
  out = out.replace(WEBHOOK_SECRET, "whsec_***");
  out = out.replace(LEGACY_TOKEN, "imp_***");
  out = out.replace(BEARER, "$1***");
  return out;
}

/** Masks a token for display, keeping only its kind prefix and last 4 characters. */
export function maskToken(token: string | undefined | null): string {
  if (!token) return "(none)";
  const m = /^(improj_(?:pat|org)_|imp_)/.exec(token);
  const prefix = m?.[1] ?? "";
  return `${prefix}***${token.length > prefix.length + 8 ? token.slice(-4) : ""}`;
}
