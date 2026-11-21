// The shape of each JSON reply is generated from its schema into how_to_build_dashboard, so the model knows where the lists are before it writes code.
import { env } from "cloudflare:test";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { McpServer } from "@modelcontextprotocol/server";
import { describe, expect, it } from "vitest";
import { createFoodApiClients } from "../src/foodapis";
import { registerTools } from "../src/tools";

describe("the full reply shapes are generated into how_to_build_dashboard", () => {
	it("lists every nested field, with nothing left unfilled", async () => {
		const server = new McpServer({ name: "test", version: "0" });
		registerTools(server, { userId: "shapes", db: env.DB, clients: createFoodApiClients("k", fetch) });
		const [clientSide, serverSide] = InMemoryTransport.createLinkedPair();
		const client = new Client({ name: "test-client", version: "0" });
		await Promise.all([server.connect(serverSide), client.connect(clientSide)]);
				// The full nested shapes are generated into how_to_build_dashboard, with nothing left unfilled.
		const doc = (await client.callTool({ name: "how_to_build_dashboard", arguments: {} })) as { content: { text: string }[] };
		const text = doc.content[0]!.text;
		expect(text).not.toContain("{{RESPONSE_SHAPES}}");

		// Two sections are always included, and there is a rule for pages that cannot call tools.
		expect(text).toContain("Always include two sections: the Day explorer");
		expect(text).toContain("Curious things in your numbers");
		expect(text).not.toContain("snapshot");
		expect(text).toContain("clickable buttons to choose the nutrient (not a dropdown)");
		expect(text).toContain("Give each card one tone");
		expect(text).toContain("tell the user three things");
		expect(text).toContain('capabilities: {mcp: {servers: [{server: "healthy", tools: ["get_report", "get_top_foods", "get_day", "get_daily_target_metrics"]}]}}');
		expect(text).toContain('claude.use("mcp")');
		expect(text).toContain("watchTool");
		expect(text).toContain('"Last 7 days" (`granularity: day`) and "Last 8 weeks"');
		expect(text).toContain('"By fiber" (`fiber_g`) and "By sugar" (`sugar_g`)');
		expect(text).toContain("about 18 minutes with Opus");
		expect(text).toContain("time_buckets?: [ { bucket:");
		expect(text).toContain("brand: string | null");
		expect(text).toContain("targets: { <key>: { target: number");
		expect(text).toContain("food_logs: [ {");
	});
});
