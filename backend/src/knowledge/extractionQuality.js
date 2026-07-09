export function assessExtractionQuality({ title = "", text = "", sections = [] }) {
  const normalizedTitle = normalizeForComparison(title);
  const normalizedText = normalizeForComparison(text);
  const meaningfulSections = sections.filter((section) =>
    isMeaningfulSection(section, normalizedTitle)
  );
  const uniqueWords = new Set(
    normalizedText
      .split(/\s+/)
      .filter((word) => word.length > 3)
  );
  const titleOnly =
    normalizedText === normalizedTitle ||
    (sections.length <= 1 &&
      meaningfulSections.length === 0 &&
      normalizedText.includes(normalizedTitle) &&
      normalizedText.length <= normalizedTitle.length + 20);

  if (titleOnly) {
    return {
      status: "INSUFFICIENT",
      reason: "Only page title was extracted; no meaningful body content found.",
      meaningfulSectionCount: 0,
      textLength: text.length,
      uniqueWordCount: uniqueWords.size
    };
  }

  if (text.length < 250 || meaningfulSections.length === 0 || uniqueWords.size < 12) {
    return {
      status: "INSUFFICIENT",
      reason: "Extracted content is too small or lacks meaningful body sections.",
      meaningfulSectionCount: meaningfulSections.length,
      textLength: text.length,
      uniqueWordCount: uniqueWords.size
    };
  }

  if (text.length < 600 || meaningfulSections.length < 2) {
    return {
      status: "DEGRADED",
      reason: "Extracted content is usable but limited.",
      meaningfulSectionCount: meaningfulSections.length,
      textLength: text.length,
      uniqueWordCount: uniqueWords.size
    };
  }

  return {
    status: "SUFFICIENT",
    reason: "Meaningful visible body content was extracted.",
    meaningfulSectionCount: meaningfulSections.length,
    textLength: text.length,
    uniqueWordCount: uniqueWords.size
  };
}

function isMeaningfulSection(section, normalizedTitle) {
  const text = normalizeForComparison(section.text);
  if (!text || text === normalizedTitle) {
    return false;
  }

  const words = text.split(/\s+/).filter(Boolean);
  return text.length >= 80 || words.length >= 10;
}

function normalizeForComparison(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
