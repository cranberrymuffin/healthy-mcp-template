// get_report: a read-only report. The window is fixed by the granularity, so an answer is always small.
// Totals, averages, adherence and trends are computed here and in src/nutrition.ts; the model never adds anything up.
import { firstLogDate, getDailyTargetMetrics, listEatenLogsInRange, listWorkoutsInRange, type MealType, type RangeLogRow, type UserId } from "../data";
import {
	adherence, roundKcal, round1, roundNutrients, scale, shares, sum, TARGET_METRICS, timeBucket, TIME_BUCKETS, trend,
	type DayMetrics, type Nutrients, type TargetMetric,
} from "../nutrition";
import { addDays, isValidDate, localDate, localHour, localIso, mondayOf, monthEnd, monthStart } from "../time";
import { fail, userTimeZone } from "./common";
import { missingTargets } from "./dailyTargetMetrics";

export const GRANULARITIES = ["day", "week", "month"] as const;
export type Granularity = (typeof GRANULARITIES)[number];
const REPORT_MEALS: MealType[] = ["breakfast", "lunch", "dinner", "snack", "dessert"]; // water has its own field
/** Days since the first log before a granularity works; day has no wait. */
const MIN_DAYS_OF_LOGS: Partial<Record<Granularity, number>> = { week: 7, month: 30 };

export interface ReportInput { granularity: Granularity; end_date?: string }
interface Period { start: string; end: string }

/** The fixed window: 7 days, 8 weeks (Monday to Sunday) or 6 calendar months, ending with the one that holds `end`. */
function periodsFor(g: Granularity, end: string): Period[] {
	if (g === "day") return Array.from({ length: 7 }, (_, i) => ({ start: addDays(end, i - 6), end: addDays(end, i - 6) }));
	if (g === "week") return Array.from({ length: 8 }, (_, i) => ({ start: addDays(mondayOf(end), (i - 7) * 7), end: addDays(mondayOf(end), (i - 7) * 7 + 6) }));
	return Array.from({ length: 6 }, (_, i) => ({ start: monthStart(end, i - 5), end: monthEnd(monthStart(end, i - 5)) }));
}

function datesBetween(from: string, to: string): string[] {
	const out: string[] = [];
	for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
	return out;
}

/** One day, before rounding. has_data is true when any food or water was logged (a workout alone does not count). */
interface DayAgg { n: Nutrients; water_ml: number; entries: number; estimated: number; has_data: boolean; workouts: number; workout_minutes: number; workout_kcal: number }
const newAgg = (): DayAgg => ({ n: sum([]), water_ml: 0, entries: 0, estimated: 0, has_data: false, workouts: 0, workout_minutes: 0, workout_kcal: 0 });
const metricTotal = (a: DayAgg, m: TargetMetric) => (m === "water_ml" ? a.water_ml : m === "workout_kcal_burned" ? a.workout_kcal : a.n[m]);
const metricTotals = (a: DayAgg) => Object.fromEntries(TARGET_METRICS.map((m) => [m, metricTotal(a, m)])) as Record<TargetMetric, number>;
const grouped = <T>(items: T[], key: (t: T) => string) => {
	const m = new Map<string, T[]>();
	for (const i of items) m.set(key(i), [...(m.get(key(i)) ?? []), i]);
	return m;
};

