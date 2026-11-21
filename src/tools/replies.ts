// The shape of every JSON reply, written once. Each reply is checked against its schema before it is sent (a wrong shape is an
// error, never a silently wrong answer), and the same schemas are rendered into the text the model reads: the full nested form in
// how_to_build_dashboard (the tool descriptions stay as they were). Nothing is published as an MCP outputSchema.
import { z } from "zod";
import { MEAL_TYPES, WORKOUT_INTENSITIES, WORKOUT_SOURCES, WORKOUT_TYPES } from "../data";
import { DIRECTIONS, NUTRIENT_KEYS, TIME_BUCKETS } from "../nutrition";
import { GRANULARITIES } from "../services/report";
import { RANK_BY } from "../services/topFoods";

const num = z.number();
const nutrients = z.object(Object.fromEntries(NUTRIENT_KEYS.map((k) => [k, num]))).strict();
const byMetric = (what: string) => `an object keyed by metric name (kcal, protein_g, ...): ${what}`;

const targetSpec = z.object({ target: num, tolerance_pct: num, tolerance_is_default: z.boolean(), direction: z.enum(DIRECTIONS) }).strict();
const targetsView = z.record(z.string(), targetSpec.nullable()).describe(byMetric("null where nothing is set"));
const setup = z.union([
	z.object({ setup_complete: z.literal(true) }).strict(),
	z.object({ setup_complete: z.literal(false), missing: z.array(z.string()), instruction: z.string() }).strict(),
]).describe("a note about missing targets: ignore it in a page");

const reportRow = z.object({
	period_start: z.string(), period_end: z.string(), in_progress: z.boolean(), days_with_data: num,
	kcal_total: num, kcal_from_protein: num, kcal_from_fat: num, kcal_from_carbs: num, kcal_other: num,
	protein_g: num, fat_g: num, carbs_g: num, fiber_g: num, sugar_g: num, added_sugar_g: num, sodium_mg: num, water_ml: num,
	entries: num, estimated_entries: num, workouts: num, workout_minutes: num, workout_kcal_burned: num,
	top_sugar_sources: z.array(z.object({ food: z.string(), grams: num, sugar_g: num, eaten_at: z.string() }).strict()).optional().describe("day rows only"),
	time_buckets: z.array(z.object({ bucket: z.enum(TIME_BUCKETS), kcal: num, sugar_g: num, entries: num }).strict()).optional().describe("day rows only"),
	daily_avg: z.object({ kcal_total: num, protein_g: num, fat_g: num, carbs_g: num, fiber_g: num, sugar_g: num, added_sugar_g: num, sodium_mg: num, water_ml: num }).strict().optional().describe("week and month rows only: averages over days with data"),
}).strict();

export const reportReply = z.object({
	covered: z.object({ granularity: z.enum(GRANULARITIES), period_start: z.string(), period_end: z.string() }).strict(),
	data: z.object({
		rows: z.array(reportRow).describe("one per day, week or month, oldest first"),
		summary: z.object({
			trend: z.record(z.string(), z.object({ direction: z.enum(["up", "down", "flat"]), change_pct: num }).strict()).describe(byMetric("{} with under 2 completed days; a metric that cannot be compared is left out")),
			adherence: z.object({
				days_with_data: num, days_all_targets_met: num,
				targets: z.array(z.object({
					metric: z.string(), target: num, direction: z.enum(DIRECTIONS), tolerance_pct: num, tolerance_is_default: z.boolean(),
					range_min: num.optional(), range_max: num.optional(), days_met: num, days_missed: num, missed_below: num, missed_above: num,
					days_unlogged: num, adherence_pct: num, current_streak: num, longest_streak: num,
				}).strict()),
				not_tracked: z.array(z.string()).describe("metrics with no saved target"),
			}).strict(),
			meal_types: z.array(z.object({ meal_type: z.enum(MEAL_TYPES), kcal_total: num, protein_g_total: num, daily_avg_kcal: num, share_of_kcal_pct: num, entries: num }).strict()),
			workout_types: z.array(z.object({ type: z.string(), workouts: num, days_with_workout: num, minutes_total: num, kcal_burned_total: num, estimated_workouts: num, hard_workouts: num }).strict()),
			text: z.string().describe("one sentence to quote"),
		}).strict(),
	}).strict(),
	next_step: z.string().describe("a note for the assistant: ignore it in a page"),
}).strict();

export const topFoodsReply = z.object({
	covered: z.object({ granularity: z.enum(GRANULARITIES), period_start: z.string(), period_end: z.string(), rank_by: z.enum(RANK_BY), meal_type: z.string().nullable() }).strict(),
	data: z.object({
		foods: z.array(z.object({
			rank: num, food: z.string(), brand: z.string().nullable(), source: z.string(), value: num.describe("the total of the ranked metric"),
			share_pct: num.nullable().describe("null when ranking by days_eaten"), days_eaten: num, entries: num, grams_total: num,
			kcal_total: num, protein_g_total: num, sugar_g_total: num, sodium_mg_total: num,
		}).strict()),
		everything_else: z.object({ foods: num, value: num, share_pct: num }).strict().nullable().describe("null when nothing is left over, or with days_eaten"),
		foods_in_window: num,
		window_total: num.nullable().describe("null with days_eaten"),
	}).strict(),
}).strict();

export const targetsReply = z.object({ data: z.object({ targets: targetsView }).strict(), setup }).strict();
export const archiveTargetReply = z.object({ data: z.object({ metric: z.string(), archived: z.boolean(), targets: targetsView }).strict(), setup }).strict();

