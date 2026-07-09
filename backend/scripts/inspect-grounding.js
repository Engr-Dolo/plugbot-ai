import { pathToFileURL } from "node:url";
import { resolveBotConfig } from "../src/bots/index.js";
import { createJsonKnowledgeStore } from "../src/knowledge/knowledgeStore.js";
import { resolveKnowledgeContext } from "../src/knowledge/knowledgeResolver.js";
import { parseBotIdArg } from "./ingest-knowledge.js";

const usageMessage =
  'Usage: npm run grounding:inspect -- --bot-id=timetomarket-services --query="What services do you offer?"';

export async function runGroundingInspectCli({
  argv = process.argv,
  env = process.env,
  store = createJsonKnowledgeStore(),
  stdout = console.log,
  stderr = console.error
} = {}) {
  const requestedBotId = parseBotIdArg(argv, env);
  const query = parseQueryArg(argv, env);

  if (!requestedBotId || !query) {
    stderr(usageMessage);
    return 1;
  }

  const botConfig = resolveBotConfig(requestedBotId);
  const inspected =
    typeof store.inspectSnapshot === "function"
      ? await store.inspectSnapshot(botConfig.botId)
      : {
          found: Boolean(await store.loadSnapshot(botConfig.botId)),
          valid: Boolean(await store.loadSnapshot(botConfig.botId))
        };
  const botContext = await resolveKnowledgeContext({
    botConfig,
    message: query,
    store
  });
  const selectedHeadings = botContext.websiteKnowledge.sections
    .map((section) => sanitizeHeading(section.heading || section.pageTitle || "Untitled section"))
    .filter(Boolean);

  stdout(`Requested botId: ${requestedBotId}`);
  stdout(`Resolved botId: ${botContext.bot.botId}`);
  stdout(`Fallback used: ${Boolean(botContext.bot.fallback)}`);
  stdout(`Snapshot found: ${Boolean(inspected.found)}`);
  stdout(`Snapshot valid: ${Boolean(inspected.valid)}`);
  stdout(`Total sections: ${botContext.websiteKnowledge.totalSections || 0}`);
  stdout("Selected relevant section headings:");
  if (selectedHeadings.length === 0) {
    stdout("- none");
  } else {
    for (const heading of selectedHeadings) {
      stdout(`- ${heading}`);
    }
  }
  stdout(`Context character count: ${botContext.websiteKnowledge.contextCharacterCount || 0}`);
  stdout(`Provider target: ${(env.AI_PROVIDER || "mock").trim().toLowerCase()}`);
  stdout(`Structured knowledge available: ${Boolean(botContext.structuredKnowledge.text)}`);
  stdout(`Website knowledge available: ${Boolean(botContext.websiteKnowledge.available)}`);

  return 0;
}

export function parseQueryArg(argv = process.argv, env = process.env) {
  const fromEnv = env.npm_config_query || env.QUERY || "";
  if (fromEnv) {
    return String(fromEnv).trim();
  }

  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--query") {
      return String(argv[index + 1] || "").trim();
    }

    if (value.startsWith("--query=")) {
      return value.slice("--query=".length).trim();
    }
  }

  return "";
}

function sanitizeHeading(value) {
  return String(value || "")
    .replace(/\s+/g, " ")
    .replace(/[^\w .,&:()/+-]/g, "")
    .slice(0, 120)
    .trim();
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = await runGroundingInspectCli();
}