function buildRow(g: Granularity, p: Period, today: string, tz: string, days: Map<string, DayAgg>, logsByDate: Map<string, RangeLogRow[]>) {
	const dates = datesBetween(p.start, p.end);
	const aggs = dates.map((d) => days.get(d)).filter((a): a is DayAgg => a !== undefined);
	const total = sum(aggs.map((a) => a.n));
	const t = roundNutrients(total);
	const water = aggs.reduce((s, a) => s + a.water_ml, 0);
	const dwd = aggs.filter((a) => a.has_data).length;
	const kp = roundKcal(t.protein_g * 4), kf = roundKcal(t.fat_g * 9), kc = roundKcal(t.carbs_g * 4);
	const row: Record<string, unknown> = {
		period_start: p.start, period_end: p.end, in_progress: today >= p.start && today <= p.end, days_with_data: dwd,
		kcal_total: t.kcal, kcal_from_protein: kp, kcal_from_fat: kf, kcal_from_carbs: kc, kcal_other: t.kcal - kp - kf - kc,
		protein_g: t.protein_g, fat_g: t.fat_g, carbs_g: t.carbs_g, fiber_g: t.fiber_g, sugar_g: t.sugar_g, added_sugar_g: t.added_sugar_g,
		sodium_mg: t.sodium_mg, water_ml: round1(water),
		entries: aggs.reduce((s, a) => s + a.entries, 0), estimated_entries: aggs.reduce((s, a) => s + a.estimated, 0),
		workouts: aggs.reduce((s, a) => s + a.workouts, 0), workout_minutes: round1(aggs.reduce((s, a) => s + a.workout_minutes, 0)), workout_kcal_burned: roundKcal(aggs.reduce((s, a) => s + a.workout_kcal, 0)),
	};
	if (g === "day") {
		const logs = (logsByDate.get(p.start) ?? []).filter((l) => l.meal_type !== "water");
		const scaled = logs.map((l) => ({ l, n: scale(l, l.grams) }));
		row.top_sugar_sources = scaled
			.filter((x) => x.n.sugar_g > 0)
			.sort((a, b) => b.n.sugar_g - a.n.sugar_g)
			.slice(0, 3)
			.map((x) => ({ food: x.l.food_name, grams: round1(x.l.grams), sugar_g: round1(x.n.sugar_g), eaten_at: localIso(new Date(x.l.eaten_at), tz) }));
		row.time_buckets = TIME_BUCKETS.map((bucket) => {
			const inBucket = scaled.filter((x) => timeBucket(localHour(new Date(x.l.eaten_at), tz)) === bucket);
			return { bucket, kcal: roundKcal(sum(inBucket.map((x) => x.n)).kcal), sugar_g: round1(inBucket.reduce((s, x) => s + x.n.sugar_g, 0)), entries: inBucket.length };
		});
	} else {
		const avg = (x: number) => (dwd === 0 ? 0 : x / dwd);
		row.daily_avg = {
			kcal_total: roundKcal(avg(total.kcal)), protein_g: round1(avg(total.protein_g)), fat_g: round1(avg(total.fat_g)), carbs_g: round1(avg(total.carbs_g)), fiber_g: round1(avg(total.fiber_g)),
			sugar_g: round1(avg(total.sugar_g)), added_sugar_g: round1(avg(total.added_sugar_g)), sodium_mg: round1(avg(total.sodium_mg)), water_ml: round1(avg(water)),
		};
	}
	return row;
}

function mealTypes(logs: RangeLogRow[], daysWithData: number) {
	const per = REPORT_MEALS.map((m) => {
		const ls = logs.filter((l) => l.meal_type === m);
		return { m, n: sum(ls.map((l) => scale(l, l.grams))), entries: ls.length };
	});
	const pct = shares(per.map((p) => p.n.kcal));
	return per.map((p, i) => ({
		meal_type: p.m, kcal_total: roundKcal(p.n.kcal), protein_g_total: round1(p.n.protein_g), daily_avg_kcal: daysWithData === 0 ? 0 : roundKcal(p.n.kcal / daysWithData),
		share_of_kcal_pct: pct[i], entries: p.entries,
	}));
}

/** One sentence the model can quote. */
function summaryText(days: DayMetrics[], adh: ReturnType<typeof adherence>, tr: ReturnType<typeof trend>) {
	if (adh.days_with_data === 0) return "Nothing was logged on the completed days of this period.";
	const logged = days.filter((d) => d.has_data);
	const avg = (m: TargetMetric) => logged.reduce((s, d) => s + d.totals[m], 0) / logged.length;
	let text = `${adh.days_with_data} of ${days.length} days were logged, averaging ${roundKcal(avg("kcal"))} kcal and ${round1(avg("protein_g"))} g protein a day`;
	const sugar = tr.added_sugar_g;
	if (sugar && sugar.direction !== "flat") text += `; added sugar ${sugar.direction === "down" ? "fell" : "rose"} ${Math.abs(sugar.change_pct)}% from the first half to the second`;
	if (adh.targets.length > 0) text += `; every target was met on ${adh.days_all_targets_met} of ${adh.days_with_data} logged days`;
	return `${text}.`;
}

/** The user's day, the validated end date and the fixed window, shared by get_report and get_top_foods. */
export async function reportWindow(db: D1Database, userId: UserId, granularity: Granularity, endDate: string | undefined) {
	const tz = await userTimeZone(db, userId);
	const today = localDate(new Date(), tz);
	const end = endDate ?? today;
	if (!isValidDate(end)) throw fail(`end_date must be YYYY-MM-DD. Try again without end_date for today (${today}).`, "end_date");
	if (end > today) throw fail(`end_date cannot be after today (${today}). Try again with end_date ${today}, or leave it out.`, "end_date");
	const periods = periodsFor(granularity, end);
	return { tz, today, end, periods, from: periods[0].start, to: periods[periods.length - 1].end };
}

