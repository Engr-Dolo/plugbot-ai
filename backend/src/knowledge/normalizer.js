import crypto from "node:crypto";

export function normalizeText(value) {
  return String(value || "")
    .replace(/\u0000/g, "")
    .replace(/[ \t\f\v]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function dedupeSections(sections) {
  const seen = new Set();
  const result = [];

  for (const section of sections) {
    const text = normalizeText(section.text);
    const key = text.toLowerCase();
    if (!text || seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push({ ...section, text });
  }

  return result;
}

export function contentHash(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

export function truncateText(value, maxLength) {
  const text = normalizeText(value);
  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, maxLength - 15).trim()} [truncated]`;
}
