# PlugBot AI

PlugBot AI is an embeddable AI chatbot platform. A vanilla JavaScript widget is
hosted publicly and sends visitor messages to a Render-hosted Express API. The
API resolves the requested bot, retrieves approved business knowledge, selects
relevant sanitized website knowledge, and routes a grounded prompt to the
configured AI provider.

## Current Architecture

```text
External business website
  -> Embeddable PlugBot JavaScript widget
  -> Vercel-hosted widget
  -> Render-hosted Express API
  -> Bot configuration resolver
  -> Knowledge resolver
  -> AI provider router
  -> mock | gemini | openai
```

Production hosting remains:

```text
GitHub source control
  -> Render: backend API from /backend
  -> Vercel: static /widget and /demo
  -> GitHub Pages or another external business website embeds the widget
```

The widget contract is unchanged:

```html
<script
  src="PUBLIC_VERCEL_WIDGET_URL/widget/plugbot-widget.js"
  data-api-url="https://plugbot-ai-6zea.onrender.com"
  data-bot-id="timetomarket-services">
</script>
```

No committed Vercel production domain is present in this repository. Use the
actual Vercel deployment domain for `PUBLIC_VERCEL_WIDGET_URL`; do not put
provider API keys in the widget or Vercel environment.

## Project Structure

```text
backend/
  scripts/
    smoke-check.js
    ingest-knowledge.js
  src/
    bots/
    knowledge/
    providers/
    server.js
demo/
widget/
```

## Bot Configuration

`data-bot-id` is sent unchanged from the widget to `POST /api/chat`. The backend
uses `backend/src/bots/index.js` to resolve that ID to a code-based bot
configuration. This is intentionally isolated behind a resolver so the storage
can later move to PostgreSQL, MongoDB, object storage, or another database.

Each bot can define:

- `botId`, `chatbotName`, `businessName`, `description`, `purpose`
- `websiteUrl`, `allowedOrigins`, `allowedPathPrefixes`, `deniedPathPatterns`
- `services`, `publicContactInformation`, `businessHours`, `faqs`
- `systemInstructions`, `responseBehavior`, `fallbackBehavior`
- `crawlEnabled`, `maximumCrawlPages`, `maximumCrawlDepth`, `crawlDelay`
- `contentFreshnessPolicy`

Unknown bot IDs never receive another customer's knowledge. They resolve to the
safe generic fallback bot, with the requested ID preserved internally for audit
logic.

## TimeToMarket Services Bot

Configured bot ID:

```text
timetomarket-services
```

Business configuration:

```text
Chatbot name: PlugBot AI
Business name: TimeToMarket Services
Website: https://engr-dolo.github.io/TimetoMarket-Services/
Allowed origin: https://engr-dolo.github.io
Allowed path prefix: /TimetoMarket-Services/
```

The bot is configured for professional, friendly, concise, consultative answers
about website development, web applications, custom digital platforms, digital
security, website protection, ongoing management, portfolio information when
publicly available, and consultation preparation. It must not invent prices,
discounts, contact details, business hours, guarantees, testimonials, portfolio
projects, or unsupported services.

## Safe Website Ingestion

Website ingestion is separate from chat requests. Chat never crawls websites and
visitor messages cannot control crawler URLs.

```text
Configured bot website
  -> crawl authorization validation
  -> SSRF checks
  -> robots.txt evaluation
  -> controlled crawl
  -> visible content extraction
  -> sensitive-data filtering
  -> normalization and dedupe
  -> sanitized JSON knowledge snapshot
  -> knowledge resolver for future chats
```

Static HTML fetch and extraction is the default ingestion mode. A bot can opt in
to `crawlRenderingMode: "browser"` only when its authorized public website
requires JavaScript execution before visible content exists in the DOM. Browser
rendering still uses the same bot URL authorization, SSRF checks, robots.txt
policy, denied paths, timeouts, page limits, and sensitive-data filtering. It is
used only by the ingestion command, never by chat requests.

Run ingestion locally from `backend/`:

```bash
npm run ingest -- --bot-id=timetomarket-services
```

The separated argument form is also supported:

```bash
npm run ingest -- --bot-id timetomarket-services
```

Inspect safe snapshot metadata without printing full knowledge text:

```bash
npm run knowledge:inspect -- --bot-id=timetomarket-services
```

