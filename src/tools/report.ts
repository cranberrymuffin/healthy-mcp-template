// get_report: read-only. It replies with compact JSON text (the data is the answer), already summed and judged by the server.
import type { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import { getReport, GRANULARITIES } from "../services/report";
import { DEFAULT_LIMIT, getTopFoods, MAX_LIMIT, RANK_BY, TOP_FOOD_MEALS } from "../services/topFoods";
import { jsonOf, reportReply, topFoodsReply } from "./replies";
import { date, READS, respond, type ToolContext } from "./shared";


// Said at the moment the assistant has the numbers and is deciding how to present them. The data above it is unchanged.
const REPORT_NEXT_STEP =
	"If the user asked for a report, overview, summary, scorecard or page (not a question with a specific short answer), do not answer in text: build an artifact (or your client's canvas, preview or page) following how_to_build_dashboard.";
const asReportJson = jsonOf(reportReply);
const withNextStep = (r: Record<string, unknown>) => ({ ...r, next_step: REPORT_NEXT_STEP });

export function registerReportTools(server: McpServer, { userId, db }: ToolContext) {
	server.registerTool(
		"get_report",
		{
			title: "Report over a period",
			description:
				"A report over a fixed window: granularity day = the last 7 days, week = 8 weeks (Monday to Sunday), month = 6 months, ending with the day, week or month that holds end_date (default today). One row per day, week or month, oldest first: calories (and where they came from), protein, fat, carbs, fiber, sugar, added sugar, sodium, water, workouts, and how many entries were estimated. Week and month rows also have daily averages; day rows also have the top sugar sources and time-of-day buckets. The summary has the trend, adherence to the user's targets (days met and missed, streaks), meal types and workout types over the whole window, and one sentence to quote. For the top foods behind a nutrient use get_top_foods. Everything is computed by the server: never add numbers up yourself. Draw charts yourself from the rows if asked. If the user has not set every required daily target yet, the call fails and says which are missing: ask once for them (say what they gain), save them with set_daily_target_metrics, then call again. The week report also fails until 7 days have passed since the first log, and the month report until 30; use a smaller granularity until then. Reply (JSON): { covered: { granularity, period_start, period_end }, data: { rows: [one per day, week or month], summary: { trend, adherence, meal_types, workout_types, text } }, next_step }.",
			inputSchema: z
				.object({
					granularity: z.enum(GRANULARITIES).describe("day (7 days), week (8 weeks) or month (6 months). To see further back, call again with a different level or end_date."),
					end_date: date.optional().describe("The last day to include, YYYY-MM-DD, not after today. Defaults to today."),
				})
				.strict(),
			annotations: READS,
		},
		(input) => respond(async () => withNextStep(await getReport(db, userId, input)), asReportJson),
	);

	server.registerTool(
		"get_top_foods",
		{
			title: "Top foods for a metric",
			description:
				"Which foods contribute most of one metric over the same window get_report uses (granularity day = 7 days, week = 8 weeks, month = 6 months, ending with the day, week or month that holds end_date, default today). Rank by calories, protein, fat, carbs, fiber, sugar, added sugar, sodium, days eaten, entries or grams. Each food has its total for the metric (value), its share of the window total (the shares and an everything_else row add up to 100), days eaten, entries and grams. Water is left out; meal_type limits it to one meal. Everything is computed by the server: never add numbers up yourself. If nothing was logged in the window the call fails and says where the user's data starts. Reply (JSON): { covered: { granularity, period_start, period_end, rank_by, meal_type }, data: { foods: [ranked foods], everything_else: { foods, value, share_pct } or null, foods_in_window, window_total } }.",
			inputSchema: z
				.object({
					granularity: z.enum(GRANULARITIES).describe("day (7 days), week (8 weeks) or month (6 months): the same windows as get_report."),
					end_date: date.optional().describe("The last day to include, YYYY-MM-DD, not after today. Defaults to today."),
					rank_by: z.enum(RANK_BY).describe("The metric to rank by: kcal, protein_g, fat_g, carbs_g, fiber_g, sugar_g, added_sugar_g, sodium_mg, days_eaten (how many days a food was eaten), entries or grams."),
					limit: z.number().int().min(1).max(MAX_LIMIT).optional().describe(`How many foods to list, 1 to ${MAX_LIMIT}. Defaults to ${DEFAULT_LIMIT}.`),
					meal_type: z.enum(TOP_FOOD_MEALS).optional().describe("Only foods logged as this meal type. Leave out for all meals."),
				})
				.strict(),
			annotations: READS,
		},
		(input) => respond(() => getTopFoods(db, userId, input), jsonOf(topFoodsReply)),
	);
}
