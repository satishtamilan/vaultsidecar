// lib/agent.ts
// LangGraph agent that routes to the right tools based on page context
// Uses Auth0 Token Vault for all external API calls

import { ChatOpenAI } from "@langchain/openai";
import { createReactAgent } from "@langchain/langgraph/prebuilt";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { auth0 } from "./auth0";
import { githubTools, WRITE_TOOLS as GITHUB_WRITE } from "./tools/github";
import { slackTools, WRITE_TOOLS as SLACK_WRITE } from "./tools/slack";
import { amazonTools } from "./tools/amazon";

// All write tools that require CIBA approval
const ALL_WRITE_TOOLS = new Set([...GITHUB_WRITE, ...SLACK_WRITE]);

// ─── Model ────────────────────────────────────────────────────────────────────
const isLocal = process.env.LLM_PROVIDER === "local";

const model = isLocal
  ? new ChatOpenAI({
      model: process.env.LOCAL_LLM_MODEL || "llama3.1:8b",
      temperature: 0,
      streaming: false,
      configuration: {
        baseURL: `${process.env.LOCAL_LLM_BASE_URL || "http://localhost:11434"}/v1`,
      },
      apiKey: "ollama",
    })
  : new ChatOpenAI({
      model: "gpt-4o-mini",
      temperature: 0,
      streaming: false,
    });

// ─── Agent factory ────────────────────────────────────────────────────────────
function buildAgent(tools: any[]) {
  return createReactAgent({ llm: model, tools });
}

const agents = {
  github: buildAgent(githubTools),
  slack: buildAgent(slackTools),
  amazon: buildAgent(amazonTools),
  unknown: buildAgent([...githubTools, ...slackTools]),
};

// ─── System prompts ───────────────────────────────────────────────────────────
function getSystemPrompt(context: PageContext): string {
  const base = `You are VaultSidecar, a concise AI agent embedded in a browser extension.
You help users take actions on the current web page using their connected accounts.
Auth0 Token Vault manages all credentials — you never see raw tokens or passwords.
IMPORTANT: When a tool returns data (repos, channels, messages, etc.), you MUST include the full results in your response. Never say "listed above" — the user can only see YOUR final text response.
Be direct and action-oriented.`;

  const contextStr = JSON.stringify(context, null, 2);

  return `${base}\n\nCurrent page context:\n${contextStr}`;
}

// ─── Types ────────────────────────────────────────────────────────────────────
export interface PageContext {
  site: string;
  url: string;
  title: string;
  type?: string;
  owner?: string;
  repo?: string;
  prNumber?: string;
  subject?: string;
  sender?: string;
  bodyPreview?: string;
  asin?: string;
  price?: string;
}

export interface AgentResult {
  response?: string;
  requiresApproval?: boolean;
  approvalMessage?: string;
  cibaRequestId?: string;
  pendingTool?: string;
  pendingArgs?: any;
  error?: string;
}

// ─── Pre-flight CIBA check ────────────────────────────────────────────────────
// Intercepts write tool calls before execution and requests CIBA
async function checkWriteToolsInterceptor(
  message: string,
  context: PageContext,
  userId: string
): Promise<{ needsApproval: false } | { needsApproval: true; toolName: string; approvalMessage: string }> {
  // Quick heuristic: if the message contains write-intent keywords AND page has a write context
  const writeKeywords = ["post", "send", "reply", "comment", "merge", "create", "delete", "purchase", "buy"];
  const hasWriteIntent = writeKeywords.some((kw) => message.toLowerCase().includes(kw));

  if (!hasWriteIntent) return { needsApproval: false };

  // Determine which write tool would be called
  if (context.site === "github" && (message.toLowerCase().includes("comment") || message.toLowerCase().includes("post"))) {
    return {
      needsApproval: true,
      toolName: "comment_on_pr",
      approvalMessage: `The agent wants to post a comment on PR #${context.prNumber ?? "?"} in ${context.owner}/${context.repo}. Approve this action?`,
    };
  }

  if (context.site === "slack" && (message.toLowerCase().includes("send") || message.toLowerCase().includes("post") || message.toLowerCase().includes("message"))) {
    return {
      needsApproval: true,
      toolName: "send_slack_message",
      approvalMessage: `The agent wants to send a message in Slack. Approve this action?`,
    };
  }

  return { needsApproval: false };
}