The command prints only safe counts: pages discovered, crawled, skipped,
rejected, sensitive finding categories/counts, and knowledge section count. It
never prints detected sensitive values.

Sanitized snapshots are written through the knowledge store interface under
`backend/data/knowledge/` by default. Inspect generated snapshots as JSON and
review them before committing. They should contain only sanitized extracted text
and source metadata, never raw HTML or rejected sensitive content.

## Crawl Authorization

The presence of the widget on a website does not authorize crawling. Crawling is
allowed only when the backend bot configuration explicitly enables it and the URL
passes all of these checks:

- URL belongs to the configured bot.
- Origin is in `allowedOrigins`.
- Path starts with an allowed prefix.
- Path does not match denied patterns such as `/admin`, `/login`, `/api`,
  `/.git`, `/.env`, `/checkout`, `/payment`, `/profile`, source maps, JS, CSS,
  backups, database exports, or secret/config paths.
- Protocol is HTTPS by default.
- Host and DNS results do not resolve to forbidden networks.
- Every redirect target is validated again.

For TimeToMarket Services, the crawler may access only:

```text
https://engr-dolo.github.io/TimetoMarket-Services/
```

It must not crawl neighboring GitHub Pages repositories.

## SSRF Protection

The URL policy rejects localhost, `.localhost`, `.local`, `127.0.0.0/8`, `::1`,
private IPv4 ranges, link-local addresses, unique-local IPv6, IPv6 link-local,
cloud metadata targets, unsupported protocols, unauthorized origins, denied
paths, unsafe redirects, and redirect loops.

DNS is resolved before requests and redirect targets are validated. DNS
rebinding is still a known limitation of application-layer validation; production
hardening should add network egress controls where available.

## robots.txt and Responsible Crawling

The crawler fetches and evaluates `robots.txt`, identifies as:

```text
PlugBotKnowledgeCrawler/1.0
```

It does not impersonate browsers or search crawlers. It uses configured crawl
delay, maximum page count, maximum depth, request timeout, redirect limit, and
response size limit. It ingests only `text/html` and `text/plain` in this phase.

## Sensitive Data Filtering

The filter rejects or redacts likely sensitive content, including SSN-like
patterns, payment cards, private key blocks, API keys, bearer tokens, JWTs,
authorization headers, database URLs with credentials, password/secret
assignments, `.env`-style credential lines, OAuth client secrets, session-like
tokens, cloud access keys, and suspicious high-entropy strings.

Public business contact information may be retained when it is clearly presented
as official public business information, such as a business email, phone,
address, contact form URL, WhatsApp business contact, or public social media
link. When uncertain, prefer exclusion and review the snapshot before committing.

Pattern-based detection is not perfect. It is a defense-in-depth layer, not a
guarantee that every sensitive value can be detected.

## Prompt Injection Protection

Website content is treated as untrusted reference data. Provider prompts separate
system behavior, structured business knowledge, sanitized website references,
conversation history, and the current user request. Providers are instructed not
to follow instructions inside retrieved website content, not to reveal prompts or
configuration, and not to reproduce secrets.

Application filtering and bot isolation remain primary controls; model
instructions are an additional layer.

## Knowledge Store and Retrieval

The current MVP uses a pluggable JSON knowledge store. Render filesystem
persistence can be ephemeral, so local runtime-generated snapshots should not be
treated as durable production storage. To deploy JSON snapshots in this MVP,
generate them locally, review the sanitized content, commit the approved snapshot
files, push to GitHub, and redeploy Render.

The knowledge resolver combines structured bot configuration, FAQs, services,
public contact information, and sanitized website sections. Retrieval is simple
keyword overlap with stop-word removal, heading/title weighting, section limits,
and maximum context size. The whole website snapshot is not sent to providers on
every chat request.

Source metadata is retained internally for future citations:

- bot ID
- source URL
- page title
- crawl timestamp
- content hash
- section ID
- sensitivity and ingestion status

## Provider Context

`AI_PROVIDER=mock`, `AI_PROVIDER=gemini`, and `AI_PROVIDER=openai` are preserved.
Providers now receive a normalized input containing the current message,
history, resolved bot context, structured business knowledge, relevant sanitized
website knowledge, and behavior instructions.

Providers must not receive raw HTML, scripts, styles, comments, rejected
content, sensitive values, crawler logs, environment values, internal config
objects, or complete irrelevant knowledge stores.

