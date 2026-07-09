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
      "PlugBot AI"
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
      z-index: 2147483647;
      font-family: Arial, Helvetica, sans-serif;
      color: #111827;
    }

    .plugbot-launcher {
      width: 58px;
      height: 58px;
      border: 0;
      border-radius: 50%;
      background: #111827;
      color: #ffffff;
      cursor: pointer;
      box-shadow: 0 10px 28px rgba(17, 24, 39, 0.28);
      font-size: 25px;
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
      padding: 14px 16px;
      background: #111827;
      color: #ffffff;
      font-size: 15px;
      font-weight: 700;
    }

    .plugbot-close {
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

    .plugbot-message {
      max-width: 82%;
      margin: 0 0 10px;
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
      }

      .plugbot-window {
        width: calc(100vw - 24px);
        height: min(560px, calc(100vh - 88px));
      }
    }
  `;

  const root = document.createElement("div");
  root.className = "plugbot-root";
  root.innerHTML = `
    <section class="plugbot-window" aria-label="${escapeHtml(config.title)} chat">
      <header class="plugbot-header">
        <span>${escapeHtml(config.title)}</span>
        <button class="plugbot-close" type="button" aria-label="Close chat">&times;</button>
      </header>
      <div class="plugbot-messages" role="log" aria-live="polite"></div>
      <form class="plugbot-form" aria-label="Send a chat message">
        <input class="plugbot-input" type="text" autocomplete="off" maxlength="4000" placeholder="Type your message" aria-label="Message" />
        <button class="plugbot-send" type="submit">Send</button>
      </form>
      <div class="plugbot-status" aria-live="polite"></div>
    </section>
    <button class="plugbot-launcher" type="button" aria-label="Open chat" aria-expanded="false">💬</button>
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

  addMessage("assistant", "Hi. How can I help?");

  launcher.addEventListener("click", () => {
    state.open = !state.open;
    root.classList.toggle("is-open", state.open);
    launcher.setAttribute("aria-expanded", String(state.open));
    launcher.setAttribute("aria-label", state.open ? "Close chat" : "Open chat");
    if (state.open) {
      input.focus();
    }
  });

  closeButton.addEventListener("click", () => {
    state.open = false;
    root.classList.remove("is-open");
    launcher.setAttribute("aria-expanded", "false");
    launcher.setAttribute("aria-label", "Open chat");
    launcher.focus();
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
    state.history.push({ role, content });
    return appendMessage(role, content);
  }

  function appendMessage(role, content) {
    const item = document.createElement("div");
    item.className = `plugbot-message ${role}`;
    item.textContent = content;
    messages.appendChild(item);
    messages.scrollTop = messages.scrollHeight;
    return item;
  }

  function setLoading(loading) {
    state.loading = loading;
    input.disabled = loading;
    sendButton.disabled = loading;
    sendButton.textContent = loading ? "Sending..." : "Send";
    status.textContent = loading ? "PlugBot is thinking..." : "";
    if (loading) {
      state.loadingMessage = appendMessage("assistant", "Thinking...");
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
