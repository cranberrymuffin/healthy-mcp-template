// how_to_build_dashboard: how to build the food dashboard from the other tools. Every client gets the same instructions.
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import fullInstructions from "../../docs/dashboard-build-instructions.md";
import { responseShapesDoc } from "./replies";
import { READS } from "./shared";

/** The instructions with the reply shapes written out in full from their schemas. */
const instructions = () => fullInstructions.replace("{{RESPONSE_SHAPES}}", responseShapesDoc());

export function registerDashboardTools(server: McpServer) {
	server.registerTool(
		"how_to_build_dashboard",
		{
			title: "How to build the food dashboard",
			description:
				"Call this FIRST when the user asks for, or wants to create, build, make or design, a dashboard, report, page, chart, graph, visualization, overview, summary or \"healthy report\" of their food or health data (for example \"create a healthy report\", \"graph my week\", \"make me an overview\", \"build a scorecard\", \"a progress page\", \"show me how I've been eating\"), then follow what it returns. A bare request for a report, overview or summary means a page: build it as an artifact (or your client's canvas, preview or page) when it can create one. Only a question with a specific short answer (for example \"how many calories yesterday?\") is answered in text, with get_report or get_day. It has the step-by-step instructions for building the food dashboard from get_report, get_top_foods, get_day and get_daily_target_metrics: which sources to call, the rules, and each section to include.",
			inputSchema: z.object({}).strict(),
			annotations: READS,
		},
		() => ({ content: [{ type: "text" as const, text: instructions() }] }),
	);
}
