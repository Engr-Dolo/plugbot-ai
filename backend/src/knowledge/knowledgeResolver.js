import { createJsonKnowledgeStore } from "./knowledgeStore.js";
import { truncateText } from "./normalizer.js";

const stopWords = new Set([
  "a",
  "about",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "how",
  "i",
  "in",
  "is",
  "it",
  "me",
  "my",
  "of",
  "on",
  "or",
  "our",
  "the",
  "tell",
  "to",
  "what",
  "when",
  "where",
  "which",
  "with",
  "you",
  "your"
]);

export async function resolveKnowledgeContext({
  botConfig,
  message,
  history = [],
  store = createJsonKnowledgeStore(),
  maxWebsiteSections = 6,
  maxContextCharacters = 6000
}) {
  const structuredKnowledge = buildStructuredKnowledge(botConfig);
  const snapshot = await store.loadSnapshot(botConfig.botId);
  const query = [message, ...history.slice(-3).map((entry) => entry.content)].join(" ");
  const snapshotSections = Array.isArray(snapshot?.sections) ? snapshot.sections.length : 0;
  const websiteSections = selectRelevantSections({
    snapshot,
    query,
    maxSections: maxWebsiteSections,
    maxCharacters: Math.max(1200, maxContextCharacters - structuredKnowledge.text.length)
  });

  return {
    bot: {
      botId: botConfig.botId,
      requestedBotId: botConfig.requestedBotId,
      fallback: botConfig.fallback,
      chatbotName: botConfig.chatbotName,
      businessName: botConfig.businessName,
      websiteUrl: botConfig.websiteUrl
    },
    behavior: {
      systemInstructions: botConfig.systemInstructions,
      responseBehavior: botConfig.responseBehavior,
      fallbackBehavior: botConfig.fallbackBehavior
    },
    structuredKnowledge,
    websiteKnowledge: {
      available: Boolean(snapshot),
      sections: websiteSections,
      snapshotCreatedAt: snapshot?.createdAt || "",
      sourceCount: snapshot?.pages?.length || 0,
      totalSections: snapshotSections,
      contextCharacterCount: websiteSections.reduce(
        (total, section) => total + String(section.text || "").length,
        0
      )
    }
  };
}

export function buildStructuredKnowledge(botConfig) {
  const parts = [
    `Business name: ${botConfig.businessName}`,
    `Chatbot name: ${botConfig.chatbotName}`,
    `Description: ${botConfig.description}`,
    `Purpose: ${botConfig.purpose}`,
    botConfig.websiteUrl ? `Website: ${botConfig.websiteUrl}` : "",
    botConfig.businessHours ? `Business hours: ${botConfig.businessHours}` : "",
    formatServices(botConfig.services),
    formatContact(botConfig.publicContactInformation),
    formatFaqs(botConfig.faqs)
  ].filter(Boolean);

  return {
    text: truncateText(parts.join("\n\n"), 3000),
    services: botConfig.services || [],
    faqs: botConfig.faqs || [],
    publicContactInformation: botConfig.publicContactInformation || {}
  };
}

