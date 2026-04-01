// VaultSidecar — popup.js
// Connects to the Next.js backend which uses Auth0 Token Vault

const BACKEND = "http://localhost:3000";

// ─── State ────────────────────────────────────────────────────────────────────
let state = {
  user: null,
  pageContext: null,
  pendingCiba: null,
  tokens: [],
};

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const $ = (id) => document.getElementById(id);

const views = {
  login: $("view-login"),
  main: $("view-main"),
  ciba: $("view-ciba"),
  tokens: $("view-tokens"),
};

// ─── Init ─────────────────────────────────────────────────────────────────────
async function init() {
  // Get active tab info
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

  // Ask content script for page context
  try {
    const ctx = await chrome.tabs.sendMessage(tab.id, { type: "GET_CONTEXT" });
    state.pageContext = ctx;
  } catch {
    state.pageContext = { site: "unknown", url: tab.url, title: tab.title, data: {} };
  }

  renderContextPill();

  // Check auth state via backend session
  const user = await fetchUser();
  if (user) {
    state.user = user;
    showView("main");
    updateAuthBadge(true);
    await loadTokens();
    renderSuggestions();
  } else {
    showView("login");
    updateAuthBadge(false);
  }
}

// ─── Auth ─────────────────────────────────────────────────────────────────────
async function fetchUser() {
  try {
    const r = await fetch(`${BACKEND}/api/me`, { credentials: "include" });
    if (!r.ok) return null;
    return r.json();
  } catch { return null; }
}

$("btn-login").addEventListener("click", () => {
  chrome.tabs.create({ url: `${BACKEND}/api/auth/login?returnTo=/extension-callback` });
  window.close();
});

// ─── Token bar ────────────────────────────────────────────────────────────────
async function loadTokens() {
  try {
    const r = await fetch(`${BACKEND}/api/tokens`, { credentials: "include" });
    if (!r.ok) return;
    state.tokens = await r.json();
    renderTokenChips();
  } catch {}
}

function renderTokenChips() {
  const chips = $("token-chips");
  chips.innerHTML = "";
  if (!state.tokens.length) {
    chips.innerHTML = `<span style="color:var(--text-muted);font-size:10px">none yet</span>`;
    return;
  }
  state.tokens.forEach((t) => {
    const chip = document.createElement("span");
    chip.className = `token-chip${t.expired ? " token-chip--pending" : ""}`;
    chip.textContent = t.connection;
    chips.appendChild(chip);
  });
}

// ─── Page context ─────────────────────────────────────────────────────────────
const SITE_META = {
  github: { icon: "🐙", label: "GitHub" },
  gmail: { icon: "✉️", label: "Gmail" },
  amazon: { icon: "📦", label: "Amazon" },
  unknown: { icon: "🌐", label: "Web page" },
};

function renderContextPill() {
  const site = state.pageContext?.site ?? "unknown";
  const meta = SITE_META[site] ?? SITE_META.unknown;
  $("context-icon").textContent = meta.icon;
  $("context-label").textContent = `${meta.label}: ${truncate(state.pageContext?.title ?? "", 28)}`;
}

// ─── Suggestions ──────────────────────────────────────────────────────────────
const SUGGESTIONS = {
  github: [
    "Review this PR and post a comment",
    "Summarise open issues",
    "List recent commits",
  ],
  gmail: [
    "Draft a reply to this email",
    "Summarise my last 5 emails",
    "Mark this as important",
  ],
  amazon: [
    "Add this to my wishlist",
    "Find me a better price",
    "Check delivery estimate",
  ],
  unknown: [
    "What can you do on this page?",
    "Summarise this page",
  ],
};

function renderSuggestions() {
  const site = state.pageContext?.site ?? "unknown";
  const chips = SUGGESTIONS[site] ?? SUGGESTIONS.unknown;
  const container = $("suggestions");
  container.innerHTML = "";
  chips.forEach((text) => {
    const chip = document.createElement("button");
    chip.className = "suggestion-chip";
    chip.textContent = text;
    chip.addEventListener("click", () => sendMessage(text));
    container.appendChild(chip);
  });
}

// ─── Chat ─────────────────────────────────────────────────────────────────────
function appendMsg(role, text) {
  const log = $("chat-log");
  const div = document.createElement("div");
  div.className = `msg msg--${role}`;
  div.textContent = text;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
  return div;
}

function showTyping() {
  const log = $("chat-log");
  const div = document.createElement("div");
  div.className = "msg msg--agent typing";
  div.innerHTML = "<span></span><span></span><span></span>";
  div.id = "typing-indicator";
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
}