Mock mode remains offline and reports whether structured knowledge was available
and whether relevant website knowledge was selected, without exposing system
instructions.

## Local Development

```bash
cd backend
npm install
cp ../.env.example .env
npm start
```

The API runs at `http://localhost:3000`. Open `demo/index.html` directly or
serve the repository root and visit `/demo/`.

## Environment

```env
NODE_ENV=development
PORT=3000
AI_PROVIDER=mock
ALLOWED_ORIGINS=http://localhost:3000,http://localhost:5173,http://localhost:61328

OPENAI_API_KEY=
OPENAI_MODEL=gpt-4o-mini

GEMINI_API_KEY=
GEMINI_MODEL=gemini-2.5-flash

RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX=30
```

Provider keys are backend-only secrets. Do not commit `.env`, put keys in the
widget, or configure provider keys in Vercel.

## API

```http
GET /health
GET /api/health
POST /api/chat
```

Chat request:

```json
{
  "botId": "timetomarket-services",
  "message": "What services do you offer?",
  "history": [
    { "role": "assistant", "content": "Hi. How can I help?" }
  ]
}
```

Chat response:

```json
{
  "reply": "The assistant reply",
  "botId": "timetomarket-services"
}
```

The response contract remains compatible with the existing widget.

## Testing

From `backend/`:

```bash
npm test
```

The smoke suite uses mock mode, injected fake provider clients, mocked crawl
responses, and temporary local knowledge snapshots. Tests do not crawl the real
TimeToMarket website, call Gemini, call OpenAI, call paid APIs, or depend on
public internet access.

Coverage includes bot resolution, cross-bot isolation, URL and redirect
security, extraction, sensitive filtering, relevance retrieval, context size
limits, missing snapshot fallback, CORS behavior, JSON validation, large valid
payloads, malformed JSON, oversized JSON, mock provider behavior, and provider
error sanitization.

## Adding a New Bot

1. Add a new file in `backend/src/bots/`.
2. Define explicit `botId`, business identity, services, FAQs, response rules,
   website URL, allowed origins, allowed path prefixes, denied paths, and crawl
   limits.
3. Register it in `backend/src/bots/index.js`.
4. Add tests for resolution and isolation.
5. Configure Render `ALLOWED_ORIGINS` for the website origin.
6. Run ingestion only after explicit crawl authorization is configured.
7. Review sanitized snapshots before committing them.

Changing only `data-bot-id` on a business website is sufficient only if the
backend already has a matching bot configuration, Render has the website origin
allowed in `ALLOWED_ORIGINS`, and any needed sanitized knowledge snapshot has
been deployed.

## Deployment Implications

GitHub push is required for backend code changes, bot configuration changes,
README changes, widget changes, and checked-in sanitized snapshots.

Render redeployment is required for backend code, provider context changes, bot
configuration changes, environment variable changes, and committed knowledge
snapshot updates. Render environment variables may need updates when adding a new
allowed browser origin or switching `AI_PROVIDER`.

Vercel redeployment is required only for widget or demo changes. This phase does
not change the widget API contract.

Business website changes are required only when changing the script `src`,
`data-api-url`, `data-bot-id`, or optional widget title. For the current
TimeToMarket integration, `data-bot-id` should be:

```text
timetomarket-services
```

## Security Limitations

Known limitations:

- Pattern-based sensitive-data detection can miss or over-redact content.
- DNS rebinding cannot be fully solved in application code alone.
- Local JSON storage is not durable production storage on ephemeral filesystems.
- There is no admin dashboard, authentication, customer registration, automated
  domain ownership verification, or scheduled ingestion yet.
- Retrieval is simple keyword relevance, not embeddings or reranking.
- Source metadata is stored for future citations, but the widget does not expose
  citation UI yet.

## Future Architecture

This phase is designed to evolve toward:

```text
Customer registration
  -> domain ownership verification
  -> bot creation
  -> website crawl authorization
  -> scheduled ingestion jobs
  -> document and website knowledge pipeline
  -> embeddings
  -> vector or hybrid search
  -> reranking
  -> grounded AI responses
  -> source citations
  -> analytics dashboard
```

Future work should replace JSON snapshots with durable multi-tenant storage,
add domain verification, add admin-controlled ingestion scheduling, support
document uploads, add vector or hybrid retrieval, implement citations, and build
an admin dashboard.