/** The error for a window with nothing in it, with a way forward: where the user's data starts. */
export async function noDataError(db: D1Database, userId: UserId, what: string, from: string, to: string) {
	const first = await firstLogDate(db, userId);
	const hint =
		first === null
			? "Nothing has been logged yet: ask the user to log some food or water first."
			: to < first
				? `The user's first log is on ${first}: try an end_date on or after ${first}.`
				: `The user's first log is on ${first}: try an end_date on a day they logged, or a different granularity.`;
	return fail(`No ${what} between ${from} and ${to}. ${hint}`, "end_date");
}

export async function getReport(db: D1Database, userId: UserId, input: ReportInput) {
	const { tz, today, end, periods, from, to } = await reportWindow(db, userId, input.granularity, input.end_date);

	// A report without targets would say little, so it is refused until every required target is set.
	const targets = await getDailyTargetMetrics(db, userId);
	const missing = missingTargets(targets);
	if (missing.length > 0) {
		throw fail(
			`The report needs these daily targets first: ${missing.join(", ")}. Answer the user, ask once for these values (say what they gain: the report judges each day against them), save them with set_daily_target_metrics, then call get_report again. Never invent a value.`,
			"targets",
		);
	}

	// A week report needs a week of history and a month report a month (30 days): each opens that many days after the first log.
	const needed = MIN_DAYS_OF_LOGS[input.granularity];
	if (needed !== undefined) {
		const first = await firstLogDate(db, userId);
		if (first === null || addDays(first, needed) > today) {
			const name = input.granularity === "week" ? "weekly" : "monthly";
			const lesser = input.granularity === "week" ? "the day report (granularity day)" : "the day or week report (granularity day or week)";
			throw fail(
				`Not enough data for the ${name} report: you must log food or water for at least ${needed} days before it works. ` +
					(first === null ? "Nothing is logged yet. " : `The first log is on ${first}, so the ${name} report opens on ${addDays(first, needed)}. `) +
					`Tell the user to keep logging until then, and offer ${lesser} for now.`,
				"granularity",
			);
		}
	}

	const [logs, workouts] = await Promise.all([listEatenLogsInRange(db, userId, from, to), listWorkoutsInRange(db, userId, from, to)]);

	if (logs.length === 0 && workouts.length === 0) throw await noDataError(db, userId, "food, water or workouts logged", from, to);

	const days = new Map<string, DayAgg>();
	const agg = (d: string) => days.get(d) ?? (days.set(d, newAgg()), days.get(d)!);
	for (const l of logs) {
		const a = agg(l.date);
		a.has_data = true;
		if (l.meal_type === "water") { a.water_ml += l.grams; continue; } // 1 g of water = 1 ml
		a.n = sum([a.n, scale(l, l.grams)]);
		a.entries++;
		if (l.source === "estimate") a.estimated++;
	}
	for (const w of workouts) {
		const a = agg(w.date);
		a.workouts++;
		a.workout_minutes += w.duration_minutes;
		a.workout_kcal += w.kcal_burned;
	}

	const logsByDate = grouped(logs, (l) => l.date);
	const rows = periods.map((p) => buildRow(input.granularity, p, today, tz, days, logsByDate));

	// Adherence and the trend use completed days only: today is still in progress, and days after end_date have not been asked for.
	const lastDone = end >= today ? addDays(today, -1) : end;
	const dayMetrics: DayMetrics[] = datesBetween(from, lastDone).map((d) => ({ date: d, has_data: days.get(d)?.has_data ?? false, totals: metricTotals(days.get(d) ?? newAgg()) }));
	const half = Math.floor(dayMetrics.length / 2);
	const adh = adherence(dayMetrics, targets ?? {});
	const tr = dayMetrics.length < 2 ? {} : trend(dayMetrics.slice(0, half), dayMetrics.slice(half));

	const foodLogs = logs.filter((l) => l.meal_type !== "water");
	const loggedDays = [...days.values()].filter((a) => a.has_data).length;
	const byType = [...grouped(workouts, (w) => w.type).entries()]
		.map(([type, ws]) => ({
			type, workouts: ws.length, days_with_workout: new Set(ws.map((w) => w.date)).size, minutes_total: round1(ws.reduce((s, w) => s + w.duration_minutes, 0)),
			kcal_burned_total: roundKcal(ws.reduce((s, w) => s + w.kcal_burned, 0)), estimated_workouts: ws.filter((w) => w.source === "estimate").length, hard_workouts: ws.filter((w) => w.intensity === "hard").length,
		}))
		.sort((a, b) => b.minutes_total - a.minutes_total || a.type.localeCompare(b.type));

	return {
		covered: { granularity: input.granularity, period_start: from, period_end: to },
		data: {
			rows,
			summary: {
				trend: tr, adherence: adh, meal_types: mealTypes(foodLogs, loggedDays), workout_types: byType,
				text: summaryText(dayMetrics, adh, tr),
			},
		},
	};
}
