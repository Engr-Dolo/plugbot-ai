import { assessExtractionQuality } from "./extractionQuality.js";
import { normalizeText } from "./normalizer.js";

const contentTagPattern =
  /<(h1|h2|h3|h4|p|li|dt|dd|blockquote|figcaption|button|a)\b([^>]*)>([\s\S]*?)<\/\1>/gi;

export function extractVisibleContent(html, pageUrl) {
  const cleaned = cleanHtml(html);
  const title = extractTitle(cleaned);
  const metaDescription = extractMetaDescription(cleaned);
  const semanticSections = extractSemanticSections(cleaned, pageUrl);
  const sections = dedupeExtractedSections(
    semanticSections.length > 0
      ? semanticSections
      : extractFallbackHeadingSections(cleaned, pageUrl)
  );
  const text = normalizeText(
    [title, metaDescription, ...sections.map((section) => section.text)].join("\n")
  );

  return {
    url: pageUrl,
    title,
    metaDescription,
    text,
    sections,
    diagnostics: collectExtractionDiagnostics(cleaned, text, sections),
    quality: assessExtractionQuality({ title, text, sections })
  };
}

export function cleanHtml(html) {
  return String(html || "")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<nav\b[\s\S]*?<\/nav>/gi, " ")
    .replace(/<template\b[\s\S]*?<\/template>/gi, " ")
    .replace(/<svg\b[\s\S]*?<\/svg>/gi, " ")
    .replace(/<canvas\b[\s\S]*?<\/canvas>/gi, " ");
}

function extractSemanticSections(html, pageUrl) {
  const explicitSections = extractBlocks(
    html,
    /<(section)\b([^>]*)>([\s\S]*?)<\/section>/gi,
    pageUrl
  );

  if (explicitSections.length > 0) {
    return explicitSections;
  }

  return extractBlocks(
    html,
    /<(main|article|header|footer)\b([^>]*)>([\s\S]*?)<\/\1>/gi,
    pageUrl
  );
}

function extractBlocks(html, pattern, pageUrl) {
  const sections = [];
  let match;

  while ((match = pattern.exec(html))) {
    const tag = match[1].toLowerCase();
    const attrs = match[2] || "";
    const body = match[3] || "";

    if (isHidden(attrs) || isLikelyBoilerplate(tag, attrs)) {
      continue;
    }

    const sectionId = extractAttr(attrs, "id");
    const label = firstMeaningful([
      extractHeading(body, ["h1", "h2", "h3", "h4"]),
      extractAttr(attrs, "aria-label"),
      sectionId ? titleize(sectionId) : ""
    ]);
    const lines = collectContentLines(body);
    const text = normalizeText(lines.join("\n"));

    if (isMeaningfulText(text, label)) {
      sections.push({
        id: sectionId || `${tag}-${sections.length + 1}`,
        type: tag,
        heading: label,
        text,
        sourceUrl: sourceWithFragment(pageUrl, sectionId)
      });
    }

    sections.push(...extractNestedHeadingSections(body, pageUrl, sectionId, sections.length));
  }

  return sections;
}

function extractNestedHeadingSections(html, pageUrl, parentId, offset) {
  const headingMatches = Array.from(
    html.matchAll(/<h([3-4])\b([^>]*)>([\s\S]*?)<\/h\1>/gi)
  );
  const sections = [];

  for (let index = 0; index < headingMatches.length; index += 1) {
    const match = headingMatches[index];
    const start = match.index + match[0].length;
    const end =
      index + 1 < headingMatches.length ? headingMatches[index + 1].index : html.length;
    const heading = normalizeText(stripTags(match[3]));
    const body = html.slice(start, end);
    const lines = [heading, ...collectContentLines(body)];
    const text = normalizeText(lines.join("\n"));

    if (!heading || !isMeaningfulText(text, heading)) {
      continue;
    }

    const id = slugify(`${parentId || "section"}-${heading}`) || `nested-${offset + index + 1}`;
    sections.push({
      id,
      type: "subsection",
      heading,
      text,
      sourceUrl: sourceWithFragment(pageUrl, id)
    });
  }

  return sections;
}

function extractFallbackHeadingSections(html, pageUrl) {
  const headings = Array.from(
    html.matchAll(/<h([1-4])\b([^>]*)>([\s\S]*?)<\/h\1>/gi)
  );
  const sections = [];

  for (let index = 0; index < headings.length; index += 1) {
    const match = headings[index];
    if (isHidden(match[2] || "")) {
      continue;
    }

    const start = match.index;
    const end = index + 1 < headings.length ? headings[index + 1].index : html.length;
    const block = html.slice(start, end);
    const heading = normalizeText(stripTags(match[3]));
    const text = normalizeText(collectContentLines(block).join("\n"));

    if (!heading || !isMeaningfulText(text, heading)) {
      continue;
    }

    const id = slugify(heading) || `heading-${sections.length + 1}`;
    sections.push({
      id,
      type: "heading",
      heading,
      text,
      sourceUrl: sourceWithFragment(pageUrl, id)
    });
  }

  return sections;
}