// ─── Run agent ────────────────────────────────────────────────────────────────
export async function runAgent(
  message: string,
  context: PageContext,
  userId: string
): Promise<AgentResult> {
  // 1. Check if this needs CIBA approval first
  const cibaCheck = await checkWriteToolsInterceptor(message, context, userId);

  if (cibaCheck.needsApproval) {
    // Initiate async CIBA authorization
    const { initiateCIBA } = await import("./auth0");
    const { requestId } = await initiateCIBA(userId, cibaCheck.approvalMessage);

    return {
      requiresApproval: true,
      approvalMessage: cibaCheck.approvalMessage,
      cibaRequestId: requestId,
      pendingTool: cibaCheck.toolName,
    };
  }

  // 2. Pick the right agent — keyword hints override page context
  let site = context.site as keyof typeof agents;
  const lower = message.toLowerCase();
  if (lower.includes("slack") || lower.includes("channel")) {
    site = "slack" as any;
  } else if (lower.includes("github") || lower.includes("repo") || lower.includes("pull request")) {
    site = "github" as any;
  }
  const agent = agents[site] ?? agents.unknown;

  // 3. Get refresh token from session to pass to Token Vault wrappers
  const session = await auth0.getSession();
  const refreshToken = (session?.tokenSet as any)?.refreshToken as string | undefined;

  // 4. Run the agent
  try {
    const result = await agent.invoke(
      {
        messages: [
          new SystemMessage(getSystemPrompt(context)),
          new HumanMessage(message),
        ],
      },
      {
        configurable: {
          _credentials: { refreshToken },
        },
      }
    );

    for (const msg of result.messages) {
      const type = msg._getType?.() ?? msg.constructor?.name ?? "unknown";
      if (type === "tool") {
        console.log(`[agent] tool result [${(msg as any).name}]:`, String(msg.content).slice(0, 300));
      } else if (type === "ai" && (msg as any).tool_calls?.length) {
        for (const tc of (msg as any).tool_calls) {
          console.log(`[agent] LLM called tool: ${tc.name}(${JSON.stringify(tc.args)})`);
        }
      }
    }

    const lastMsg = result.messages[result.messages.length - 1];
    const response = typeof lastMsg.content === "string"
      ? lastMsg.content
      : JSON.stringify(lastMsg.content);

    return { response };
  } catch (err: any) {
    console.error("[agent] runAgent error:", err);
    return { error: err?.message ?? "Agent error" };
  }
}

// ─── Run approved action (post-CIBA) ─────────────────────────────────────────
export async function runApprovedAction(
  cibaRequestId: string,
  context: PageContext,
  userId: string
): Promise<AgentResult> {
  const { confirmCIBA } = await import("./auth0");

  const approved = await confirmCIBA(cibaRequestId);
  if (!approved) {
    return { error: "Authorization was not approved or expired." };
  }

  // Now re-run — the write tool will succeed because CIBA is confirmed
  const site = context.site as keyof typeof agents;
  const agent = agents[site] ?? agents.unknown;

  const session = await auth0.getSession();
  const refreshToken = (session?.tokenSet as any)?.refreshToken as string | undefined;

  try {
    const result = await agent.invoke(
      {
        messages: [
          new SystemMessage(getSystemPrompt(context)),
          new HumanMessage("The user has approved the action. Please proceed with the previously requested write operation."),
        ],
      },
      {
        configurable: {
          _credentials: { refreshToken },
        },
      }
    );

    const lastMsg = result.messages[result.messages.length - 1];
    return {
      response: typeof lastMsg.content === "string"
        ? lastMsg.content
        : "Action completed successfully.",
    };
  } catch (err: any) {
    return { error: err?.message ?? "Action failed after approval." };
  }
}
