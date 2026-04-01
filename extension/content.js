// content.js — VaultSidecar
// Injected into supported pages. Extracts page context and sends it to popup.

function detectSite() {
  const host = location.hostname;
  if (host.includes("github.com")) return "github";
  if (host.includes("mail.google.com")) return "gmail";
  if (host.includes("amazon.")) return "amazon";
  return "unknown";
}

// ─── GitHub context ───────────────────────────────────────────────────────────
function getGitHubContext() {
  const path = location.pathname; // e.g. /owner/repo/pull/123
  const parts = path.split("/").filter(Boolean);
  const ctx = { url: location.href, title: document.title };

  if (parts[2] === "pull" && parts[3]) {
    ctx.type = "pull_request";
    ctx.owner = parts[0];
    ctx.repo = parts[1];
    ctx.prNumber = parts[3];
    ctx.prTitle = document.querySelector(".js-issue-title")?.textContent?.trim()
      ?? document.querySelector("h1 bdi")?.textContent?.trim() ?? "";
  } else if (parts[2] === "issues" && parts[3]) {
    ctx.type = "issue";
    ctx.owner = parts[0];
    ctx.repo = parts[1];
    ctx.issueNumber = parts[3];
  } else if (parts[1]) {
    ctx.type = "repo";
    ctx.owner = parts[0];
    ctx.repo = parts[1];
  } else {
    ctx.type = "home";
  }

  return ctx;
}

// ─── Gmail context ────────────────────────────────────────────────────────────
function getGmailContext() {
  const subject = document.querySelector("h2.hP")?.textContent?.trim() ?? "";
  const sender = document.querySelector(".gD")?.getAttribute("email") ?? "";
  const body = document.querySelector(".a3s.aiL")?.textContent?.trim().slice(0, 500) ?? "";

  return {
    url: location.href,
    title: subject || document.title,
    type: subject ? "thread" : "inbox",
    subject,
    sender,
    bodyPreview: body,
  };
}

// ─── Amazon context ───────────────────────────────────────────────────────────
function getAmazonContext() {
  const title = document.querySelector("#productTitle")?.textContent?.trim() ?? document.title;
  const price = document.querySelector(".a-price-whole")?.textContent?.trim() ?? "";
  const asin = document.querySelector("[data-asin]")?.getAttribute("data-asin") ?? "";
  const rating = document.querySelector("[data-hook='average-star-rating'] .a-size-base")?.textContent ?? "";

  return {
    url: location.href,
    title,
    type: asin ? "product" : "search",
    asin,
    price: price ? `£${price}` : "",
    rating,
  };
}

// ─── Dispatch ─────────────────────────────────────────────────────────────────
const site = detectSite();

const extractors = {
  github: getGitHubContext,
  gmail: getGmailContext,
  amazon: getAmazonContext,
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === "GET_CONTEXT") {
    const data = extractors[site]?.() ?? {};
    sendResponse({ site, ...data });
  }
  return true; // keep message channel open for async
});
