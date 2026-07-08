# PlugBot AI

PlugBot AI is an MVP embeddable AI chatbot platform. It serves a vanilla
JavaScript widget from a static host and sends chat requests to an Express API,
which routes requests to the configured AI provider.

## Current Architecture

```text
External Website
  -> Public widget script
  -> Express REST API
  -> AI Provider Router
  -> mock | openai | gemini
```

Production MVP target:

```text
GitHub
  -> Render: backend API from /backend
  -> Vercel: static /widget and /demo
```

## Project Structure

```text
plugbot-ai/
  backend/
    package.json
    package-lock.json
    scripts/smoke-check.js
    src/server.js
    src/providers/
  demo/
    index.html
  widget/
    plugbot-widget.js
  .env.example
  .gitignore
  vercel.json
  README.md
```

## Local Development

The backend requires Node.js 20 or newer.

```bash
cd backend
npm install
cp ../.env.example .env
npm start
```

The API runs at `http://localhost:3000` by default.

Open `demo/index.html` directly in a browser, or serve the repo root with any
static file server and visit `/demo/`.

## Mock Provider Setup

Mock mode is free and does not call any external AI provider.

```env
NODE_ENV=development
AI_PROVIDER=mock
PORT=3000
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5173,http://localhost:61328
```

Use mock mode for local widget work and smoke tests.

## Gemini Provider Setup

Gemini mode uses the official Google Gen AI JavaScript SDK.

```env
AI_PROVIDER=gemini
GEMINI_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemini-2.5-flash
```

Keep `GEMINI_API_KEY` backend-only. Do not put it in the widget, demo HTML,
Vercel environment variables, or browser code.

## OpenAI Provider Setup

```env
AI_PROVIDER=openai
OPENAI_API_KEY=your_openai_api_key
OPENAI_MODEL=gpt-4o-mini
```

OpenAI mode requires OpenAI API billing. ChatGPT Plus does not include API
credits.

## Running Tests

From `backend/`:

```bash
npm test
```

The smoke test forces `AI_PROVIDER=mock`, injects fake provider clients for
OpenAI/Gemini error checks, and never calls paid external AI providers.

## API

```http
GET /health
GET /api/health
POST /api/chat
```

Chat request:

```json
{
  "botId": "demo-bot",
  "message": "Hello",
  "history": [
    { "role": "assistant", "content": "Hi. How can I help?" }
  ]
}
```

Chat response:

```json
{
  "reply": "Hello! How can I help?",
  "botId": "demo-bot"
}
```

## GitHub Push Instructions

Run these manually after choosing your GitHub repository URL:

```bash
git init
git add .
git commit -m "Prepare PlugBot AI MVP for deployment"
git branch -M main
git remote add origin <GITHUB_REPOSITORY_URL>
git push -u origin main
```

Do not commit `.env` or `backend/.env`.

## Render Backend Deployment

1. Push the repository to GitHub.
2. In Render, create a new Web Service.
3. Connect the GitHub repository.
4. Use these settings:

```text
Root Directory: backend
Runtime: Node.js 20 or newer
Build Command: npm ci
Start Command: npm start
Health Check Path: /health
```

5. Configure Render environment variables:

```env
NODE_ENV=production
AI_PROVIDER=gemini
GEMINI_API_KEY=<secret configured only in Render>
GEMINI_MODEL=gemini-2.5-flash
ALLOWED_ORIGINS=https://YOUR-VERCEL-DOMAIN.vercel.app
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX=30
```

6. Deploy.
7. Test the public health endpoint:

```bash
curl https://YOUR-RENDER-SERVICE.onrender.com/health
```

Expected response:

```json
{ "ok": true, "service": "plugbot-backend" }
```

Render provides `PORT`; the server uses `process.env.PORT || 3000` and does not
require a committed `.env` file.

## Vercel Deployment

Vercel serves the static demo and widget from the repository root.

1. Import the GitHub repository into Vercel.
2. Use these settings:

```text
Framework Preset: Other
Root Directory: ./
Build Command: leave empty
Output Directory: leave empty
Install Command: leave empty
```

3. Deploy.
4. Verify:

```text
https://YOUR-VERCEL-DOMAIN.vercel.app/demo/
https://YOUR-VERCEL-DOMAIN.vercel.app/widget/plugbot-widget.js
```

The demo defaults to `http://localhost:3000` for local file/localhost usage.
For production, either update `window.PlugBotDemo.productionApiUrl` in
`demo/index.html` before deploying, or visit:

```text
https://YOUR-VERCEL-DOMAIN.vercel.app/demo/?apiUrl=https%3A%2F%2FYOUR-RENDER-SERVICE.onrender.com
```

The Render API URL is not secret. Do not add Gemini or OpenAI API keys to
Vercel.

## Production CORS Configuration

Set `ALLOWED_ORIGINS` in Render to the browser origins allowed to call the API:

```env
ALLOWED_ORIGINS=https://YOUR-VERCEL-DOMAIN.vercel.app
```

Multiple origins are comma-separated:

```env
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5173,https://plugbot-ai.vercel.app
```

For the current MVP, `ALLOWED_ORIGINS` is a global allowlist. The long-term
multi-tenant production architecture should store allowed domains per bot in a
database instead of using one global environment variable.

## External Website Integration

Add this script tag to any allowed external website:

```html
<script
  src="https://YOUR-VERCEL-DOMAIN.vercel.app/widget/plugbot-widget.js"
  data-api-url="https://YOUR-RENDER-SERVICE.onrender.com"
  data-bot-id="demo-bot">
</script>
```

Attributes:

```text
src: Public Vercel URL for the widget JavaScript.
data-api-url: Public Render backend URL, without /api/chat.
data-bot-id: Bot identifier sent to the provider router.
```

The external website origin must be included in Render `ALLOWED_ORIGINS`.

## Troubleshooting

`CORS error`: Add the exact website origin to Render `ALLOWED_ORIGINS`, then
redeploy/restart the backend if needed. Include scheme and host, for example
`https://example.com`.

`401/403 provider authentication`: Check that the provider API key is configured
in Render and that `AI_PROVIDER` matches the intended provider.

`429 quota error`: The provider account has exhausted quota or billing. Add
billing/quota or switch to `AI_PROVIDER=mock` for local testing.

`Render cold starts`: Free Render services may sleep. The first request can be
slow while the backend wakes up.

`Wrong data-api-url`: The widget `data-api-url` must be the Render service root,
for example `https://YOUR-RENDER-SERVICE.onrender.com`, not `/api/chat`.

`Missing environment variables`: Render production does not use committed `.env`
files. Configure environment variables in the Render dashboard.

`Mock mode accidentally enabled in production`: Set `AI_PROVIDER=gemini` in
Render and confirm logs show the backend redeployed.

## MVP Limitations

- Bot configuration is not database-backed yet.
- There is no admin dashboard yet.
- There is no RAG or document knowledge base yet.
- There is no authentication yet.
- Conversation history is only kept in the widget during the page session.
- The global `ALLOWED_ORIGINS` setting is temporary MVP architecture.
