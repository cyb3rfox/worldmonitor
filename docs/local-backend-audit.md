# Local backend endpoint audit (desktop sidecar)

Critical `/api/*` endpoints used by `src/services/*` were reviewed and prioritized for desktop parity:

## Priority 1: News + summarization
- `/api/rss-proxy` (feed ingestion)
- `/api/hackernews`
- `/api/github-trending`
- `/api/groq-summarize`
- `/api/openrouter-summarize`

## Priority 2: Markets + core telemetry
- `/api/coingecko`
- `/api/polymarket`
- `/api/finnhub`
- `/api/yahoo-finance`
- `/api/cache-telemetry`

## Priority 3: Status / runtime health
- `/api/service-status`
- `/api/local-status` (new local-sidecar health endpoint)

## Localization strategy
- The desktop sidecar now executes existing `api/*.js` handlers directly when available, avoiding reliance on Vercel edge runtime for core behavior.
- If a handler is not present or fails locally, the sidecar can optionally pass through to cloud (`https://worldmonitor.app`) so functionality degrades gracefully.
- `ServiceStatusPanel` renders local backend status in desktop mode so users can see whether local mode is active and which cloud fallback target is configured.
