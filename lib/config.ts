import { env } from "cloudflare:workers";

type RuntimeEnvironment = Record<string, string | undefined>;

function value(name: string) {
  const runtime = env as unknown as RuntimeEnvironment;
  return runtime[name] ?? process.env[name];
}

function positiveInteger(name: string, fallback: number) {
  const parsed = Number(value(name));
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 3650) : fallback;
}

export function getWorkspaceConfig(options: { requireAdminKey?: boolean } = {}) {
  const adminKey = value("CHATGPT_ADMIN_KEY");
  const workspaceId = value("CHATGPT_WORKSPACE_ID");
  if (options.requireAdminKey && (!adminKey || !workspaceId)) {
    throw new Error("CHATGPT_ADMIN_KEY or CHATGPT_WORKSPACE_ID is missing. Add both to .env.local before syncing.");
  }
  return {
    adminKey,
    workspaceId: workspaceId ?? "demo-workspace",
    workspaceName: value("CHATGPT_WORKSPACE_NAME") ?? "example-chatgpt",
    openAiBaseUrl: value("CHATGPT_ADMIN_BASE_URL") ?? "https://api.chatgpt.com/v1",
    analyticsHistoryDays: positiveInteger("CODEX_ANALYTICS_HISTORY_DAYS", 365),
    peopleBaseUrl: value("PEOPLE_API_BASE_URL") ?? "https://people.allegrogroup.com",
    managementLeaderName: value("MANAGEMENT_LEADER_NAME") ?? "David Roberts",
  };
}