function collectContentLines(html) {
  const lines = [];
  let match;

  while ((match = contentTagPattern.exec(html))) {
    const tag = match[1].toLowerCase();
    const attrs = match[2] || "";
    const body = match[3] || "";

    if (isHidden(attrs) || isIconOnly(attrs, body)) {
      continue;
    }

    const text = normalizeText(stripTags(body));
    const ariaLabel = normalizeText(extractAttr(attrs, "aria-label"));
    const value = firstMeaningful([text, shouldUseAriaLabel(tag, attrs) ? ariaLabel : ""]);

    if (value && value.length >= 2 && !isLikelyTrackingText(value)) {
      lines.push(value);
    }
  }

  return dedupeLines(lines);
}

function dedupeExtractedSections(sections) {
  const seen = new Set();
  const result = [];

  for (const section of sections) {
    const text = normalizeText(section.text);
    const normalized = normalizeForComparison(text);
    if (!text || seen.has(normalized)) {
      continue;
    }

    seen.add(normalized);
    result.push({ ...section, text });
  }

  return result;
}

function dedupeLines(lines) {
  const seen = new Set();
  const result = [];

  for (const line of lines) {
    const key = normalizeForComparison(line);
    if (!key || seen.has(key)) {
      continue;
    }

    seen.add(key);
    result.push(line);
  }

  return result;
}

function extractTitle(html) {
  const match = html.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i);
  return match ? normalizeText(stripTags(match[1])) : "";
}

function extractMetaDescription(html) {
  const metaMatches = html.matchAll(/<meta\b([^>]*)>/gi);
  for (const match of metaMatches) {
    const attrs = match[1] || "";
    if (/name\s*=\s*["']description["']/i.test(attrs)) {
      const content = extractAttr(attrs, "content");
      return normalizeText(content);
    }
  }

  return "";
}

function extractHeading(html, tags) {
  for (const tag of tags) {
    const match = html.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));
    if (match) {
      const heading = normalizeText(stripTags(match[1]));
      if (heading) {
        return heading;
      }
    }
  }

  return "";
}

function extractAttr(attrs, name) {
  const pattern = new RegExp(`${name}\\s*=\\s*["']([^"']*)["']`, "i");
  const match = String(attrs || "").match(pattern);
  return match ? decodeHtmlEntities(match[1]) : "";
}

function isHidden(attrs) {
  return (
    /\bhidden\b/i.test(attrs) ||
    /aria-hidden\s*=\s*["']true["']/i.test(attrs) ||
    /display\s*:\s*none/i.test(attrs) ||
    /visibility\s*:\s*hidden/i.test(attrs)
  );
}

function isLikelyBoilerplate(tag, attrs) {
  return tag === "header" && /\b(nav|menu)\b/i.test(attrs);
}

function isIconOnly(attrs, body) {
  return /aria-hidden\s*=\s*["']true["']/i.test(attrs) || !stripTags(body).trim();
}

function shouldUseAriaLabel(tag, attrs) {
  return (tag === "a" || tag === "button") && /\baria-label\s*=/i.test(attrs);
}

function isLikelyTrackingText(text) {
  return /google analytics|gtag|dataLayer|facebook pixel/i.test(text);
}

function isMeaningfulText(text, heading) {
  const normalizedText = normalizeForComparison(text);
  const normalizedHeading = normalizeForComparison(heading);
  if (!normalizedText || normalizedText === normalizedHeading) {
    return false;
  }

  const words = normalizedText.split(/\s+/).filter(Boolean);
  return text.length >= 40 || words.length >= 7;
}

function stripTags(value) {
  return decodeHtmlEntities(
    String(value || "")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  );
}

function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCharCode(Number(code)));
}

function sourceWithFragment(pageUrl, fragment) {
  if (!fragment) {
    return pageUrl;
  }

  const parsed = new URL(pageUrl);
  parsed.hash = fragment;
  return parsed.href;
}

function slugify(value) {
  return normalizeForComparison(value).replace(/\s+/g, "-").slice(0, 80);
}

function titleize(value) {
  return String(value || "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
    .trim();
}

function firstMeaningful(values) {
  return values.find((value) => normalizeText(value)) || "";
}

function normalizeForComparison(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function collectExtractionDiagnostics(html, text, sections) {
  return {
    htmlByteLength: Buffer.byteLength(String(html || ""), "utf8"),
    headingCount: (html.match(/<h[1-4]\b/gi) || []).length,
    paragraphCount: (html.match(/<p\b/gi) || []).length,
    listItemCount: (html.match(/<li\b/gi) || []).length,
    semanticSectionCount: (html.match(/<(main|article|section)\b/gi) || []).length,
    extractedTextLength: text.length,
    sectionCount: sections.length
  };
}
