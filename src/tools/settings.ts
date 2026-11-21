// update_settings (time zone), and the daily target metrics tools: get_daily_target_metrics, set_daily_target_metrics and archive_daily_target_metric.
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { DEFAULT_TOLERANCE_PCT, DIRECTIONS, TARGET_METRICS, type TargetMetric } from "../nutrition";
import { updateSettings } from "../services/settings";
import { archiveDailyTargetMetricView, getDailyTargetMetricsView, setDailyTargetMetricsView } from "../services/dailyTargetMetrics";
import { archiveTargetReply, jsonOf, targetsReply } from "./replies";
import { CHANGES, READS, respond, type ToolContext } from "./shared";


export function registerSettingsTools(server: McpServer, { userId, db }: ToolContext) {
	server.registerTool(
		"update_settings",
		{
			title: "Change settings",
			description: "Set the user's time zone. It decides what 'today' is and which day each log lands on, so set it first. (Daily targets are set with set_daily_target_metrics.)",
			inputSchema: z.object({ time_zone: z.string().min(1).max(64).describe("IANA time zone name, for example America/Chicago.") }).strict(),
			annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false },
		},
		(input) => respond(() => updateSettings(db, userId, input), (r) => `Time zone ${r.time_zone}.`),
	);

	server.registerTool(
		"get_daily_target_metrics",
		{
			title: "Show daily target metrics",
			description: "Every daily target metric with its target, tolerance, direction and whether the tolerance is the default; null where nothing is set (or it was archived). These are what get_day and get_report measure against. Reply (JSON): { data: { targets: { <metric>: { target, tolerance_pct, tolerance_is_default, direction } or null, ... } }, setup }. targets is an object keyed by metric name, not a list.",
			inputSchema: z.object({}).strict(),
			annotations: READS,
		},
		() => respond(() => getDailyTargetMetricsView(db, userId), jsonOf(targetsReply)),
	);

	const spec = z
		.object({
			target: z.number().positive().max(1_000_000).optional().describe("The daily number, above 0. Needed the first time a metric is set."),
			tolerance_pct: z.number().min(0).max(100).nullable().optional().describe(`Percent either way that still counts as met, 0 to 100. null uses the default (${DEFAULT_TOLERANCE_PCT}).`),
			direction: z.enum(DIRECTIONS).optional().describe("at_least (met at or above), at_most (met at or below) or around (within the tolerance either way). Each metric has a sensible default."),
		})
		.strict()
		.optional();
	const shape = Object.fromEntries(TARGET_METRICS.map((m) => [m, spec.describe(`${m}. To stop tracking it, use archive_daily_target_metric.`)])) as Record<TargetMetric, typeof spec>;
	server.registerTool(
		"set_daily_target_metrics",
		{
			title: "Save daily target metrics",
			description: `Save daily target metrics. Send only the metrics to change (${TARGET_METRICS.join(", ")}); the others keep their value. To stop tracking a metric, use archive_daily_target_metric (do not send null). Units: grams, except kcal, sodium_mg, water_ml and workout_kcal_burned (calories burned by workouts in a day, at least by default). Only set what the user tells you: never invent a target. Saving the same thing again changes nothing. Reply (JSON): the same shape as get_daily_target_metrics.`,
			inputSchema: z.object(shape).strict(),
			annotations: CHANGES,
		},
		(input) => respond(() => setDailyTargetMetricsView(db, userId, input), jsonOf(targetsReply)),
	);

	server.registerTool(
		"archive_daily_target_metric",
		{
			title: "Archive a daily target metric",
			description: "Stop tracking one daily target metric (for example workout_kcal_burned) by archiving it. Nothing is deleted: the metric is kept but has no target, and reports list it as not tracked. Setting it again with set_daily_target_metrics brings it back. If it is not set, it says so; that is not an error. Only archive what the user asks you to stop tracking. Reply (JSON): { data: { metric, archived, targets }, setup }, with targets as in get_daily_target_metrics.",
			inputSchema: z.object({ metric: z.enum(TARGET_METRICS).describe("The metric to stop tracking.") }).strict(),
			annotations: CHANGES,
		},
		(input) => respond(() => archiveDailyTargetMetricView(db, userId, input.metric), jsonOf(archiveTargetReply)),
	);
}
