import { resolveBotConfig } from "../src/bots/index.js";
import { createJsonKnowledgeStore } from "../src/knowledge/knowledgeStore.js";
import { parseBotIdArg } from "./ingest-knowledge.js";
import { pathToFileURL } from "node:url";

const usageMessage =
  "Usage: npm run knowledge:inspect -- --bot-id=timetomarket-services";

export async function runKnowledgeInspectCli({
  argv = process.argv,
  env = process.env,
  store = createJsonKnowledgeStore(),
  stdout = console.log,
  stderr = console.error
} = {}) {
  const botId = parseBotIdArg(argv, env);
  if (!botId) {
    stderr(usageMessage);
    return 1;
  }

  const botConfig = resolveBotConfig(botId);
  const snapshot = await store.loadSnapshot(botConfig.botId);
  if (!snapshot) {
    stdout(`Bot ID: ${botConfig.botId}`);
    stdout("Snapshot: not found or not usable");
    stdout("Website knowledge will fall back to structured bot configuration.");
    return 0;
  }

  const origins = Array.from(
    new Set(
      (snapshot.sections || [])
        .map((section) => safeOrigin(section.sourceUrl))
        .filter(Boolean)
    )
  );
  const duplicateIndicators = getDuplicateIndicators(snapshot.sections || []);
  const findingCounts = summarizeSensitiveFindings(snapshot.summary?.sensitiveFindings || []);

  stdout(`Bot ID: ${snapshot.botId}`);
  stdout(`Snapshot version: ${snapshot.version || "unknown"}`);
  stdout(`Created: ${snapshot.createdAt || "unknown"}`);
  stdout(`Pages: ${(snapshot.pages || []).length}`);
  stdout(`Sections: ${(snapshot.sections || []).length}`);
  stdout(`Extraction quality: ${snapshot.summary?.extractionQuality?.status || "UNKNOWN"}`);
  stdout(`Extraction reason: ${snapshot.summary?.extractionQuality?.reason || "unknown"}`);
  stdout("Sensitive findings:");
  if (findingCounts.length === 0) {
    stdout("- none");
  } else {
    for (const finding of findingCounts) {
      stdout(`- ${finding.category}: ${finding.count} ${finding.action}`);
    }
  }
  stdout("Source origins:");
  for (const origin of origins) {
    stdout(`- ${origin}`);
  }
  stdout("Headings:");
  for (const heading of (snapshot.sections || []).map((section) => section.heading).filter(Boolean)) {
    stdout(`- ${heading.replace(/\s+/g, " ").trim()}`);
  }
  stdout("Duplicate-content indicators:");
  stdout(`- overlapping section pairs: ${duplicateIndicators.overlappingPairs}`);
  stdout(`- likely parent/child pairs: ${duplicateIndicators.parentChildPairs}`);

  if (snapshot.crawlOutcomes?.length) {
    stdout("Crawl outcomes:");
    for (const outcome of snapshot.crawlOutcomes) {
      stdout(`- ${outcome.category.toUpperCase()} ${outcome.code}: ${outcome.url} (${outcome.reason})`);
    }
  }

  return 0;
}

function summarizeSensitiveFindings(findings) {
  const summary = new Map();
  for (const finding of findings) {
    const key = `${finding.category}:${finding.action}`;
    const current = summary.get(key) || {
      category: finding.category,
      action: finding.action,
      count: 0
    };
    current.count += finding.count;
    summary.set(key, current);
  }
  return Array.from(summary.values());
}

function getDuplicateIndicators(sections) {
  let overlappingPairs = 0;
  let parentChildPairs = 0;

  for (let first = 0; first < sections.length; first += 1) {
    for (let second = first + 1; second < sections.length; second += 1) {
      const a = normalize(sections[first].text);
      const b = normalize(sections[second].text);
      if (!a || !b) {
        continue;
      }

      if (a.includes(b) || b.includes(a)) {
        parentChildPairs += 1;
        overlappingPairs += 1;
        continue;
      }

      const overlapRatio = tokenOverlapRatio(a, b);
      if (overlapRatio >= 0.82) {
        overlappingPairs += 1;
      }
    }
  }

  return { overlappingPairs, parentChildPairs };
}

function tokenOverlapRatio(a, b) {
  const aTokens = new Set(a.split(/\s+/).filter(Boolean));
  const bTokens = new Set(b.split(/\s+/).filter(Boolean));
  const shorter = Math.min(aTokens.size, bTokens.size);
  if (shorter === 0) {
    return 0;
  }

  let overlap = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) {
      overlap += 1;
    }
  }

  return overlap / shorter;
}

function safeOrigin(url) {
  try {
    return new URL(url).origin;
  } catch {
    return "";
  }
}

function normalize(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runKnowledgeInspectCli();
}
