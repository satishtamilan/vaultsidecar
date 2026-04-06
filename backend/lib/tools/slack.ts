// lib/tools/slack.ts
// LangChain tools that call Slack API via Auth0 Token Vault
// Tries Token Vault first, falls back to IDP identity token

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { getAccessTokenFromTokenVault } from "@auth0/ai-langchain";
import { getIdpTokenForConnection } from "../auth0";

const SLACK_API = "https://slack.com/api";

async function slackFetch(method: string, token: string, params?: Record<string, string>) {
  const url = new URL(`${SLACK_API}/${method}`);
  if (params) Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v));

  console.log(`[Slack API] ${method} (token: ${token?.slice(0, 8)}…)`);
  const r = await fetch(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!r.ok) {
    const body = await r.text();
    console.error(`[Slack API] HTTP ${r.status} ${method}\n  body: ${body}`);
    throw new Error(`Slack HTTP ${r.status}: ${body}`);
  }

  const data = await r.json();
  if (!data.ok) {
    console.error(`[Slack API] ${method} error: ${data.error}`);
    throw new Error(`Slack API error: ${data.error}`);
  }

  console.log(`[Slack API] ${method} OK`);
  return data;
}

async function slackPost(method: string, token: string, body: Record<string, any>) {
  console.log(`[Slack API] POST ${method} (token: ${token?.slice(0, 8)}…)`);
  const r = await fetch(`${SLACK_API}/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
    },
    body: JSON.stringify(body),
  });

  if (!r.ok) {
    const text = await r.text();
    console.error(`[Slack API] HTTP ${r.status} ${method}\n  body: ${text}`);
    throw new Error(`Slack HTTP ${r.status}: ${text}`);
  }

  const data = await r.json();
  if (!data.ok) {
    console.error(`[Slack API] ${method} error: ${data.error}`);
    throw new Error(`Slack API error: ${data.error}`);
  }

  console.log(`[Slack API] POST ${method} OK`);
  return data;
}

async function resolveSlackToken(): Promise<string> {
  try {
    const vaultToken = getAccessTokenFromTokenVault();
    if (vaultToken) {
      console.log("[Slack tools] Using Token Vault token");
      return vaultToken;
    }
  } catch (err: any) {
    console.log("[Slack tools] Token Vault unavailable:", err?.message);
  }

  console.log("[Slack tools] Trying IDP fallback…");
  const idpToken = await getIdpTokenForConnection("slack");
  if (idpToken) {
    console.log("[Slack tools] Using IDP identity token");
    return idpToken;
  }

  throw new Error("No Slack token available. Please connect your Slack account.");
}

// ─── List channels ───────────────────────────────────────────────────────────
const listChannelsBase = tool(
  async ({ limit = 20 }) => {
    const token = await resolveSlackToken();
    const data = await slackFetch("conversations.list", token, {
      types: "public_channel",
      limit: String(limit),
      exclude_archived: "true",
    });

    if (!data.channels?.length) return "No channels found.";

    return data.channels
      .map((ch: any) => `#${ch.name} [ID: ${ch.id}] (${ch.num_members} members) — ${ch.purpose?.value || "no description"}`)
      .join("\n");
  },
  {
    name: "list_slack_channels",
    description: "List Slack channels the user is a member of",
    schema: z.object({
      limit: z.number().optional().describe("Max channels to return (default 20)"),
    }),
  }
);

// ─── Read channel messages ───────────────────────────────────────────────────
const readMessagesBase = tool(
  async ({ channel, limit = 10 }) => {
    const token = await resolveSlackToken();
    const channelId = await resolveChannelId(channel, token);
    const data = await slackFetch("conversations.history", token, {
      channel: channelId,
      limit: String(limit),
    });

    if (!data.messages?.length) return "No messages in this channel.";

    const userCache: Record<string, string> = {};
    async function getUserName(userId: string): Promise<string> {
      if (userCache[userId]) return userCache[userId];
      try {
        const info = await slackFetch("users.info", token, { user: userId });
        const name = info.user?.real_name || info.user?.name || userId;
        userCache[userId] = name;
        return name;
      } catch {
        return userId;
      }
    }

    const formatted = await Promise.all(
      data.messages.reverse().map(async (msg: any) => {
        const user = msg.user ? await getUserName(msg.user) : "bot";
        const text = msg.text?.slice(0, 300) || "(no text)";
        return `[${user}]: ${text}`;
      })
    );

    return formatted.join("\n");
  },
  {
    name: "read_slack_messages",
    description: "Read recent messages from a Slack channel. Accepts channel name or ID.",
    schema: z.object({
      channel: z.string().describe("Slack channel name (e.g., general or #general) or ID"),
      limit: z.number().optional().describe("Number of messages to return (default 10)"),
    }),
  }
);

// ─── Resolve channel name to ID ──────────────────────────────────────────────
async function resolveChannelId(channelInput: string, token: string): Promise<string> {
  if (channelInput.match(/^C[A-Z0-9]+$/)) return channelInput;
  const name = channelInput.replace(/^#/, "").toLowerCase();
  const data = await slackFetch("conversations.list", token, {
    types: "public_channel,private_channel",
    limit: "500",
    exclude_archived: "true",
  });
  const match = data.channels?.find((ch: any) => ch.name.toLowerCase() === name);
  if (!match) throw new Error(`Channel "${channelInput}" not found. The bot may not be a member of this channel.`);
  return match.id;
}

// ─── Send message ────────────────────────────────────────────────────────────
const sendMessageBase = tool(
  async ({ channel, text }) => {
    const token = await resolveSlackToken();
    const channelId = await resolveChannelId(channel, token);
    await slackPost("chat.postMessage", token, { channel: channelId, text });
    return `Message sent to #${channel}.`;
  },
  {
    name: "send_slack_message",
    description:
      "Send a message to a Slack channel. Accepts a channel name (e.g., #general) or channel ID.",
    schema: z.object({
      channel: z.string().describe("Slack channel name (e.g., general or #general) or ID"),
      text: z.string().describe("Message text (supports Slack mrkdwn)"),
    }),
  }
);

export const listChannelsTool = listChannelsBase;
export const readMessagesTool = readMessagesBase;
export const sendMessageTool = sendMessageBase;

export const slackTools = [listChannelsTool, readMessagesTool, sendMessageTool];
export const WRITE_TOOLS = new Set(["send_slack_message"]);
