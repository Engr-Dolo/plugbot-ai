import { extractVisibleContent } from "./extractor.js";
import { renderPageHtml } from "./browserRenderer.js";
import { contentHash, dedupeSections, normalizeText } from "./normalizer.js";
import { fetchRobotsPolicy, crawlerUserAgent } from "./robotsPolicy.js";
import { filterSensitiveContent, summarizeFindings } from "./sensitiveDataFilter.js";
import { validateCrawlUrl, validateDiscoveredUrl, validateNetworkTarget } from "./urlPolicy.js";

const allowedContentTypes = ["text/html", "text/plain"];
const defaultMaxResponseBytes = 512_000;
const defaultTimeoutMs = 10_000;
const defaultRedirectLimit = 5;

export async function crawlBotWebsite(botConfig, options = {}) {
  const fetchClient = options.fetchClient || fetch;
  const maxPages = Math.max(1, botConfig.maximumCrawlPages || 10);
  const maxDepth = Math.max(0, botConfig.maximumCrawlDepth || 1);
  const crawlDelay = Math.max(0, botConfig.crawlDelay || 0);
  const queue = [{ url: botConfig.websiteUrl, depth: 0 }];
  const discovered = new Set();
  const crawled = [];
  const skipped = [];
  const rejected = [];
  const outcomes = [];
  const allFindings = [];
  const robotsPolicy = await fetchRobotsPolicy(botConfig, { ...options, fetchClient });

  while (queue.length && crawled.length < maxPages) {
    const item = queue.shift();
    if (discovered.has(item.url)) {
      continue;
    }

    discovered.add(item.url);

    let parsed;
    try {
      parsed = await validateCrawlUrl(item.url, botConfig, options);
    } catch (error) {
      const outcome = createUrlOutcome(
        item.url,
        "rejected",
        classifyRejectionCode(error),
        error.reason || "URL rejected by crawl policy."
      );
      rejected.push(outcome);
      outcomes.push(outcome);
      continue;
    }

    if (!robotsPolicy.isAllowed(parsed)) {
      const outcome = createUrlOutcome(
        parsed.href,
        "skipped",
        "SKIPPED_ROBOTS_POLICY",
        "robots.txt disallowed this path."
      );
      skipped.push(outcome);
      outcomes.push(outcome);
      continue;
    }

    try {
      const response =
        botConfig.crawlRenderingMode === "browser"
          ? await renderWithPolicy(parsed, botConfig, options)
          : await fetchWithPolicy(parsed, botConfig, {
              ...options,
              fetchClient
            });
      const contentType = response.contentType.toLowerCase();

      if (!allowedContentTypes.some((type) => contentType.includes(type))) {
        const outcome = createUrlOutcome(
          response.url,
          "skipped",
          "SKIPPED_NON_HTML",
          "Response content type is not supported for knowledge ingestion."
        );
        skipped.push(outcome);
        outcomes.push(outcome);
        continue;
      }

      const body = await readLimitedText(response.response, options.maxResponseBytes || defaultMaxResponseBytes);
      const extracted =
        contentType.includes("text/plain")
          ? {
              url: response.url,
              title: response.url,
              metaDescription: "",
              text: normalizeText(body),
              sections: [{ id: "plain-1", type: "plain", heading: "", text: normalizeText(body) }]
            }
          : extractVisibleContent(body, response.url);

      const filterResult = filterSensitiveContent(extracted.text);
      allFindings.push(...filterResult.findings);

      if (filterResult.status === "rejected") {
        const outcome = createUrlOutcome(
          response.url,
          "rejected",
          "REJECTED_SENSITIVE_CONTENT",
          "Sensitive content policy rejected this page."
        );
        rejected.push(outcome);
        outcomes.push(outcome);
        continue;
      }

      const pageHash = contentHash(filterResult.text);
      const filteredSections = [];
      for (const section of extracted.sections) {
        const sectionFilter = filterSensitiveContent(section.text);
        allFindings.push(...sectionFilter.findings);
        if (sectionFilter.status === "rejected") {
          continue;
        }

        filteredSections.push({
          ...section,
          text: sectionFilter.text
        });
      }

      const pageSections = dedupeSections(filteredSections);

      crawled.push({
        url: response.url,
        title: extracted.title,
        crawledAt: new Date().toISOString(),
        contentHash: pageHash,
        text: filterResult.text,
        sections: pageSections,
        diagnostics: {
          fetch: response.diagnostics || {},
          extraction: extracted.diagnostics || {}
        },
        extractionQuality: extracted.quality,
        sensitivity: {
          status: filterResult.status,
          findings: summarizeFindings(filterResult.findings)
        }
      });
      outcomes.push(createUrlOutcome(response.url, "crawled", "CRAWLED_OK"));

      if (item.depth < maxDepth && contentType.includes("text/html")) {
        for (const link of extractLinks(body, response.url)) {
          try {
            const discoveredUrl = validateDiscoveredUrl(link, response.url, botConfig);
            if (!discovered.has(discoveredUrl.href)) {
              queue.push({ url: discoveredUrl.href, depth: item.depth + 1 });
            }
          } catch (error) {
            const outcome = createUrlOutcome(
              link,
              "skipped",
              classifySkippedPolicyCode(error),
              error.reason || "Discovered URL is outside crawl policy."
            );
            skipped.push(outcome);
            outcomes.push(outcome);
          }
        }
      }
    } catch (error) {
      const outcome = createUrlOutcome(
        parsed.href,
        "rejected",
        classifyFetchRejectionCode(error),
        safeReason(error)
      );
      rejected.push(outcome);
      outcomes.push(outcome);
    }

    if (crawlDelay > 0 && queue.length) {
      await delay(crawlDelay);
    }
  }

  return {
    discovered: discovered.size + queue.length,
    crawled,
    skipped,
    rejected,
    outcomes,
    sensitiveFindings: summarizeFindings(allFindings)
  };
}

