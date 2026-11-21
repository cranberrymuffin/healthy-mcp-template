// Nutrient math. The server does ALL of this, never the model. Pure functions, no I/O.
// Food values are per 100 g. A log row stores grams only; nutrients are computed here.
/**
 * Every nutrient on the standard label. All are required, so a food can never be saved with a value silently missing.
 * They are per 100 g of a food, or the totals of a whole meal. Lives here, with the math, so this module imports
 * nothing from the data layer.
 */
export interface Nutrients {
	kcal: number;
	protein_g: number;
	fat_g: number;
	carbs_g: number;
	fiber_g: number;
	sugar_g: number;
	added_sugar_g: number;
	saturated_fat_g: number;
	trans_fat_g: number;
	cholesterol_mg: number;
	sodium_mg: number;
}
export type NutrientValues = Nutrients;

export const NUTRIENT_KEYS = ["kcal", "protein_g", "fat_g", "carbs_g", "fiber_g", "sugar_g", "added_sugar_g", "saturated_fat_g", "trans_fat_g", "cholesterol_mg", "sodium_mg"] as const satisfies readonly (keyof Nutrients)[];
/** The nutrients an outside database may leave out (everything except calories and macros). */
export type ExtraKey = Exclude<keyof Nutrients, "kcal" | "protein_g" | "fat_g" | "carbs_g">;
export const EXTRA_KEYS: readonly ExtraKey[] = NUTRIENT_KEYS.slice(4) as ExtraKey[];

/** The metrics a person can set a target for. */
export const TARGET_METRICS = ["kcal", "protein_g", "fat_g", "carbs_g", "fiber_g", "sugar_g", "added_sugar_g", "sodium_mg", "water_ml", "workout_kcal_burned"] as const;
export type TargetMetric = (typeof TARGET_METRICS)[number];

/** Metrics that setup does not ask for: a person who does not track workouts is not "missing" a target. */
export const OPTIONAL_METRICS: readonly TargetMetric[] = ["workout_kcal_burned"];

/** at_least: met at or above the target minus tolerance. at_most: met at or below the target plus tolerance. around: within the target plus or minus tolerance. */
export const DIRECTIONS = ["at_least", "at_most", "around"] as const;
export type Direction = (typeof DIRECTIONS)[number];

/** Used when the person has not chosen: the tolerance applies to every target without its own, and the direction suits the metric. */
export const DEFAULT_TOLERANCE_PCT = 10;
export const DEFAULT_DIRECTION: Record<TargetMetric, Direction> = {
	kcal: "around", carbs_g: "around", fat_g: "around",
	protein_g: "at_least", fiber_g: "at_least", water_ml: "at_least", workout_kcal_burned: "at_least",
	sugar_g: "at_most", added_sugar_g: "at_most", sodium_mg: "at_most",
};

/** One target. tolerance_pct null means the default applies. */
export interface TargetSpec {
	target: number;
	tolerance_pct: number | null;
	direction: Direction;
}
/** A metric that is missing has no target. */
export type Targets = Partial<Record<TargetMetric, TargetSpec>>;

/** One log's unrounded nutrients (from scale() or scaleMeal()) and whether it was eaten. */
export interface DayEntry {
	eaten: boolean;
	nutrients: Nutrients;
}

export interface DayTotals {
	date: string;
	eaten: Nutrients;
	planned: Nutrients;
	targets: Record<string, number>;
	remaining: Record<string, number>;
	/** Millilitres of water eaten (food logs with meal_type water, 1 g = 1 ml). */
	water_ml: number;
	/** Calories burned by the day's workouts. */
	workout_kcal_burned: number;
}

const zero = () => Object.fromEntries(NUTRIENT_KEYS.map((k) => [k, 0])) as unknown as Nutrients;

// Floats like 10.1 * 1.5 = 15.149999999999999 must still round to 15.2, so snap to 12 significant digits first.
const snap = (x: number) => Number(x.toPrecision(12));
const clean = (x: number) => (x === 0 ? 0 : x); // turn -0 into 0