export const dayReply = z.object({
	date: z.string(),
	food_logs: z.array(z.object({
		log_id: z.string(), meal_type: z.enum(MEAL_TYPES).describe("water entries have meal_type water"), food_id: z.string(), food_name: z.string(), grams: num,
		note: z.string().nullable(), eaten: z.boolean().describe("false means planned"), mindfulness_score: num.nullable(),
		eaten_at: z.iso.datetime({ offset: true }).describe("local time with its UTC offset"), nutrients,
	}).strict()),
	workouts: z.array(z.object({
		workout_id: z.string(), date: z.string(), type: z.enum(WORKOUT_TYPES), duration_minutes: num, kcal_burned: num,
		intensity: z.enum(WORKOUT_INTENSITIES), source: z.enum(WORKOUT_SOURCES), note: z.string().nullable(),
	}).strict()),
	totals: z.object({
		date: z.string(), eaten: nutrients, planned: nutrients.describe("includes entries with eaten false"),
		targets: z.record(z.string(), num).describe(byMetric("only metrics with a saved target")), remaining: z.record(z.string(), num).describe(byMetric("what is left of each target")),
		water_ml: num, workout_kcal_burned: num,
	}).strict(),
	mindfulness_avg: num.nullable(),
}).strict();

/** The reply as JSON text, once, after checking it against its schema. The order of the keys stays the service's. */
export const jsonOf = <T extends Record<string, unknown>>(schema: z.ZodType) => (r: T) => {
	schema.parse(r);
	return JSON.stringify(r);
};

// ---- Rendering a schema as text the model reads ----

interface Json { type?: string | string[]; properties?: Record<string, Json>; required?: string[]; items?: Json; enum?: unknown[]; anyOf?: Json[]; additionalProperties?: Json | boolean; const?: unknown; description?: string }
interface Look { depth: number; types: boolean; oneLine: boolean; comments: boolean }

const kind = (j: Json) => (Array.isArray(j.type) ? j.type[0] : j.type);
const isContainer = (j: Json): boolean => (j.anyOf ? j.anyOf.some(isContainer) : kind(j) === "object" || kind(j) === "array");

function render(j: Json, level: number, d: number, o: Look): string {
	if (j.anyOf) return j.anyOf.map((x) => render(x, level, d, o)).join(" | ");
	if (j.enum) return j.enum.map((v) => JSON.stringify(v)).join(" | ");
	if (j.const !== undefined) return JSON.stringify(j.const);
	if (Array.isArray(j.type)) return j.type.map((t) => render({ ...j, type: t }, level, d, o)).join(" | "); // for example string | null
	if (kind(j) === "array") return d >= o.depth ? "[ ... ]" : `[ ${render(j.items ?? {}, level, d + 1, o)} ]`;
	if (kind(j) === "object") return renderObject(j, level, d, o);
	const t = kind(j);
	return t === "integer" ? "number" : (t ?? "any");
}

function renderObject(j: Json, level: number, d: number, o: Look): string {
	const props = Object.entries(j.properties ?? {});
	if (props.length === 0) return typeof j.additionalProperties === "object" ? `{ <key>: ${render(j.additionalProperties, level, d + 1, o)} }` : "{}";
	if (d >= o.depth) return "{ ... }";
	const required = new Set(j.required ?? []);
	const kids = props.map(([k, v]) => [required.has(k) ? k : `${k}?`, v] as const);
	if (kids.length > 3 && kids.every(([, v]) => v.type === "number")) return `{ ${kids.map(([k]) => k).join(", ")}: number }`; // many numbers: one line
	const part = ([k, v]: readonly [string, Json]) => (!isContainer(v) && !o.types && !v.enum && !v.anyOf ? k : `${k}: ${render(v, level + 1, d + 1, o)}`);
	if (o.oneLine || kids.every(([, v]) => !isContainer(v))) return `{ ${kids.map(part).join(", ")} }`;
	const pad = "  ".repeat(level + 1);
	const lines = kids.map((kv) => `${pad}${part(kv)},${o.comments && kv[1].description ? `  // ${kv[1].description}` : ""}`);
	return `{\n${lines.join("\n")}\n${"  ".repeat(level)}}`;
}

function describe(schema: z.ZodType, o: Look): string {
	return render(z.toJSONSchema(schema, { io: "output", unrepresentable: "any" }) as Json, 0, 0, o);
}

/** The whole nested shape, with a comment for each field that has one, for how_to_build_dashboard. */
export const fullShape = (schema: z.ZodType) => describe(schema, { depth: 99, types: true, oneLine: false, comments: true });

/** The "Response shapes" section of the dashboard doc, generated from the schemas above. */
export function responseShapesDoc(): string {
	const block = (name: string, schema: z.ZodType, note = "") => `**\`${name}\`**${note}\n\`\`\`\n${fullShape(schema)}\n\`\`\``;
	return [
		"Every tool replies with **one JSON object**. Keep the **whole reply** as one source and read from it by the paths below. Do not assume `rows` or `foods` sit at the top level, and do not hand a chart a nested object where it expects a list. These shapes are generated from the server's own checks and are exact, including everything nested. `[ item ]` is a list of that item, `{ <key>: x }` is an object keyed by name, `|` means \"or\", `?` marks a field that may be missing.",
		block("get_report", reportReply),
		block("get_top_foods", topFoodsReply),
		block("get_daily_target_metrics", targetsReply, " (`set_daily_target_metrics` replies the same way)"),
		block("get_day", dayReply, " (no `data` wrapper)"),
	].join("\n\n");
}
