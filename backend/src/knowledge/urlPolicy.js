import dns from "node:dns/promises";
import net from "node:net";

const defaultDeniedPathPatterns = [
  "/admin",
  "/login",
  "/logout",
  "/account",
  "/dashboard",
  "/api",
  "/private",
  "/internal",
  "/.git",
  "/.env",
  "/config",
  "/secrets",
  "/backup",
  "/backups",
  "/database",
  "/db",
  "/export",
  "/checkout",
  "/payment",
  "/profile",
  ".map",
  ".js",
  ".css"
];

const forbiddenHostnames = new Set([
  "localhost",
  "metadata.google.internal",
  "metadata.azure.com",
  "metadata",
  "instance-data",
  "100.100.100.200",
  "169.254.169.254"
]);

export class UrlPolicyError extends Error {
  constructor(reason, url) {
    super(reason);
    this.name = "UrlPolicyError";
    this.reason = reason;
    this.url = url;
  }
}

export async function validateCrawlUrl(url, botConfig, options = {}) {
  const parsed = parseHttpUrl(url);
  validateProtocol(parsed, options);
  normalizeAllowedPathAlias(parsed, botConfig);
  validateBotScope(parsed, botConfig);
  validateDeniedPath(parsed, botConfig.deniedPathPatterns);
  await validateNetworkTarget(parsed, options);
  return parsed;
}

export function validateDiscoveredUrl(url, baseUrl, botConfig) {
  const parsed = parseHttpUrl(url, baseUrl);
  validateProtocol(parsed);
  normalizeAllowedPathAlias(parsed, botConfig);
  validateBotScope(parsed, botConfig);
  validateDeniedPath(parsed, botConfig.deniedPathPatterns);
  return parsed;
}

function normalizeAllowedPathAlias(parsed, botConfig) {
  for (const prefix of botConfig.allowedPathPrefixes || []) {
    if (prefix.endsWith("/") && parsed.pathname === prefix.slice(0, -1)) {
      parsed.pathname = prefix;
      return;
    }
  }
}

export function parseHttpUrl(url, baseUrl) {
  let parsed;
  try {
    parsed = baseUrl ? new URL(url, baseUrl) : new URL(url);
  } catch {
    throw new UrlPolicyError("URL is invalid.", String(url));
  }

  parsed.hash = "";
  return parsed;
}

export function validateProtocol(parsed, { allowHttp = false } = {}) {
  if (parsed.protocol === "https:") {
    return;
  }

  if (allowHttp && parsed.protocol === "http:") {
    return;
  }

  throw new UrlPolicyError("URL protocol is not allowed.", parsed.href);
}

export function validateBotScope(parsed, botConfig) {
  const allowedOrigins = new Set(botConfig.allowedOrigins || []);
  if (!allowedOrigins.has(parsed.origin)) {
    throw new UrlPolicyError("URL origin is not authorized for this bot.", parsed.href);
  }

  const prefixes = botConfig.allowedPathPrefixes || [];
  if (!prefixes.some((prefix) => parsed.pathname.startsWith(prefix))) {
    throw new UrlPolicyError("URL path is outside the authorized prefix.", parsed.href);
  }
}

export function validateDeniedPath(parsed, deniedPathPatterns = defaultDeniedPathPatterns) {
  const pathname = safeDecodePathname(parsed.pathname).toLowerCase();
  const normalizedPatterns = [
    ...defaultDeniedPathPatterns,
    ...(deniedPathPatterns || [])
  ].map((pattern) => String(pattern).toLowerCase());

  for (const pattern of normalizedPatterns) {
    if (!pattern) {
      continue;
    }

    const denied =
      pattern.startsWith("/")
        ? pathname === pattern ||
          pathname.startsWith(`${pattern}/`) ||
          pathname.endsWith(pattern) ||
          pathname.includes(`${pattern}/`)
        : pathname.endsWith(pattern) || pathname.includes(pattern);

    if (denied) {
      throw new UrlPolicyError("URL path is denied by crawl policy.", parsed.href);
    }
  }
}

function safeDecodePathname(pathname) {
  try {
    return decodeURIComponent(pathname);
  } catch {
    throw new UrlPolicyError("URL path encoding is invalid.", pathname);
  }
}

export async function validateNetworkTarget(parsed, options = {}) {
  const hostname = normalizeHostname(parsed.hostname);

  if (isForbiddenHostname(hostname)) {
    throw new UrlPolicyError("URL hostname is not allowed.", parsed.href);
  }

  if (net.isIP(hostname)) {
    validateIpAddress(hostname, parsed.href);
    return;
  }

  const resolver = options.lookup || defaultLookup;
  let records;
  try {
    records = await resolver(hostname);
  } catch (error) {
    throw new UrlPolicyError("URL hostname could not be resolved safely.", parsed.href);
  }

  for (const record of records) {
    validateIpAddress(record.address || record, parsed.href);
  }
}

export function isForbiddenHostname(hostname) {
  const normalized = normalizeHostname(hostname).replace(/\.$/, "").toLowerCase();
  return (
    forbiddenHostnames.has(normalized) ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local")
  );
}

function normalizeHostname(hostname) {
  return String(hostname || "")
    .trim()
    .replace(/^\[/, "")
    .replace(/\]$/, "")
    .toLowerCase();
}

export function validateIpAddress(address, url = "") {
  if (isForbiddenIpAddress(address)) {
    throw new UrlPolicyError("URL resolves to a forbidden network address.", url);
  }
}

export function isForbiddenIpAddress(address) {
  const ipVersion = net.isIP(address);
  if (ipVersion === 4) {
    return isForbiddenIpv4(address);
  }

  if (ipVersion === 6) {
    return isForbiddenIpv6(address);
  }

  return true;
}

function isForbiddenIpv4(address) {
  const parts = address.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return true;
  }

  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isForbiddenIpv6(address) {
  const normalized = address.toLowerCase();
  if (
    normalized === "::1" ||
    normalized === "::" ||
    normalized.startsWith("fe80:") ||
    normalized.startsWith("fc") ||
    normalized.startsWith("fd")
  ) {
    return true;
  }

  const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) {
    return isForbiddenIpv4(mapped[1]);
  }

  return false;
}

async function defaultLookup(hostname) {
  return dns.lookup(hostname, { all: true, verbatim: true });
}
