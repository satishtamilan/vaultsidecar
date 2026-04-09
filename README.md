# VaultSidecar 🔐

> **AI agent sidecar for your browser, secured by Auth0 Token Vault.**
> Built for the [Authorized to Act Hackathon](https://authorizedtoact.devpost.com).

---

## What it does

VaultSidecar is a browser extension that injects a context-aware AI agent into any supported webpage. Instead of switching to a separate chat UI, the agent lives in your browser sidebar and understands the page you're already on.

**On GitHub?** → Ask it to list repos, review a PR, or post a comment.
**On Slack?** → Ask it to list channels, read messages, or post to a channel.

All API calls are made using **Auth0 Token Vault** — the extension never sees your raw OAuth tokens or credentials.

---

## How Auth0 Token Vault is used

Token Vault is the backbone of VaultSidecar. Here's the exact flow:

```
User opens extension
       │
       ▼
Content script extracts page context (repo name, channel, etc.)
       │
       ▼
User sends message → popup.js → POST /api/agent (Next.js backend)
       │
       ▼
LangGraph agent decides which tool to call
       │
       ├── READ tool (list repos, list channels)
       │       │
       │       ▼
       │   Auth0 Token Vault performs federated token exchange
       │   ↳ Returns scoped access token — agent calls API ✅
       │
       └── WRITE tool (post comment, send message)
               │
               ▼
           CIBA initiated → user sees approval prompt in extension
           ↳ User approves → confirmCIBA() → action proceeds ✅
```

**The agent never handles credentials.** Auth0 Token Vault returns a scoped token for a single API call. No secrets in env vars, no tokens in memory beyond the request.

---

## Architecture

```
vaultsidecar/
├── extension/              # Chrome/Firefox Extension (Manifest V3)
│   ├── manifest.json       # Permissions, content script rules
│   ├── popup.html/css/js   # Extension UI: chat, CIBA approval, token manager
│   ├── content.js          # Page context extractor (GitHub/Slack/Gmail/Amazon)
│   └── background.js       # Service worker, auth callback handler
│
└── backend/                # Next.js 14 App Router
    ├── app/
    │   ├── api/
    │   │   ├── agent/          # POST: run agent, POST /approve: post-CIBA
    │   │   ├── auth/[auth0]/   # Auth0 login/logout/callback handlers
    │   │   ├── connect/        # Connected Accounts flow (connect + callback)
    │   │   ├── tokens/         # GET: token bar summary + detailed view
    │   │   └── me/             # GET: session user info
    │   └── extension-callback/ # Post-login redirect page
    └── lib/
        ├── auth0.ts            # Auth0 client + Token Vault helpers + CIBA
        ├── agent.ts            # LangGraph agent, CIBA interceptor, routing
        └── tools/
            ├── github.ts       # GitHub API tools (list repos, PRs, comment)
            ├── slack.ts        # Slack API tools (list channels, read/send messages)
            ├── gmail.ts        # Gmail API tools (list, read, send)
            └── amazon.ts       # Amazon tools (details, price, wishlist)
```

---

## Security model

| Concern | How VaultSidecar handles it |
|---|---|
| Raw credentials in agent | ❌ Never — Token Vault provides scoped tokens per request |
| Broad OAuth scopes | Minimal scopes requested per tool (`repo` for GitHub, `channels:read` for Slack) |
| Write actions without consent | Every write tool (PR comment, Slack message) requires CIBA step-up auth |
| Token visibility | Token manager shows connected services, scopes, and live validity status |
| Cross-site token reuse | Tokens are scoped to connection — GitHub token cannot be used for Slack |
| LLM privacy | Runs on a local model by default — conversations never leave your machine |

---

## Setup

### Prerequisites
- Node.js 18+
- Auth0 account (free tier works)
- LLM provider (local or cloud — see below)

### LLM configuration

VaultSidecar supports any OpenAI-compatible LLM. Set the provider in `.env.local`:

**Local model (default, recommended for privacy):**
```bash
LLM_PROVIDER=local
LOCAL_LLM_BASE_URL=http://localhost:11434   # Ollama
LOCAL_LLM_MODEL=llama3.1:8b
```

**OpenAI:**
```bash
LLM_PROVIDER=openai
OPENAI_API_KEY=sk-...
```

**Any OpenAI-compatible API** (Groq, Together, Anthropic via proxy, etc.):
```bash
LLM_PROVIDER=local
LOCAL_LLM_BASE_URL=https://api.groq.com/openai
LOCAL_LLM_MODEL=llama-3.1-70b-versatile
```

Using a local model means your queries and conversations stay on your machine. No data is sent to any third-party LLM provider.

### 1. Auth0 configuration

In your Auth0 dashboard:

1. Create a **Regular Web Application**
2. Add `http://localhost:3000/api/auth/callback` and `http://localhost:3000/api/connect/callback` to **Allowed Callback URLs**
3. Add `http://localhost:3000` to **Allowed Logout URLs**
4. Enable **Token Vault** grant type on your application
5. Activate the **Auth0 My Account API** and configure MRRT
6. Add **Social Connections**: GitHub (use a GitHub App, not OAuth App) and Slack (custom OAuth2)
7. Enable **Connected Accounts** on each connection
8. Enable **CIBA** under Advanced Settings → Grant Types

### 2. Backend

```bash
cd backend
cp .env.example .env.local
# Fill in your Auth0 credentials
npm install
npm run dev
```

If using a local model, start Ollama first:
```bash
ollama serve
# In another terminal: ollama pull llama3.1:8b (first time only)
```

Backend runs at `http://localhost:3000`.

### 3. Browser extension

**Chrome:**
1. Open `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked** → select the `extension/` folder

**Firefox:**
1. Open `about:debugging` → **This Firefox**
2. Click **Load Temporary Add-on** → select `extension/manifest.json`

Click the VaultSidecar icon in your toolbar, sign in with Auth0, and navigate to GitHub or Slack.

---

## Demo flow

1. Open VaultSidecar extension → sign in via Auth0
2. Connect GitHub and Slack in **Manage Tokens**
3. Ask: **"list my repos"** → GitHub repos listed via Token Vault
4. Ask: **"list my channels in slack"** → Slack channels listed
5. Ask: **"post hello to #general in slack"** → CIBA approval prompt → message sent
6. Navigate to a GitHub PR → ask: **"review this PR and post a comment"** → CIBA approval → comment posted
7. Token manager shows active connections with scopes and live validity

---

## What's next

- [ ] Google Calendar integration (check availability, create events)
- [ ] Gmail integration (read inbox, send replies)
- [ ] Scope risk analyzer (flag when a token has broader scopes than the agent uses)
- [ ] Multi-tenant support (teams sharing an agent with per-member token scopes)
- [ ] Intent classifier to replace keyword-based routing

---

## Built with

- [Auth0 for AI Agents](https://auth0.com/ai) — Token Vault, CIBA, Connected Accounts
- [LangGraph.js](https://langchain-ai.github.io/langgraphjs/) — agent framework
- [LangChain](https://js.langchain.com/) — tool definitions and LLM integration
- [Next.js 14](https://nextjs.org) — backend API
- [Ollama](https://ollama.com) — local LLM runtime (Llama 3.1 8B)
- Chrome/Firefox Extensions Manifest V3
- GitHub API, Slack API

---

*Built for the [Authorized to Act: Auth0 for AI Agents](https://authorizedtoact.devpost.com) hackathon.*
