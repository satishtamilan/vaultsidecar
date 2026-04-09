// lib/tools/github.ts
// LangChain tools that call GitHub API
// Tries Auth0 Token Vault first, falls back to IDP identity token

import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { getAccessTokenFromTokenVault } from "@auth0/ai-langchain";
import { getIdpTokenForConnection } from "../auth0";

const GITHUB_API = "https://api.github.com";

async function ghFetch(path: string, token: string, options?: RequestInit) {
  console.log(`[GitHub API] ${options?.method ?? "GET"} ${path} (token: ${token?.slice(0, 8)}…)`);
  const r = await fetch(`${GITHUB_API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json",
      ...(options?.headers ?? {}),
    },
  });
  if (!r.ok) {
    const body = await r.text();
    const scopes = r.headers.get("x-oauth-scopes");
    console.error(`[GitHub API] ${r.status} ${path}\n  scopes: ${scopes}\n  body: ${body}`);
    throw new Error(`GitHub ${r.status}: ${body}`);
  }
  console.log(`[GitHub API] ${r.status} OK — ${path}`);
  return r.json();
}

async function resolveGitHubToken(): Promise<string> {
  try {
    const vaultToken = getAccessTokenFromTokenVault();
    if (vaultToken) {
      console.log("[GitHub tools] Using Token Vault token");
      return vaultToken;
    }
  } catch (err: any) {
    console.log("[GitHub tools] Token Vault unavailable:", err?.message);
  }

  console.log("[GitHub tools] Trying IDP fallback…");
  const idpToken = await getIdpTokenForConnection("github");
  if (idpToken) {
    console.log("[GitHub tools] Using IDP identity token");
    return idpToken;
  }

  throw new Error("No GitHub token available. Please sign in with GitHub.");
}

// ─── List PRs ─────────────────────────────────────────────────────────────────
const listPRsBase = tool(
  async ({ owner, repo }) => {
    const token = await resolveGitHubToken();
    const prs = await ghFetch(`/repos/${owner}/${repo}/pulls?state=open&per_page=10`, token);
    if (!prs.length) return "No open pull requests.";

    return prs
      .map((pr: any) => `#${pr.number}: ${pr.title} (by @${pr.user.login}) — ${pr.html_url}`)
      .join("\n");
  },
  {
    name: "list_pull_requests",
    description: "List open pull requests in a GitHub repo",
    schema: z.object({
      owner: z.string().describe("Repo owner/org"),
      repo: z.string().describe("Repository name"),
    }),
  }
);

// ─── Post PR comment ─────────────────────────────────────────────────────────
const commentOnPRBase = tool(
  async ({ owner, repo, prNumber, comment }) => {
    const token = await resolveGitHubToken();
    await ghFetch(`/repos/${owner}/${repo}/issues/${prNumber}/comments`, token, {
      method: "POST",
      body: JSON.stringify({ body: comment }),
    });
    return `Comment posted on PR #${prNumber} in ${owner}/${repo}.`;
  },
  {
    name: "comment_on_pr",
    description:
      "Post a comment on a GitHub pull request. REQUIRES user approval via CIBA before calling.",
    schema: z.object({
      owner: z.string(),
      repo: z.string(),
      prNumber: z.number().describe("PR number"),
      comment: z.string().describe("Comment body (markdown supported)"),
    }),
  }
);

// ─── Get PR diff summary ──────────────────────────────────────────────────────
const getPRDetailsBase = tool(
  async ({ owner, repo, prNumber }) => {
    const token = await resolveGitHubToken();
    const [pr, files] = await Promise.all([
      ghFetch(`/repos/${owner}/${repo}/pulls/${prNumber}`, token),
      ghFetch(`/repos/${owner}/${repo}/pulls/${prNumber}/files?per_page=20`, token),
    ]);

    const fileList = files
      .map((f: any) => `  • ${f.filename} (+${f.additions} -${f.deletions})`)
      .join("\n");

    return `PR #${prNumber}: "${pr.title}"\nBy: @${pr.user.login}\nStatus: ${pr.state}\n\nFiles changed:\n${fileList}\n\nDescription:\n${pr.body?.slice(0, 400) ?? "(none)"}`;
  },
  {
    name: "get_pr_details",
    description: "Get details and changed files for a GitHub pull request",
    schema: z.object({
      owner: z.string(),
      repo: z.string(),
      prNumber: z.number(),
    }),
  }
);