export function selectRelevantSections({
  snapshot,
  query,
  maxSections = 6,
  maxCharacters = 3000
}) {
  if (!snapshot?.sections?.length) {
    return [];
  }

  if (isSensitiveKnowledgeRequest(query)) {
    return [];
  }

  const queryTokens = expandQueryTokens(tokenize(query));
  if (queryTokens.length === 0) {
    return [];
  }

  const scored = snapshot.sections
    .filter((section) => section.botId === snapshot.botId)
    .map((section) => {
      const textTokens = tokenize(
        `${section.heading || ""} ${section.text || ""}`
      );
      const headingTokens = tokenize(section.heading || "");
      const normalizedQuery = normalizeForComparison(query);
      const normalizedHeading = normalizeForComparison(section.heading);
      const normalizedText = normalizeForComparison(section.text);
      const score = textTokens.reduce(
        (total, token) => total + (queryTokens.includes(token) ? 1 : 0),
        0
      );
      const headingOverlap = headingTokens.filter((token) => queryTokens.includes(token)).length;
      const headingBoost = headingOverlap * 4;
      const lexicalScore = score + headingOverlap;
      const overviewBoost =
        isOverviewQuery(queryTokens) && lexicalScore > 0 && looksLikeOverviewSection(section)
          ? 3
          : 0;
      const intentBoost = getIntentBoost(queryTokens, normalizedQuery, normalizedHeading, normalizedText);

      return {
        section,
        score: score + headingBoost + overviewBoost + intentBoost,
        headingOverlap,
        overview: looksLikeOverviewSection(section)
      };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score);

  const deduped = dedupeOverlappingScoredSections(scored, queryTokens);
  const selected = [];
  let usedCharacters = 0;

  for (const entry of deduped) {
    if (selected.length >= maxSections || usedCharacters >= maxCharacters) {
      break;
    }

    const remaining = maxCharacters - usedCharacters;
    const text = truncateText(entry.section.text, Math.min(remaining, 900));
    usedCharacters += text.length;
    selected.push({
      id: entry.section.id,
      text,
      heading: entry.section.heading,
      sourceUrl: entry.section.sourceUrl,
      pageTitle: entry.section.pageTitle,
      crawledAt: entry.section.crawledAt,
      contentHash: entry.section.contentHash
    });
  }

  return selected;
}

export function dedupeOverlappingScoredSections(scoredEntries, queryTokens) {
  const selected = [];

  for (const candidate of scoredEntries) {
    const duplicateIndex = selected.findIndex((existing) =>
      hasSubstantialOverlap(candidate.section.text, existing.section.text)
    );

    if (duplicateIndex === -1) {
      selected.push(candidate);
      continue;
    }

    const existing = selected[duplicateIndex];
    if (shouldPreferCandidate(candidate, existing, queryTokens)) {
      selected[duplicateIndex] = candidate;
    }
  }

  return selected.sort((a, b) => b.score - a.score);
}

export function tokenize(value) {
  return Array.from(
    new Set(
      String(value || "")
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, " ")
        .split(/\s+/)
        .map((token) => token.trim())
        .filter((token) => token.length > 2 && !stopWords.has(token))
    )
  );
}

function hasSubstantialOverlap(a, b) {
  const aNormalized = normalizeForComparison(a);
  const bNormalized = normalizeForComparison(b);
  if (!aNormalized || !bNormalized) {
    return false;
  }

  if (aNormalized.includes(bNormalized) || bNormalized.includes(aNormalized)) {
    const shorter = Math.min(aNormalized.length, bNormalized.length);
    const longer = Math.max(aNormalized.length, bNormalized.length);
    return shorter / longer >= 0.18;
  }

  const aTokens = new Set(tokenize(aNormalized));
  const bTokens = new Set(tokenize(bNormalized));
  const shorterSize = Math.min(aTokens.size, bTokens.size);
  if (shorterSize === 0) {
    return false;
  }

  let overlap = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) {
      overlap += 1;
    }
  }

  return overlap / shorterSize >= 0.82;
}

function shouldPreferCandidate(candidate, existing, queryTokens) {
  const broad = isOverviewQuery(queryTokens);
  if (broad && candidate.overview !== existing.overview) {
    return candidate.overview;
  }

  if (!broad && candidate.headingOverlap !== existing.headingOverlap) {
    return candidate.headingOverlap > existing.headingOverlap;
  }

  if (!broad && candidate.headingOverlap > 0) {
    return candidate.section.text.length < existing.section.text.length;
  }

  return candidate.score > existing.score;
}

function isOverviewQuery(queryTokens) {
  return queryTokens.some((token) =>
    [
      "all",
      "available",
      "everything",
      "list",
      "offer",
      "offers",
      "overview",
      "process",
      "services",
      "steps",
      "work",
      "works"
    ].includes(token)
  );
}

function expandQueryTokens(tokens) {
  const expanded = new Set(tokens);
  const expansions = {
    ai: ["artificial", "intelligence", "chatbots", "automation", "integrations", "powered"],
    automated: ["automation", "ai"],
    chatbot: ["chatbots", "ai"],
    chatbots: ["chatbot", "ai"],
    secure: ["security", "monitoring", "protection", "hardened"],
    secured: ["security", "monitoring", "protection", "hardened"],
    protect: ["security", "monitoring", "protection"],
    protection: ["security", "monitoring", "secure"],
    consultation: ["consult", "intake", "brief", "project", "free"],
    consult: ["consultation", "intake", "brief", "project", "free"],
    book: ["consultation", "intake", "brief"],
    request: ["consultation", "intake", "brief"],
    contact: ["consultation", "intake", "whatsapp"],
    package: ["pricing", "budget", "timeline"],
    cheapest: ["pricing", "budget"],
    price: ["pricing", "budget"],
    prices: ["pricing", "budget"],
    cost: ["pricing", "budget"]
  };

  for (const token of tokens) {
    for (const extra of expansions[token] || []) {
      expanded.add(extra);
    }
  }

  return Array.from(expanded);
}