function hideTyping() {
  document.getElementById("typing-indicator")?.remove();
}

async function sendMessage(text) {
  if (!text.trim()) return;
  $("user-input").value = "";
  appendMsg("user", text);
  showTyping();

  try {
    const r = await fetch(`${BACKEND}/api/agent`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: text,
        context: state.pageContext,
      }),
    });

    hideTyping();

    const data = await r.json();

    // CIBA / step-up auth required
    if (data.requiresApproval) {
      state.pendingCiba = data;
      $("ciba-description").textContent = data.approvalMessage;
      showView("ciba");
      return;
    }

    if (data.error) {
      appendMsg("error", `⚠ ${data.error}`);
    } else {
      appendMsg("agent", data.response);
      // Refresh token bar after actions
      await loadTokens();
    }
  } catch (err) {
    hideTyping();
    appendMsg("error", "Could not reach backend. Is it running on localhost:3000?");
  }
}

$("btn-send").addEventListener("click", () => sendMessage($("user-input").value));
$("user-input").addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendMessage($("user-input").value);
});

// ─── CIBA ─────────────────────────────────────────────────────────────────────
$("btn-ciba-approve").addEventListener("click", async () => {
  if (!state.pendingCiba) return;

  showTyping();
  showView("main");

  try {
    const r = await fetch(`${BACKEND}/api/agent/approve`, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cibaRequestId: state.pendingCiba.cibaRequestId, context: state.pageContext }),
    });

    hideTyping();
    const data = await r.json();
    appendMsg("agent", data.response ?? "Action completed.");
    await loadTokens();
  } catch {
    hideTyping();
    appendMsg("error", "Approval failed. Please try again.");
  }

  state.pendingCiba = null;
});

$("btn-ciba-deny").addEventListener("click", () => {
  state.pendingCiba = null;
  showView("main");
  appendMsg("system", "Action denied by user.");
});

// ─── Token manager ────────────────────────────────────────────────────────────
$("btn-tokens").addEventListener("click", async () => {
  showView("tokens");
  const list = $("token-list");
  list.innerHTML = "<p style='color:var(--text-muted);font-size:12px'>Loading…</p>";

  try {
    const r = await fetch(`${BACKEND}/api/tokens/detail`, { credentials: "include" });
    const tokens = await r.json();
    list.innerHTML = "";
    tokens.forEach((t) => {
      const statusClass = !t.connected
        ? "token-item__status--expired"
        : t.expired
          ? "token-item__status--expired"
          : "token-item__status--ok";
      const statusText = !t.connected
        ? "Not connected"
        : t.expired
          ? "Expired"
          : "Active";
      const reasonHtml = t.reason
        ? `<span class="token-item__reason">${t.reason}</span>`
        : "";
      const connectBtn = !t.connected
        ? `<button class="btn btn--xs btn--connect" data-connection="${t.connection}">Connect</button>`
        : "";
      list.innerHTML += `
        <div class="token-item">
          <div class="token-item__info">
            <span class="token-item__name">${t.connection}</span>
            <span class="token-item__scopes">${(t.scopes ?? []).join(", ")}</span>
            ${reasonHtml}
          </div>
          <div class="token-item__actions">
            <span class="token-item__status ${statusClass}">
              ${statusText}
            </span>
            ${connectBtn}
          </div>
        </div>`;
    });

    list.querySelectorAll(".btn--connect").forEach((btn) => {
      btn.addEventListener("click", () => {
        const connection = btn.dataset.connection;
        chrome.tabs.create({
          url: `${BACKEND}/api/connect?connection=${connection}&returnTo=/extension-callback`,
        });
        window.close();
      });
    });
  } catch {
    list.innerHTML = "<p style='color:var(--text-muted);font-size:12px'>Could not load tokens.</p>";
  }
});

$("btn-back").addEventListener("click", () => showView("main"));

// ─── Helpers ──────────────────────────────────────────────────────────────────
function showView(name) {
  Object.entries(views).forEach(([k, v]) => {
    v.classList.toggle("hidden", k !== name);
  });
}

function updateAuthBadge(isIn) {
  const badge = $("auth-status");
  badge.textContent = isIn ? `● ${state.user?.name ?? "Signed in"}` : "Signed out";
  badge.className = `auth-badge auth-badge--${isIn ? "in" : "out"}`;
}

function truncate(str, n) {
  return str.length > n ? str.slice(0, n) + "…" : str;
}

// ─── Start ────────────────────────────────────────────────────────────────────
init();
