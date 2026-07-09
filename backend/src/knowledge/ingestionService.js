import { resolveBotConfig, hasBotConfig } from "../bots/index.js";
import { crawlBotWebsite } from "./crawler.js";
import { createJsonKnowledgeStore } from "./knowledgeStore.js";
import { contentHash } from "./normalizer.js";
import { validateCrawlUrl } from "./urlPolicy.js";

export async function ingestBotKnowledge({ botId, store = createJsonKnowledgeStore(), options = {} }) {
  if (!hasBotConfig(botId)) {
    throw new Error("Unknown botId. Ingestion requires an explicit configured bot.");
  }

  const botConfig = resolveBotConfig(botId);
  if (!botConfig.crawlEnabled) {
    throw new Error("Crawling is not enabled for this bot.");
  }

  await validateCrawlUrl(botConfig.websiteUrl, botConfig, options);
  const crawlResult = await crawlBotWebsite(botConfig, options);
  const sections = [];

  for (const page of crawlResult.crawled) {
    for (const section of page.sections) {
      sections.push({
        id: `${page.contentHash.slice(0, 10)}-${section.id}`,
        botId: botConfig.botId,
        sourceUrl: section.sourceUrl || page.url,
        pageTitle: page.title,
        heading: section.heading,
        text: section.text,
        crawledAt: page.crawledAt,
        contentHash: contentHash(`${page.url}\n${section.text}`),
        sensitivityStatus: page.sensitivity.status,
        ingestionStatus: "included",
        extractionQualityStatus: page.extractionQuality?.status || "UNKNOWN"
      });
    }
  }

  const extractionQuality = summarizeExtractionQuality(crawlResult.crawled);

  const snapshot = {
    version: 1,
    botId: botConfig.botId,
    createdAt: new Date().toISOString(),
    source: {
      websiteUrl: botConfig.websiteUrl,
      allowedOrigins: botConfig.allowedOrigins,
      allowedPathPrefixes: botConfig.allowedPathPrefixes
    },
    pages: crawlResult.crawled.map((page) => ({
      botId: botConfig.botId,
      pageUrl: page.url,
      pageTitle: page.title,
      crawlTimestamp: page.crawledAt,
      contentHash: page.contentHash,
      sensitivityFilterStatus: page.sensitivity.status,
      ingestionStatus: "included",
      extractionQuality: page.extractionQuality || {
        status: "UNKNOWN",
        reason: "Extraction quality was not assessed."
      },
      diagnostics: page.diagnostics || {}
    })),
    sections,
    summary: {
      pagesDiscovered: crawlResult.discovered,
      pagesCrawled: crawlResult.crawled.length,
      pagesSkipped: crawlResult.skipped.length,
      pagesRejected: crawlResult.rejected.length,
      sensitiveFindings: crawlResult.sensitiveFindings,
      knowledgeSections: sections.length,
      extractionQuality
    },
    crawlOutcomes: crawlResult.outcomes || []
  };

  const filePath = await store.saveSnapshot(snapshot);

  return {
    snapshot,
    filePath,
    crawlResult
  };
}

function summarizeExtractionQuality(pages) {
  if (!pages.length) {
    return {
      status: "INSUFFICIENT",
      reason: "No pages were crawled.",
      meaningfulSectionCount: 0
    };
  }

  const statuses = pages.map((page) => page.extractionQuality?.status || "UNKNOWN");
  const meaningfulSectionCount = pages.reduce(
    (total, page) => total + (page.extractionQuality?.meaningfulSectionCount || 0),
    0
  );

  if (statuses.includes("SUFFICIENT")) {
    return {
      status: statuses.every((status) => status === "SUFFICIENT") ? "SUFFICIENT" : "DEGRADED",
      reason:
        statuses.every((status) => status === "SUFFICIENT")
          ? "All crawled pages produced meaningful visible content."
          : "At least one crawled page produced meaningful visible content, but some pages were limited.",
      meaningfulSectionCount
    };
  }

  if (statuses.includes("DEGRADED")) {
    return {
      status: "DEGRADED",
      reason: "Crawled pages produced limited visible content.",
      meaningfulSectionCount
    };
  }

  return {
    status: "INSUFFICIENT",
    reason:
      pages[0]?.extractionQuality?.reason ||
      "No meaningful visible body content was extracted.",
    meaningfulSectionCount
  };
}