export const round1 = (x: number) => clean(Math.round(snap(x * 10)) / 10);
export const roundKcal = (x: number) => clean(Math.round(snap(x)));

/** Nutrients in `grams` of a food, unrounded. */
export function scale(food: NutrientValues, grams: number): Nutrients {
	const out = zero();
	for (const k of NUTRIENT_KEYS) out[k] = (food[k] * grams) / 100;
	return out;
}

export function sum(list: Nutrients[]): Nutrients {
	const total = zero();
	for (const n of list) for (const k of NUTRIENT_KEYS) total[k] += n[k];
	return total;
}

/** Display rounding: calories to whole numbers, everything else to 1 decimal. Round once, at the end. */
export function roundNutrients(n: Nutrients): Nutrients {
	const out = zero();
	for (const k of NUTRIENT_KEYS) out[k] = k === "kcal" ? roundKcal(n[k]) : round1(n[k]);
	return out;
}

/**
 * Totals for one day, over the day's food logs. `eaten` counts only eaten rows; `planned` counts eaten and not-yet-eaten rows.
 * `targets` lists only targets that are set (the target numbers). `remaining` = target minus the ROUNDED eaten value (so the
 * numbers the assistant reads out always add up), only for targets that are set. Negative means over the target.
 */
export function dayTotals(date: string, entries: DayEntry[], targets: Targets | null, waterMl = 0, workoutKcal = 0): DayTotals {
	const all = entries.map((e) => e.nutrients);
	const eatenOnly = entries.filter((e) => e.eaten).map((e) => e.nutrients);
	const eaten = roundNutrients(sum(eatenOnly));
	const planned = roundNutrients(sum(all));

	const setTargets: Record<string, number> = {};
	for (const metric of TARGET_METRICS) {
		const t = targets?.[metric]?.target;
		if (t != null) setTargets[metric] = t;
	}

	const remaining: Record<string, number> = {};
	const water = round1(waterMl);
	const burned = roundKcal(workoutKcal);
	for (const metric of TARGET_METRICS) {
		const t = targets?.[metric]?.target;
		if (t == null) continue;
		remaining[metric] =
			metric === "water_ml" ? round1(t - water)
			: metric === "workout_kcal_burned" ? roundKcal(t - burned)
			: metric === "kcal" ? roundKcal(t - eaten.kcal)
			: round1(t - eaten[metric]);
	}
	return { date, eaten, planned, targets: setTargets, remaining, water_ml: water, workout_kcal_burned: burned };
}

/** Mindfulness is shown to users as 1 to 10 and stored as 0 to 1. */
export const mindfulnessToStored = (score: number) => (score - 1) / 9;
export const mindfulnessFromStored = (stored: number) => round1(stored * 9 + 1);

// ---- Reports (get_report): adherence, trends, shares and time buckets. Pure functions over per-day totals. ----

const roundFor = (metric: TargetMetric, x: number) => (metric === "kcal" || metric === "workout_kcal_burned" ? roundKcal(x) : round1(x));

/** The range a target accepts, with the tolerance used and whether it is the default. */
export function targetRange(spec: TargetSpec) {
	const tolerance = spec.tolerance_pct ?? DEFAULT_TOLERANCE_PCT;
	const out: { tolerance_pct: number; tolerance_is_default: boolean; range_min?: number; range_max?: number } = { tolerance_pct: tolerance, tolerance_is_default: spec.tolerance_pct == null };
	if (spec.direction !== "at_most") out.range_min = round1((spec.target * (100 - tolerance)) / 100);
	if (spec.direction !== "at_least") out.range_max = round1((spec.target * (100 + tolerance)) / 100);
	return out;
}

/** A day's total against a target: met, or which side was missed. The total is rounded first, so it is judged as it is shown. */
export function judgeDay(metric: TargetMetric, total: number, spec: TargetSpec): "met" | "below" | "above" {
	const r = targetRange(spec);
	const t = roundFor(metric, total);
	if (r.range_min !== undefined && t < r.range_min) return "below";
	if (r.range_max !== undefined && t > r.range_max) return "above";
	return "met";
}

