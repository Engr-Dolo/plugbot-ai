import { demoBot } from "./demo-bot.js";
import { genericBot } from "./generic-bot.js";
import { timetomarketServicesBot } from "./timetomarket-services.js";

const botRegistry = new Map(
  [genericBot, demoBot, timetomarketServicesBot].map((bot) => [bot.botId, bot])
);

export function resolveBotConfig(botId) {
  const normalizedBotId = normalizeBotId(botId);
  const bot = botRegistry.get(normalizedBotId);

  if (bot) {
    return cloneBotConfig(bot, { requestedBotId: normalizedBotId, fallback: false });
  }

  return cloneBotConfig(genericBot, {
    requestedBotId: normalizedBotId,
    fallback: true
  });
}

export function hasBotConfig(botId) {
  return botRegistry.has(normalizeBotId(botId));
}

export function listConfiguredBotIds() {
  return Array.from(botRegistry.keys());
}

export function toSafeBotSummary(botConfig) {
  return {
    botId: botConfig.botId,
    requestedBotId: botConfig.requestedBotId,
    chatbotName: botConfig.chatbotName,
    businessName: botConfig.businessName,
    websiteUrl: botConfig.websiteUrl,
    fallback: botConfig.fallback,
    crawlEnabled: botConfig.crawlEnabled
  };
}

function normalizeBotId(botId) {
  return String(botId || "").trim().toLowerCase();
}

function cloneBotConfig(bot, metadata) {
  return deepFreeze({
    ...structuredClone(bot),
    ...metadata
  });
}

function deepFreeze(value) {
  if (!value || typeof value !== "object") {
    return value;
  }

  Object.freeze(value);
  for (const nested of Object.values(value)) {
    deepFreeze(nested);
  }

  return value;
}
