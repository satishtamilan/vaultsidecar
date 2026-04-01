# VaultSidecar 🔐

> **AI agent sidecar for your browser, secured by Auth0 Token Vault.**
> Built for the [Authorized to Act Hackathon](https://authorizedtoact.devpost.com).

---

## What it does

VaultSidecar is a Chrome extension that injects a context-aware AI agent into any supported webpage. Instead of switching to a separate chat UI, the agent lives in your browser sidebar and understands the page you're already on.

**On GitHub?** → Ask it to review a PR and post a comment.
**In Gmail?** → Ask it to draft and send a reply.
**On Amazon?** → Ask it to add a product to your wishlist.

All API calls are made using **Auth0 Token Vault** — the extension never sees your raw OAuth tokens or credentials.

---

## How Auth0 Token Vault is used

Token Vault is the backbone of VaultSidecar. Here's the exact flow:

```
User opens extension
       │
       ▼
Content script extracts page context (PR number, email subject, etc.)
       │
       ▼
User sends message → popup.js → POST /api/agent (Next.js backend)
       │
       ▼
LangGraph agent decides which tool to call
       │
       ├── READ tool (list PRs, read email)
       │       │
       │       ▼
       │   getTokenForConnection("github", ["repo"])
       │   ↳ Auth0 Token Vault performs federated token exchange
       │   ↳ Returns scoped access token — agent calls GitHub API ✅
       │
       └── WRITE tool (post comment, send email)
               │
               ▼
           CIBA initiated → user sees approval prompt in extension
           ↳ Auth0 sends push notification to user's device
           ↳ User approves → confirmCIBA() → action proceeds ✅
```

**The agent never handles credentials.** It calls `getTokenForConnection()`, Auth0 Token Vault returns a scoped JWT, and that token is used for a single API call. No secrets in env vars, no tokens in memory beyond the request.

---

## Architecture

```
vaultsidecar/
├── extension/              # Chrome Extension (Manifest V3)
│   ├── manifest.json       # Permissions, content script rules
│   ├── popup.html/css/js   # Extension UI: chat, CIBA approval, token manager
│   ├── content.js          # Page context extractor (GitHub/Gmail/Amazon)
│   └── background.js       # Service worker, auth callback handler
│
└── backend/                # Next.js 14 App Router
    ├── app/
    │   ├── api/
    │   │   ├── agent/          # POST: run agent, POST /approve: post-CIBA
    │   │   ├── auth/[auth0]/   # Auth0 login/logout/callback handlers
    │   │   ├── tokens/         # GET: token bar summary + detailed view
    │   │   └── me/             # GET: session user info
    │   └── extension-callback/ # Post-login redirect page
    └── lib/
        ├── auth0.ts            # Auth0 client + Token Vault helpers + CIBA
        ├── agent.ts            # LangGraph agent, CIBA interceptor, routing
        └── tools/
            ├── github.ts       # GitHub API tools (list PRs, get details, comment)
            ├── gmail.ts        # Gmail API tools (list, read, send)
            └── amazon.ts       # Amazon tools (details, price, wishlist)
```

---

## Security model

| Concern | How VaultSidecar handles it |
|---|---|
| Raw credentials in agent | ❌ Never — Token Vault provides scoped JWTs per request |
| Broad OAuth scopes | Minimal scopes requested per tool (`repo` for GitHub reads, `gmail.send` only for send) |
| Write actions without consent | Every write tool (comment, send email, add to wishlist) requires CIBA step-up auth |
| Token visibility | Extension token bar shows which services are connected; token manager shows scopes and expiry |
| Cross-site token reuse | Tokens are scoped to connection — GitHub token cannot be used for Gmail |

---

## Setup

### Prerequisites
- Node.js 18+
- Auth0 account (free tier works)
- OpenAI API key

### 1. Auth0 configuration

In your Auth0 dashboard:

1. Create a **Regular Web Application**
2. Add `http://localhost:3000/api/auth/callback` to **Allowed Callback URLs**
3. Add `http://localhost:3000` to **Allowed Logout URLs**
4. Enable **Token Vault** under your tenant settings
5. Add **Social Connections**: GitHub and Google OAuth2
6. Enable **CIBA** (Client-Initiated Backchannel Authentication) under Advanced Settings → Grant Types

### 2. Backend

```bash
cd backend
cp .env.example .env.local
# Fill in your Auth0 credentials and OpenAI key
npm install
npm run dev
```

Backend runs at `http://localhost:3000`.

### 3. Chrome extension

1. Open Chrome → `chrome://extensions`
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select the `extension/` folder

Click the VaultSidecar icon in your toolbar, sign in with Auth0, and navigate to GitHub, Gmail, or Amazon.

---

## Demo flow (for judges)

1. Navigate to any GitHub PR, e.g. `github.com/owner/repo/pull/1`
2. Open VaultSidecar → context pill shows "🐙 GitHub: PR title"
3. Click suggestion: **"Review this PR and post a comment"**
4. Extension shows CIBA approval card: *"Agent wants to post a comment on PR #1. Approve?"*
5. Click **Approve** → Auth0 sends push notification (or confirm in Auth0 Universal Login)
6. Agent posts comment → token bar updates showing active GitHub token

Then switch to Gmail, repeat with **"Draft a reply to this email"** — same extension, different Token Vault token, same CIBA flow.

---

## What's next

- [ ] Slack notifications (send messages to channels)
- [ ] Google Calendar (check availability, create events)
- [ ] Scope risk analyser (flag when a token has broader scopes than the agent ever uses)
- [ ] Multi-tenant support (teams sharing an agent with per-member token scopes)

---

## Built with

- [Auth0 for AI Agents](https://auth0.com/ai) — Token Vault, CIBA
- [LangGraph.js](https://langchain-ai.github.io/langgraphjs/) — agent framework
- [Next.js 14](https://nextjs.org) — backend API
- Chrome Extensions Manifest V3
- GitHub API, Gmail API

---

*Built for the [Authorized to Act: Auth0 for AI Agents](https://authorizedtoact.devpost.com) hackathon.*
