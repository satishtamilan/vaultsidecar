// background.js — VaultSidecar service worker
// Handles extension lifecycle and cross-tab messaging

chrome.runtime.onInstalled.addListener(() => {
  console.log("[VaultSidecar] Extension installed.");
});

// Listen for auth callback from the backend after login
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (
    changeInfo.status === "complete" &&
    tab.url?.includes("localhost:3000/extension-callback")
  ) {
    // Auth complete — close the tab and open popup
    chrome.tabs.remove(tabId);
    console.log("[VaultSidecar] Auth complete, tab closed.");
  }
});
