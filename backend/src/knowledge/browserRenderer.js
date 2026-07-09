import { chromium } from "playwright";
import {
  parseHttpUrl,
  validateBotScope,
  validateCrawlUrl,
  validateDeniedPath,
  validateNetworkTarget,
  validateProtocol
} from "./urlPolicy.js";
import { crawlerUserAgent } from "./robotsPolicy.js";

const defaultNavigationTimeoutMs = 20_000;
const defaultPageTimeoutMs = 25_000;
const blockedResourceTypes = new Set(["image", "media", "font"]);
const extensionOnlyDeniedPatterns = new Set([".js", ".css"]);
const renderResourceDeniedPathPatterns = [
  "/admin",
  "/login",
  "/logout",
  "/account",
  "/dashboard",
  "/api",
  "/private",
  "/internal",
  "/.git",
  "/.env",
  "/config",
  "/secrets",
  "/backup",
  "/backups",
  "/database",
  "/db",
  "/export",
  "/checkout",
  "/payment",
  "/profile",
  ".map",
  ".zip",
  ".tar",
  ".gz",
  ".sql",
  ".bak",
  ".backup"
];

export async function renderPageHtml(url, botConfig, options = {}) {
  const pageUrl = await validateCrawlUrl(url, botConfig, options);
  const browser = await chromium.launch({ headless: true });

  try {
    const context = await browser.newContext({
      javaScriptEnabled: true,
      userAgent: crawlerUserAgent,
      ignoreHTTPSErrors: false,
      bypassCSP: false,
      storageState: { cookies: [], origins: [] }
    });
    const page = await context.newPage();
    page.setDefaultNavigationTimeout(
      options.navigationTimeoutMs || defaultNavigationTimeoutMs
    );
    page.setDefaultTimeout(options.pageTimeoutMs || defaultPageTimeoutMs);

    await page.route("**/*", async (route) => {
      const request = route.request();
      const requestUrl = request.url();

      try {
        await validateBrowserResourceUrl(requestUrl, botConfig, request.resourceType(), options);
      } catch {
        await route.abort();
        return;
      }

      if (blockedResourceTypes.has(request.resourceType())) {
        await route.abort();
        return;
      }

      await route.continue();
    });

    const response = await page.goto(pageUrl.href, {
      waitUntil: "domcontentloaded",
      timeout: options.navigationTimeoutMs || defaultNavigationTimeoutMs
    });

    if (!response) {
      throw new Error("Browser navigation did not return a response.");
    }

    const finalUrl = response.url();
    await validateCrawlUrl(finalUrl, botConfig, options);

    if (!response.ok()) {
      throw new Error(`HTTP ${response.status()}`);
    }

    await waitForMeaningfulDom(page, options);
    const html = await page.content();

    return {
      url: finalUrl,
      contentType: response.headers()["content-type"] || "text/html",
      html,
      diagnostics: await page.evaluate(() => ({
        title: document.title,
        bodyTextLength: document.body?.innerText?.length || 0,
        headingCount: document.querySelectorAll("h1,h2,h3,h4").length,
        paragraphCount: document.querySelectorAll("p").length,
        sectionCount: document.querySelectorAll("main,article,section").length,
        linkCount: document.querySelectorAll("a").length
      }))
    };
  } finally {
    await browser.close();
  }
}

export async function waitForMeaningfulDom(page, options = {}) {
  const timeout = options.renderReadyTimeoutMs || 10_000;
  await page
    .waitForFunction(
      () => {
        const bodyTextLength = document.body?.innerText?.trim().length || 0;
        const meaningfulNodes = document.querySelectorAll(
          "main,article,section,h1,h2,h3,h4,p,li"
        ).length;
        return bodyTextLength > 250 && meaningfulNodes >= 4;
      },
      undefined,
      { timeout }
    )
    .catch(async () => {
      await page.waitForLoadState("networkidle", { timeout: 3000 }).catch(() => {});
    });
}

export async function validateBrowserResourceUrl(
  url,
  botConfig,
  resourceType = "document",
  options = {}
) {
  const parsed = parseHttpUrl(url);
  validateProtocol(parsed, options);
  validateBotScope(parsed, botConfig);
  await validateNetworkTarget(parsed, options);

  if (resourceType === "script" || resourceType === "stylesheet") {
    validateRenderResourceDeniedPath(parsed, botConfig.deniedPathPatterns);
    return parsed;
  }

  validateDeniedPath(parsed, botConfig.deniedPathPatterns);
  return parsed;
}

function validateRenderResourceDeniedPath(parsed, botDeniedPathPatterns = []) {
  const patterns = [
    ...renderResourceDeniedPathPatterns,
    ...(botDeniedPathPatterns || []).filter(
      (pattern) => !extensionOnlyDeniedPatterns.has(String(pattern).toLowerCase())
    )
  ];
  const pathname = safeDecodePathname(parsed.pathname).toLowerCase();

  for (const rawPattern of patterns) {
    const pattern = String(rawPattern || "").toLowerCase();
    if (!pattern) {
      continue;
    }

    const denied =
      pattern.startsWith("/")
        ? pathname === pattern ||
          pathname.startsWith(`${pattern}/`) ||
          pathname.endsWith(pattern) ||
          pathname.includes(`${pattern}/`)
        : pathname.endsWith(pattern) || pathname.includes(pattern);

    if (denied) {
      throw new Error("Browser resource URL path is denied by crawl policy.");
    }
  }
}

function safeDecodePathname(pathname) {
  try {
    return decodeURIComponent(pathname);
  } catch {
    throw new Error("Browser resource URL path encoding is invalid.");
  }
}