async function fetchWithPolicy(initialUrl, botConfig, options) {
  const fetchClient = options.fetchClient || fetch;
  let currentUrl = initialUrl;
  const visitedRedirects = new Set([currentUrl.href]);

  for (let redirects = 0; redirects <= (options.redirectLimit || defaultRedirectLimit); redirects += 1) {
    await validateNetworkTarget(currentUrl, options);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs || defaultTimeoutMs);

    let response;
    try {
      response = await fetchClient(currentUrl.href, {
        method: "GET",
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "user-agent": crawlerUserAgent,
          accept: "text/html,text/plain;q=0.9"
        }
      });
    } finally {
      clearTimeout(timeout);
    }

    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location) {
        throw new Error("redirect without location");
      }

      const redirected = validateDiscoveredUrl(location, currentUrl.href, botConfig);
      await validateNetworkTarget(redirected, options);
      if (visitedRedirects.has(redirected.href)) {
        throw new Error("redirect loop detected");
      }

      visitedRedirects.add(redirected.href);
      currentUrl = redirected;
      continue;
    }

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const finalUrl = response.url || currentUrl.href;
    const finalParsed = await validateCrawlUrl(finalUrl, botConfig, options);

    return {
      response,
      url: finalParsed.href,
      contentType: response.headers.get("content-type") || ""
    };
  }

  throw new Error("redirect limit exceeded");
}

async function renderWithPolicy(initialUrl, botConfig, options) {
  const renderer = options.renderPage || renderPageHtml;
  const rendered = await renderer(initialUrl.href, botConfig, options);
  const renderedUrl = await validateCrawlUrl(rendered.url || initialUrl.href, botConfig, options);
  const contentType = rendered.contentType || "text/html";

  return {
    response: {
      text: async () => rendered.html
    },
    url: renderedUrl.href,
    contentType,
    diagnostics: rendered.diagnostics || {}
  };
}

async function readLimitedText(response, maxBytes) {
  const reader = response.body?.getReader?.();
  if (!reader) {
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > maxBytes) {
      throw new Error("response too large");
    }
    return text;
  }

  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    total += value.byteLength;
    if (total > maxBytes) {
      throw new Error("response too large");
    }

    chunks.push(value);
  }

  return Buffer.concat(chunks).toString("utf8");
}

export function extractLinks(html, baseUrl) {
  const links = [];
  for (const match of String(html || "").matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"']+)["'][^>]*>/gi)) {
    const href = match[1].trim();
    if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) {
      continue;
    }

    try {
      const parsed = new URL(href, baseUrl);
      parsed.hash = "";
      links.push(parsed.href);
    } catch {
      continue;
    }
  }

  return links;
}

export function createUrlOutcome(url, category, code, reason = defaultReasonForCode(code)) {
  return {
    url: sanitizeUrlForReport(url),
    category,
    code,
    reason
  };
}

