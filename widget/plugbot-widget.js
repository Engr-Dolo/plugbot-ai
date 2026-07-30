(function () {
  if (window.__PlugBotWidgetMounted) {
    return;
  }

  window.__PlugBotWidgetMounted = true;

  const currentScript = document.currentScript;
  const globalConfig = window.PlugBot || {};
  const config = {
    botId:
      globalConfig.botId ||
      currentScript?.dataset.botId ||
      "demo-bot",
    apiUrl:
      normalizeApiUrl(
        globalConfig.apiUrl ||
          currentScript?.dataset.apiUrl ||
          "http://localhost:3000"
      ),
    title:
      globalConfig.title ||
      currentScript?.dataset.title ||
      "PlugBot AI",
    avatarUrl: deriveWidgetAssetUrl(currentScript?.src, "assets/plugbot-ai-avatar.png")
  };

  const state = {
    open: false,
    loading: false,
    history: [],
    loadingMessage: null
  };
  const fallbackErrorMessage =
    "Sorry, I cannot answer right now. Please try again in a moment.";
  const timeoutErrorMessage =
    "The response is taking longer than expected. Please try again.";
  const requestTimeoutMs = 30_000;

  const styles = document.createElement("style");
  styles.textContent = `
    .plugbot-root {
      position: fixed;
      right: 20px;
      bottom: 20px;
      display: flex;
      max-width: calc(100vw - 32px);
      flex-direction: column;
      align-items: flex-end;
      z-index: 2147483647;
      font-family: Arial, Helvetica, sans-serif;
      color: #111827;
    }

    .plugbot-root,
    .plugbot-root * {
      box-sizing: border-box;
    }

    .plugbot-launcher {
      position: relative;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 62px;
      height: 62px;
      border: 1px solid rgba(96, 165, 250, 0.55);
      border-radius: 50%;
      background: linear-gradient(145deg, #0f172a, #1e3a8a);
      color: #ffffff;
      cursor: pointer;
      box-shadow: 0 12px 30px rgba(15, 23, 42, 0.32);
      padding: 0;
      transition: transform 160ms ease, box-shadow 160ms ease;
    }

    .plugbot-launcher:hover {
      transform: translateY(-2px);
      box-shadow: 0 16px 36px rgba(15, 23, 42, 0.36);
    }

    .plugbot-launcher:focus-visible,
    .plugbot-close:focus-visible,
    .plugbot-input:focus-visible,
    .plugbot-send:focus-visible {
      outline: 3px solid rgba(59, 130, 246, 0.7);
      outline-offset: 3px;
    }

    .plugbot-online-dot {
      position: absolute;
      right: 5px;
      bottom: 5px;
      width: 12px;
      height: 12px;
      border: 2px solid #ffffff;
      border-radius: 999px;
      background: #38bdf8;
      box-shadow: 0 0 0 2px rgba(56, 189, 248, 0.18);
    }

    .plugbot-window {
      display: none;
      width: 360px;
      max-width: calc(100vw - 32px);
      height: 520px;
      max-height: calc(100vh - 96px);
      margin-bottom: 12px;
      overflow: hidden;
      border: 1px solid #e5e7eb;
      border-radius: 8px;
      background: #ffffff;
      box-shadow: 0 18px 50px rgba(17, 24, 39, 0.22);
    }

    .plugbot-root.is-open .plugbot-window {
      display: flex;
      flex-direction: column;
    }

    .plugbot-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 13px 14px;
      background: linear-gradient(135deg, #0f172a, #102a56);
      color: #ffffff;
    }

    .plugbot-header-identity {
      display: flex;
      min-width: 0;
      align-items: center;
      gap: 10px;
    }

    .plugbot-header-copy {
      min-width: 0;
    }

    .plugbot-title {
      display: block;
      overflow: hidden;
      color: #ffffff;
      font-size: 15px;
      font-weight: 700;
      line-height: 1.2;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .plugbot-subtitle {
      display: block;
      color: #bfdbfe;
      font-size: 12px;
      font-weight: 500;
      line-height: 1.3;
    }

    .plugbot-close {
      flex: 0 0 auto;
      border: 0;
      background: transparent;
      color: #ffffff;
      cursor: pointer;
      font-size: 22px;
      line-height: 1;
    }

    .plugbot-messages {
      flex: 1;
      padding: 14px;
      overflow-y: auto;
      background: #f9fafb;
    }

    .plugbot-message-row {
      display: flex;
      align-items: flex-end;
      gap: 8px;
      margin: 0 0 10px;
    }

    .plugbot-message-row.user {
      justify-content: flex-end;
    }

    .plugbot-message-row.assistant.grouped {
      padding-left: 36px;
    }

    .plugbot-message {
      max-width: 82%;
      margin: 0;
      padding: 10px 12px;
      border-radius: 8px;
      line-height: 1.4;
      font-size: 14px;
      word-wrap: break-word;
      overflow-wrap: anywhere;
      word-break: break-word;
      white-space: pre-wrap;
    }

    .plugbot-message.assistant {
      background: #ffffff;
      border: 1px solid #e5e7eb;
    }

    .plugbot-message.user {
      margin-left: auto;
      background: #111827;
      color: #ffffff;
    }

    .plugbot-avatar {
      position: relative;
      display: inline-flex;
      flex: 0 0 auto;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      border-radius: 50%;
      background: linear-gradient(145deg, #0f172a, #1d4ed8);
      color: #ffffff;
      font-weight: 800;
      letter-spacing: 0.01em;
      user-select: none;
    }

    .plugbot-avatar.launcher {
      width: 58px;
      height: 58px;
      font-size: 17px;
    }

    .plugbot-avatar.header {
      width: 40px;
      height: 40px;
      border: 1px solid rgba(191, 219, 254, 0.45);
      font-size: 12px;
    }

    .plugbot-avatar.message {
      width: 28px;
      height: 28px;
      border: 1px solid rgba(148, 163, 184, 0.35);
      font-size: 10px;
    }

    .plugbot-avatar img {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      object-fit: cover;
      object-position: 50% 42%;
      opacity: 0;
      transition: opacity 120ms ease;
    }

    .plugbot-avatar.is-loaded img {
      opacity: 1;
    }

    .plugbot-avatar.is-failed img {
      display: none;
    }

    .plugbot-avatar-fallback {
      position: relative;
      z-index: 1;
    }

    .plugbot-avatar.is-loaded .plugbot-avatar-fallback {
      opacity: 0;
    }

    .plugbot-form {
      display: flex;
      gap: 8px;
      padding: 12px;
      border-top: 1px solid #e5e7eb;
      background: #ffffff;
    }

    .plugbot-input {
      min-width: 0;
      flex: 1;
      border: 1px solid #d1d5db;
      border-radius: 8px;
      padding: 10px 11px;
      font: inherit;
    }

    .plugbot-send {
      border: 0;
      border-radius: 8px;
      background: #111827;
      color: #ffffff;
      cursor: pointer;
      padding: 0 14px;
      font-weight: 700;
    }

    .plugbot-send:disabled,
    .plugbot-input:disabled {
      cursor: not-allowed;
      opacity: 0.65;
    }

    .plugbot-status {
      min-height: 18px;
      padding: 0 12px 8px;
      background: #ffffff;
      color: #4b5563;
      font-size: 12px;
    }

    @media (max-width: 480px) {
      .plugbot-root {
        right: 12px;
        bottom: 12px;
        max-width: calc(100vw - 24px);
      }

      .plugbot-launcher {
        width: 56px;
        height: 56px;
      }

      .plugbot-avatar.launcher {
        width: 52px;
        height: 52px;
      }

      .plugbot-window {
        width: calc(100vw - 24px);
        height: min(560px, calc(100vh - 88px));
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .plugbot-launcher,
      .plugbot-avatar img {
        transition: none;
      }

      .plugbot-launcher:hover {
        transform: none;
      }
    }
  `;

  const root = document.createElement("div");
  root.className = "plugbot-root";
  root.innerHTML = `
    <section class="plugbot-window" role="dialog" aria-modal="false" aria-label="${escapeHtml(config.title)} chat">
      <header class="plugbot-header">
        <div class="plugbot-header-identity">
          <span class="plugbot-header-avatar"></span>
          <span class="plugbot-header-copy">
            <span class="plugbot-title">${escapeHtml(config.title)}</span>
            <span class="plugbot-subtitle">AI Assistant</span>
          </span>
        </div>
        <button class="plugbot-close" type="button" aria-label="Close chat">&times;</button>
      </header>
      <div class="plugbot-messages" role="log" aria-live="polite"></div>
      <form class="plugbot-form" aria-label="Send a chat message">
        <input class="plugbot-input" type="text" autocomplete="off" maxlength="4000" placeholder="Type your message" aria-label="Message" />
        <button class="plugbot-send" type="submit">Send</button>
      </form>
      <div class="plugbot-status" aria-live="polite"></div>
    </section>
    <button class="plugbot-launcher" type="button" aria-label="Open PlugBot AI assistant" aria-expanded="false">
      <span class="plugbot-launcher-avatar"></span>
      <span class="plugbot-online-dot" aria-hidden="true"></span>
    </button>
  `;

  mountWhenBodyReady(() => {
    (document.head || document.documentElement).appendChild(styles);
    document.body.appendChild(root);
  });

  const launcher = root.querySelector(".plugbot-launcher");
  const closeButton = root.querySelector(".plugbot-close");
  const form = root.querySelector(".plugbot-form");
  const input = root.querySelector(".plugbot-input");
  const sendButton = root.querySelector(".plugbot-send");
  const messages = root.querySelector(".plugbot-messages");
  const status = root.querySelector(".plugbot-status");
  const headerAvatar = root.querySelector(".plugbot-header-avatar");
  const launcherAvatar = root.querySelector(".plugbot-launcher-avatar");

  headerAvatar.appendChild(createAvatarElement("header", { alt: "" }));
  launcherAvatar.appendChild(
    createAvatarElement("launcher", { alt: "PlugBot AI assistant" })
  );

  addMessage("assistant", "Hi. How can I help?");

  launcher.addEventListener("click", () => {
    state.open = !state.open;
    root.classList.toggle("is-open", state.open);
    launcher.setAttribute("aria-expanded", String(state.open));
    launcher.setAttribute(
      "aria-label",
      state.open ? "Close PlugBot AI assistant" : "Open PlugBot AI assistant"
    );
    if (state.open) {
      input.focus();
    }
  });

  closeButton.addEventListener("click", () => {
    closeChat();
  });

  root.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && state.open) {
      event.preventDefault();
      closeChat();
    }
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (!state.loading) {
        form.requestSubmit();
      }
    }
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();

    const message = input.value.trim();
    if (!message || state.loading) {
      return;
    }

    const priorHistory = state.history.slice(-10);
    input.value = "";
    addMessage("user", message);
    setLoading(true);

    const controller =
      typeof AbortController !== "undefined" ? new AbortController() : null;
    const timeoutId = controller
      ? window.setTimeout(() => controller.abort(), requestTimeoutMs)
      : null;

    try {
      const response = await fetch(joinApiUrl(config.apiUrl, "/api/chat"), {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: controller?.signal,
        body: JSON.stringify({
          botId: config.botId,
          message,
          history: priorHistory
        })
      });

      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(mapServerError(payload.error));
      }

      addMessage("assistant", payload.reply || "I could not generate a response.");
    } catch (error) {
      const message =
        error?.name === "AbortError"
          ? timeoutErrorMessage
          : error?.message || fallbackErrorMessage;

      addMessage("assistant", message);
    } finally {
      if (timeoutId) {
        window.clearTimeout(timeoutId);
      }

      setLoading(false);
      input.focus();
    }
  });

  function addMessage(role, content) {
    const previousRole = state.history[state.history.length - 1]?.role;
    state.history.push({ role, content });
    return appendMessage(role, content, {
      showAvatar: role === "assistant" && previousRole !== "assistant"
    });
  }

  function closeChat() {
    state.open = false;
    root.classList.remove("is-open");
    launcher.setAttribute("aria-expanded", "false");
    launcher.setAttribute("aria-label", "Open PlugBot AI assistant");
    launcher.focus();
  }

  function appendMessage(role, content, options = {}) {
    const row = document.createElement("div");
    row.className = `plugbot-message-row ${role}`;

    if (role === "assistant") {
      if (options.showAvatar) {
        row.appendChild(createAvatarElement("message", { alt: "" }));
      } else {
        row.classList.add("grouped");
      }
    }

    const item = document.createElement("div");
    item.className = `plugbot-message ${role}`;
    item.textContent = content;
    row.appendChild(item);
    messages.appendChild(row);
    messages.scrollTop = messages.scrollHeight;
    return row;
  }

  function setLoading(loading) {
    state.loading = loading;
    input.disabled = loading;
    sendButton.disabled = loading;
    sendButton.textContent = loading ? "Sending..." : "Send";
    status.textContent = loading ? "PlugBot is thinking..." : "";
    if (loading) {
      state.loadingMessage = appendMessage("assistant", "PlugBot is thinking...", {
        showAvatar: true
      });
    } else if (state.loadingMessage?.parentNode) {
      state.loadingMessage.parentNode.removeChild(state.loadingMessage);
      state.loadingMessage = null;
      messages.scrollTop = messages.scrollHeight;
    }
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function normalizeApiUrl(value) {
    const normalized = String(value || "").trim().replace(/\/+$/, "");
    return normalized || "http://localhost:3000";
  }

  function deriveWidgetAssetUrl(scriptSrc, assetPath) {
    if (!scriptSrc) {
      return "";
    }

    try {
      const scriptUrl = new URL(scriptSrc, document.baseURI);
      if (!["http:", "https:", "file:"].includes(scriptUrl.protocol)) {
        return "";
      }

      return new URL(assetPath, scriptUrl).href;
    } catch {
      return "";
    }
  }

  function createAvatarElement(size, { alt = "" } = {}) {
    const avatar = document.createElement("span");
    avatar.className = `plugbot-avatar ${size}`;

    const fallback = document.createElement("span");
    fallback.className = "plugbot-avatar-fallback";
    fallback.textContent = "PB";
    avatar.appendChild(fallback);

    if (!config.avatarUrl) {
      avatar.classList.add("is-failed");
      return avatar;
    }

    const image = document.createElement("img");
    image.src = config.avatarUrl;
    image.alt = alt;
    image.width = size === "launcher" ? 58 : size === "header" ? 40 : 28;
    image.height = image.width;
    image.decoding = "async";
    image.loading = size === "launcher" ? "eager" : "lazy";
    image.addEventListener("load", () => {
      avatar.classList.add("is-loaded");
    });
    image.addEventListener("error", () => {
      avatar.classList.add("is-failed");
      image.removeAttribute("src");
    });
    avatar.appendChild(image);

    return avatar;
  }

  function joinApiUrl(baseUrl, path) {
    return `${String(baseUrl || "").replace(/\/+$/, "")}/${String(path || "").replace(/^\/+/, "")}`;
  }

  function mapServerError(message) {
    const text = String(message || "");
    if (!text) {
      return fallbackErrorMessage;
    }

    if (
      text.includes("temporarily unavailable") ||
      text.includes("many requests") ||
      text.includes("longer than expected")
    ) {
      return text;
    }

    return fallbackErrorMessage;
  }

  function mountWhenBodyReady(callback) {
    if (document.body) {
      callback();
      return;
    }

    document.addEventListener("DOMContentLoaded", callback, { once: true });
  }
})();
