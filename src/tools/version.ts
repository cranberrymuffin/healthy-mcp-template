// get_server_version: which commit is deployed, so anyone can check the server they are using against GitHub.
// The commit is set at deploy time (scripts/provision.mjs writes GIT_SHA from GITHUB_SHA); "unknown" when run locally.
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import pkg from "../../package.json";
import { READS, type ToolContext } from "./shared";

export function registerVersionTool(server: McpServer, { commit }: ToolContext) {
	server.registerTool(
		"get_server_version",
		{
			title: "Which version of the server is running",
			description: "The git commit this server was deployed from (commit and commit_short) and its package version. Compare the commit with GitHub to check which code you are talking to. It is 'unknown' on a local run.",
			inputSchema: z.object({}).strict(),
			annotations: READS,
		},
		() => {
			const sha = commit && /^[0-9a-f]{7,64}$/.test(commit) ? commit : "unknown";
			return { content: [{ type: "text" as const, text: JSON.stringify({ commit: sha, commit_short: sha === "unknown" ? sha : sha.slice(0, 7), version: pkg.version }) }] };
		},
	);
}