/** One day's totals for the metrics that can have a target. has_data: any food or water was logged that day (a workout alone does not count). */
export interface DayMetrics {
	date: string;
	has_data: boolean;
	totals: Record<TargetMetric, number>;
}

/**
 * Adherence over completed days, oldest first. A day with nothing logged is neither met nor missed (days_unlogged) and ends a streak.
 * A metric without a target is listed in not_tracked and left out of every count.
 */
export function adherence(days: DayMetrics[], targets: Targets) {
	const logged = days.filter((d) => d.has_data);
	const tracked = TARGET_METRICS.filter((m) => targets[m] !== undefined);
	const goals = tracked.map((metric) => {
		const spec = targets[metric]!;
		let met = 0, below = 0, above = 0, streak = 0, longest = 0;
		for (const d of days) {
			if (!d.has_data) { streak = 0; continue; }
			const verdict = judgeDay(metric, d.totals[metric], spec);
			if (verdict === "met") { met++; streak++; longest = Math.max(longest, streak); }
			else { streak = 0; if (verdict === "below") below++; else above++; }
		}
		return {
			metric, target: spec.target, direction: spec.direction, ...targetRange(spec),
			days_met: met, days_missed: below + above, missed_below: below, missed_above: above,
			days_unlogged: days.length - logged.length,
			adherence_pct: logged.length === 0 ? 0 : Math.round((met * 100) / logged.length),
			current_streak: streak, longest_streak: longest,
		};
	});
	const allMet = tracked.length === 0 ? 0 : logged.filter((d) => tracked.every((m) => judgeDay(m, d.totals[m], targets[m]!) === "met")).length;
	return { days_with_data: logged.length, days_all_targets_met: allMet, targets: goals, not_tracked: TARGET_METRICS.filter((m) => targets[m] === undefined) };
}

/** Change in the average per logged day between two stretches of days: up, down or flat (under 5 percent). Metrics with no data on either side are left out. */
export function trend(earlier: DayMetrics[], later: DayMetrics[]) {
	const avg = (days: DayMetrics[], m: TargetMetric) => {
		const logged = days.filter((d) => d.has_data);
		return logged.length === 0 ? null : logged.reduce((s, d) => s + d.totals[m], 0) / logged.length;
	};
	const out: Partial<Record<TargetMetric, { direction: "up" | "down" | "flat"; change_pct: number }>> = {};
	for (const m of TARGET_METRICS) {
		const a = avg(earlier, m), b = avg(later, m);
		if (a === null || b === null || a === 0) continue;
		const pct = Math.round(((b - a) * 100) / a);
		out[m] = { direction: Math.abs(pct) < 5 ? "flat" : pct > 0 ? "up" : "down", change_pct: pct };
	}
	return out;
}

/** Whole-number percent shares that add up to exactly 100 (largest remainder). All zeros when the total is 0. */
export function shares(values: number[]): number[] {
	const total = values.reduce((s, v) => s + v, 0);
	if (total <= 0) return values.map(() => 0);
	const exact = values.map((v) => (v * 100) / total);
	const out = exact.map(Math.floor);
	let left = 100 - out.reduce((s, v) => s + v, 0);
	for (const i of exact.map((x, i) => [x - Math.floor(x), i] as const).sort((p, q) => q[0] - p[0] || p[1] - q[1]).map((x) => x[1])) {
		if (left <= 0) break;
		out[i]++;
		left--;
	}
	return out;
}

export const TIME_BUCKETS = ["early_morning", "late_morning", "afternoon", "evening", "night"] as const;
export type TimeBucket = (typeof TIME_BUCKETS)[number];

/** The part of the day for a local hour (0 to 23): early morning 5 to 9, late morning 10 to 11, afternoon 12 to 16, evening 17 to 21, night 22 to 4. */
export function timeBucket(hour: number): TimeBucket {
	if (hour >= 5 && hour < 10) return "early_morning";
	if (hour >= 10 && hour < 12) return "late_morning";
	if (hour >= 12 && hour < 17) return "afternoon";
	if (hour >= 17 && hour < 22) return "evening";
	return "night";
}