function getIntentBoost(queryTokens, normalizedQuery, normalizedHeading, normalizedText) {
  let boost = 0;
  const haystack = `${normalizedHeading} ${normalizedText}`;

  if (queryTokens.includes("services") || queryTokens.includes("offer")) {
    boost += phraseBoost(haystack, ["everything your business needs", "web design", "custom storefronts"], 5);
  }

  if (queryTokens.includes("ai") || normalizedQuery.includes("artificial intelligence")) {
    boost += phraseBoost(haystack, ["ai powered features", "smart chatbots", "ai integrations"], 8);
  }

  if (queryTokens.includes("security") || queryTokens.includes("monitoring")) {
    boost += phraseBoost(haystack, ["security monitoring", "hardened", "malware scanning", "firewall"], 8);
  }

  if (
    queryTokens.includes("consultation") ||
    queryTokens.includes("intake") ||
    queryTokens.includes("brief")
  ) {
    boost += phraseBoost(haystack, ["free consultation", "project intake", "short brief", "consultation plan"], 7);
  }

  if (queryTokens.includes("contact") || queryTokens.includes("whatsapp")) {
    boost += phraseBoost(haystack, ["whatsapp", "contact details", "brief opens in whatsapp"], 5);
  }

  if (queryTokens.includes("pricing") || queryTokens.includes("budget")) {
    boost += phraseBoost(haystack, ["budget timeline", "investment range", "free consultation"], 4);
  }

  return boost;
}

function phraseBoost(text, phrases, points) {
  return phrases.some((phrase) => text.includes(phrase)) ? points : 0;
}

function isSensitiveKnowledgeRequest(query) {
  const normalized = String(query || "").toLowerCase();
  const sensitiveTerm =
    normalized.includes(".env") ||
    normalized.includes("api key") ||
    normalized.includes("apikey") ||
    normalized.includes("credentials") ||
    normalized.includes("secret") ||
    normalized.includes("token") ||
    normalized.includes("password") ||
    normalized.includes("system prompt");

  return (
    sensitiveTerm &&
    /\b(give|show|tell|send|print|reveal|share|display|provide|administrator)\b/.test(normalized)
  );
}

function looksLikeOverviewSection(section) {
  const text = String(section.text || "");
  const heading = String(section.heading || "").toLowerCase();
  const headingCount = (text.match(/\n[A-Z][^\n]{2,60}\n/g) || []).length;
  return (
    heading.includes("everything") ||
    heading.includes("process") ||
    heading.includes("services") ||
    heading.includes("needs") ||
    headingCount >= 2 ||
    text.length > 280
  );
}

function normalizeForComparison(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function formatServices(services = []) {
  if (!services.length) {
    return "";
  }

  return `Services:\n${services
    .map((service) => `- ${service.name}: ${service.description}`)
    .join("\n")}`;
}

function formatContact(contact = {}) {
  const values = [
    contact.email ? `Email: ${contact.email}` : "",
    contact.phone ? `Phone: ${contact.phone}` : "",
    contact.address ? `Address: ${contact.address}` : "",
    contact.contactFormUrl ? `Contact form or contact page: ${contact.contactFormUrl}` : "",
    contact.whatsapp ? `WhatsApp: ${contact.whatsapp}` : "",
    contact.socialLinks?.length ? `Social links: ${contact.socialLinks.join(", ")}` : ""
  ].filter(Boolean);

  return values.length ? `Public contact information:\n${values.join("\n")}` : "";
}

function formatFaqs(faqs = []) {
  if (!faqs.length) {
    return "";
  }

  return `FAQs:\n${faqs
    .map((faq) => `Q: ${faq.question}\nA: ${faq.answer}`)
    .join("\n\n")}`;
}