// ─── List repos ───────────────────────────────────────────────────────────────
const listReposBase = tool(
  async () => {
    console.log("[list_repos] Tool invoked");
    const token = await resolveGitHubToken();
    try {
      const repos = await ghFetch("/user/repos?sort=pushed&per_page=10", token);
      const result = repos
        .map((r: any) => `${r.full_name} — ${r.description ?? "no description"} ⭐${r.stargazers_count}`)
        .join("\n");
      console.log(`[list_repos] Returning ${repos.length} repos`);
      return result;
    } catch (err: any) {
      console.error("[list_repos] ghFetch error:", err.message);
      throw err;
    }
  },
  {
    name: "list_repos",
    description: "List the authenticated user's GitHub repositories, sorted by most recently pushed",
    schema: z.object({}),
  }
);

// ─── Recent commits ──────────────────────────────────────────────────────────
const recentCommitsBase = tool(
  async ({ repo, count }) => {
    const n = count ?? 5;
    console.log(`[recent_commits] Tool invoked — repo=${repo || "(all)"} count=${n}`);
    const token = await resolveGitHubToken();
    try {
      if (repo && repo.includes("/")) {
        const commits = await ghFetch(`/repos/${repo}/commits?per_page=${n}`, token);
        return formatCommits(commits, repo);
      }

      const repos = await ghFetch("/user/repos?sort=pushed&per_page=5&affiliation=owner,collaborator", token);
      if (!repos.length) return "No repositories found.";

      const lines: string[] = [];
      for (const r of repos) {
        try {
          const commits = await ghFetch(`/repos/${r.full_name}/commits?per_page=${n}`, token);
          if (commits.length) {
            lines.push(...formatCommits(commits.slice(0, Math.max(1, Math.ceil(n / repos.length))), r.full_name).split("\n"));
          }
        } catch (repoErr: any) {
          console.log(`[recent_commits] Skipping ${r.full_name}: ${repoErr.message}`);
        }
        if (lines.length >= n) break;
      }

      return lines.length ? lines.slice(0, n).join("\n") : "No recent commits found.";
    } catch (err: any) {
      console.error("[recent_commits] error:", err.message);
      throw err;
    }
  },
  {
    name: "recent_commits",
    description:
      "Get recent git commits. If repo is provided (owner/name), lists commits for that repo. Otherwise fetches the latest commits from the user's most recently pushed repositories.",
    schema: z.object({
      repo: z
        .string()
        .optional()
        .describe("Repository in owner/name format, e.g. 'octocat/hello-world'. Omit to get commits across recent repos."),
      count: z
        .number()
        .optional()
        .describe("Number of commits to return (default 5)"),
    }),
  }
);

function formatCommits(commits: any[], repoName: string): string {
  return commits
    .map((c: any) => {
      const sha = c.sha.slice(0, 7);
      const msg = c.commit.message.split("\n")[0];
      const author = c.commit.author?.name ?? "unknown";
      const date = c.commit.author?.date ?? "";
      return `${sha} — ${msg} (by ${author}, ${date}) [${repoName}]`;
    })
    .join("\n");
}

export const listPRsTool = listPRsBase;
export const commentOnPRTool = commentOnPRBase;
export const getPRDetailsTool = getPRDetailsBase;
export const listReposTool = listReposBase;
export const recentCommitsTool = recentCommitsBase;

export const githubTools = [listReposTool, recentCommitsTool, listPRsTool, getPRDetailsTool, commentOnPRTool];

export const WRITE_TOOLS = new Set(["comment_on_pr"]);
