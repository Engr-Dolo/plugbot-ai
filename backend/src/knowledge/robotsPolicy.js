import { parseHttpUrl, validateCrawlUrl } from "./urlPolicy.js";

export const crawlerUserAgent = "PlugBotKnowledgeCrawler/1.0";

export async function fetchRobotsPolicy(botConfig, options = {}) {
  const website = parseHttpUrl(botConfig.websiteUrl);
  const robotsUrl = `${website.origin}/robots.txt`;
  const fetchClient = options.fetchClient || fetch;

  try {
    const robotsParsed = await validateCrawlUrl(robotsUrl, {
      ...botConfig,
      allowedPathPrefixes: ["/"],
      deniedPathPatterns: []
    }, options);
    const response = await fetchClient(robotsParsed.href, {
      method: "GET",
      redirect: "manual",
      headers: { "user-agent": crawlerUserAgent }
    });

    if (!response.ok) {
      return createRobotsPolicy("");
    }

    const text = await response.text();
    return createRobotsPolicy(text);
  } catch {
    return createRobotsPolicy("");
  }
}

export function createRobotsPolicy(robotsText, userAgent = crawlerUserAgent) {
  const rules = parseRobotsTxt(robotsText, userAgent);

  return {
    isAllowed(url) {
      const parsed = typeof url === "string" ? new URL(url) : url;
      const pathname = parsed.pathname || "/";
      let matchedRule = null;

      for (const rule of rules) {
        if (pathname.startsWith(rule.path)) {
          if (!matchedRule || rule.path.length > matchedRule.path.length) {
            matchedRule = rule;
          }
        }
      }

      return matchedRule ? matchedRule.allow : true;
    }
  };
}

function parseRobotsTxt(robotsText, userAgent) {
  const lines = String(robotsText || "").split(/\r?\n/);
  const targetAgents = ["*", userAgent.toLowerCase()];
  const rules = [];
  let active = false;

  for (const rawLine of lines) {
    const line = rawLine.replace(/#.*/, "").trim();
    if (!line.includes(":")) {
      continue;
    }

    const [rawKey, ...rawValue] = line.split(":");
    const key = rawKey.trim().toLowerCase();
    const value = rawValue.join(":").trim();

    if (key === "user-agent") {
      active = targetAgents.includes(value.toLowerCase());
      continue;
    }

    if (!active || (key !== "disallow" && key !== "allow")) {
      continue;
    }

    if (!value) {
      continue;
    }

    rules.push({
      allow: key === "allow",
      path: value
    });
  }

  return rules;
}