export function sanitizeUrlForReport(url) {
  try {
    const parsed = new URL(url);
    parsed.username = "";
    parsed.password = "";
    parsed.search = "";
    if (["wa.me", "api.whatsapp.com", "web.whatsapp.com"].includes(parsed.hostname.toLowerCase())) {
      parsed.pathname = "/[redacted]";
    }
    return parsed.href;
  } catch {
    return "[invalid-url]";
  }
}

function classifyRejectionCode(error) {
  const reason = String(error?.reason || error?.message || "").toLowerCase();
  if (reason.includes("origin")) {
    return "REJECTED_OUTSIDE_ALLOWED_ORIGIN";
  }
  if (reason.includes("prefix")) {
    return "REJECTED_OUTSIDE_ALLOWED_PATH";
  }
  if (reason.includes("denied")) {
    return "REJECTED_DENIED_PATH";
  }
  if (
    reason.includes("hostname") ||
    reason.includes("network") ||
    reason.includes("resolved") ||
    reason.includes("protocol")
  ) {
    return "REJECTED_SSRF_POLICY";
  }
  return "REJECTED_CRAWL_POLICY";
}

function classifySkippedPolicyCode(error) {
  const rejectedCode = classifyRejectionCode(error);
  return rejectedCode.replace(/^REJECTED_/, "SKIPPED_");
}

function classifyFetchRejectionCode(error) {
  const message = String(error?.message || "").toLowerCase();
  if (message.startsWith("http ")) {
    return "REJECTED_HTTP_STATUS";
  }
  if (message.includes("timeout") || error?.name === "AbortError") {
    return "REJECTED_TIMEOUT";
  }
  if (message.includes("too large")) {
    return "REJECTED_RESPONSE_TOO_LARGE";
  }
  if (message.includes("redirect loop")) {
    return "REJECTED_REDIRECT_LOOP";
  }
  if (message.includes("redirect limit")) {
    return "REJECTED_REDIRECT_LIMIT";
  }
  if (message.includes("redirect without location")) {
    return "REJECTED_MALFORMED_REDIRECT";
  }
  return classifyRejectionCode(error);
}

function defaultReasonForCode(code) {
  const reasons = {
    CRAWLED_OK: "Page was crawled and included in the sanitized snapshot.",
    SKIPPED_ALREADY_VISITED: "URL was already crawled or queued.",
    SKIPPED_ROBOTS_POLICY: "robots.txt disallowed this path.",
    SKIPPED_NON_HTML: "Response content type is not supported for knowledge ingestion.",
    SKIPPED_OUTSIDE_ALLOWED_ORIGIN: "Discovered URL is outside the bot allowed origin.",
    SKIPPED_OUTSIDE_ALLOWED_PATH: "Discovered URL is outside the bot allowed path prefix.",
    SKIPPED_DENIED_PATH: "Discovered URL matches a denied crawl path.",
    SKIPPED_SSRF_POLICY: "Discovered URL failed protocol, host, DNS, or network safety policy.",
    REJECTED_OUTSIDE_ALLOWED_ORIGIN: "URL is outside the bot allowed origin.",
    REJECTED_OUTSIDE_ALLOWED_PATH: "URL is outside the bot allowed path prefix.",
    REJECTED_DENIED_PATH: "URL matches a denied crawl path.",
    REJECTED_SSRF_POLICY: "URL failed protocol, host, DNS, or network safety policy.",
    REJECTED_CRAWL_POLICY: "URL failed crawl policy.",
    REJECTED_HTTP_STATUS: "Request returned an unsuccessful HTTP status.",
    REJECTED_TIMEOUT: "Request timed out.",
    REJECTED_RESPONSE_TOO_LARGE: "Response exceeded the configured size limit.",
    REJECTED_SENSITIVE_CONTENT: "Sensitive content policy rejected this page.",
    REJECTED_REDIRECT_LOOP: "Redirect loop was detected.",
    REJECTED_REDIRECT_LIMIT: "Redirect limit was exceeded.",
    REJECTED_MALFORMED_REDIRECT: "Redirect response did not include a usable Location header."
  };

  return reasons[code] || "URL was not included.";
}

function safeReason(error) {
  if (error?.reason) {
    return error.reason;
  }

  if (error?.name === "AbortError") {
    return "request timed out";
  }

  return error?.message || "crawl failed";
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
