// lib/tools/gmail.ts
// LangChain tools that call Gmail API via Auth0 Token Vault
// Tries Token Vault first, falls back to IDP identity token

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { getAccessTokenFromTokenVault } from "@auth0/ai-langchain";
import { withGmailRead, withGmailSend, getIdpTokenForConnection } from "../auth0";

const GMAIL_API = "https://gmail.googleapis.com/gmail/v1";

async function gmailFetch(path: string, token: string, options?: RequestInit) {
  console.log(`[Gmail API] ${options?.method ?? "GET"} ${path}`);
  const r = await fetch(`${GMAIL_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(options?.headers ?? {}),
    },
  });
  if (!r.ok) {
    const body = await r.text();
    console.error(`[Gmail API] ${r.status} ${path}\n  body: ${body}`);
    throw new Error(`Gmail ${r.status}: ${body}`);
  }
  return r.json();
}

function decodeBase64(str: string) {
  return Buffer.from(str.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf-8");
}

async function resolveGoogleToken(): Promise<string> {
  try {
    const vaultToken = getAccessTokenFromTokenVault();
    if (vaultToken) {
      console.log("[Gmail tools] Using Token Vault token");
      return vaultToken;
    }
  } catch (err: any) {
    console.log("[Gmail tools] Token Vault unavailable:", err?.message);
  }

  console.log("[Gmail tools] Trying IDP fallback…");
  const idpToken = await getIdpTokenForConnection("google");
  if (idpToken) {
    console.log("[Gmail tools] Using IDP identity token");
    return idpToken;
  }

  throw new Error("No Google token available. Please sign in with Google.");
}

// ─── List recent emails ───────────────────────────────────────────────────────
const listEmailsBase = tool(
  async ({ maxResults = 5 }) => {
    const token = await resolveGoogleToken();
    const { messages } = await gmailFetch(
      `/users/me/messages?maxResults=${maxResults}&q=in:inbox`,
      token
    );
    if (!messages?.length) return "Inbox is empty.";

    const details = await Promise.all(
      messages.map((m: any) =>
        gmailFetch(`/users/me/messages/${m.id}?format=metadata&metadataHeaders=From,Subject,Date`, token)
      )
    );

    return details
      .map((msg: any) => {
        const headers = Object.fromEntries(
          msg.payload.headers.map((h: any) => [h.name, h.value])
        );
        return `[${headers.Date}] From: ${headers.From}\nSubject: ${headers.Subject}`;
      })
      .join("\n\n");
  },
  {
    name: "list_emails",
    description: "List recent emails from the user's Gmail inbox",
    schema: z.object({
      maxResults: z.number().optional().describe("Number of emails to return (default 5)"),
    }),
  }
);

// ─── Get email thread ─────────────────────────────────────────────────────────
const getEmailThreadBase = tool(
  async ({ threadId }) => {
    const token = await resolveGoogleToken();
    const thread = await gmailFetch(`/users/me/threads/${threadId}?format=full`, token);
    const msgs = thread.messages?.slice(-3) ?? [];

    return msgs
      .map((msg: any) => {
        const headers = Object.fromEntries(msg.payload.headers.map((h: any) => [h.name, h.value]));
        const part = msg.payload.parts?.find((p: any) => p.mimeType === "text/plain");
        const body = part?.body?.data ? decodeBase64(part.body.data).slice(0, 600) : "(no text)";
        return `From: ${headers.From}\n${body}`;
      })
      .join("\n\n---\n\n");
  },
  {
    name: "get_email_thread",
    description: "Read the content of an email thread",
    schema: z.object({ threadId: z.string() }),
  }
);

// ─── Draft a reply ────────────────────────────────────────────────────────────
const draftReplyBase = tool(
  async ({ to, subject, body, threadId }) => {
    const token = await resolveGoogleToken();
    const raw = Buffer.from(
      `To: ${to}\r\nSubject: ${subject}\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n${body}`
    ).toString("base64url");

    await gmailFetch("/users/me/messages/send", token, {
      method: "POST",
      body: JSON.stringify({ raw, threadId }),
    });

    return `Reply sent to ${to}.`;
  },
  {
    name: "send_email_reply",
    description:
      "Send an email reply via Gmail. REQUIRES user approval via CIBA — do not call without approval.",
    schema: z.object({
      to: z.string().describe("Recipient email"),
      subject: z.string().describe("Email subject"),
      body: z.string().describe("Plain text body"),
      threadId: z.string().optional().describe("Thread ID to reply to"),
    }),
  }
);

export const listEmailsTool = withGmailRead(listEmailsBase);
export const getEmailThreadTool = withGmailRead(getEmailThreadBase);
export const draftReplyTool = withGmailSend(draftReplyBase);

export const gmailTools = [listEmailsTool, getEmailThreadTool, draftReplyTool];
export const WRITE_TOOLS = new Set(["send_email_reply"]);
