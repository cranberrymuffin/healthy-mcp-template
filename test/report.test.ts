import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { createFood, findOrCreateUser } from "../src/data";
import { adherence, judgeDay, shares, targetRange, timeBucket, trend, type DayMetrics } from "../src/nutrition";
import { archiveLog, logEntries } from "../src/services/logs";
import { getReport } from "../src/services/report";
import { setDailyTargetMetricsView } from "../src/services/dailyTargetMetrics";
import { logWorkout } from "../src/services/workouts";
import { addDays, localDate, localIso, mondayOf, monthEnd, monthStart } from "../src/time";
import { logFood, REST, spec } from "./helpers";

const db = env.DB;

describe("report math", () => {
	it("target ranges and judging", () => {
		expect(targetRange(spec(150, "around"))).toMatchObject({ range_min: 135, range_max: 165, tolerance_pct: 10, tolerance_is_default: true });
		expect(targetRange(spec(25, "at_most"))).toEqual({ range_max: 27.5, tolerance_pct: 10, tolerance_is_default: true });
		expect(targetRange(spec(150, "at_least", 0))).toEqual({ range_min: 150, tolerance_pct: 0, tolerance_is_default: false });
		expect(judgeDay("protein_g", 135, spec(150, "at_least"))).toBe("met");
		expect(judgeDay("protein_g", 134.9, spec(150, "at_least"))).toBe("below");
		expect(judgeDay("added_sugar_g", 27.5, spec(25, "at_most"))).toBe("met");
		expect(judgeDay("added_sugar_g", 27.6, spec(25, "at_most"))).toBe("above");
		expect(judgeDay("workout_kcal_burned", 269.6, spec(300, "at_least"))).toBe("met");
		expect(judgeDay("workout_kcal_burned", 269.4, spec(300, "at_least"))).toBe("below");
		expect(judgeDay("kcal", 2300, spec(2000, "around", 15))).toBe("met");
		expect(judgeDay("kcal", 2301, spec(2000, "around", 15))).toBe("above");
	});

	it("shares add up to exactly 100", () => {
		expect(shares([1, 1, 1])).toEqual([34, 33, 33]);
		expect(shares([50, 30, 20])).toEqual([50, 30, 20]);
		expect(shares([0, 0])).toEqual([0, 0]);
		for (const v of [[7, 11, 13, 17, 19], [1, 2], [333, 333, 334]]) expect(shares(v).reduce((s, x) => s + x, 0)).toBe(100);
	});

	it("time buckets", () => {
		expect([4, 5, 9, 10, 11, 12, 16, 17, 21, 22, 23, 0].map(timeBucket)).toEqual([
			"night", "early_morning", "early_morning", "late_morning", "late_morning", "afternoon", "afternoon", "evening", "evening", "night", "night", "night",
		]);
	});

	const day = (date: string, has_data: boolean, protein: number): DayMetrics => ({
		date, has_data, totals: { kcal: 0, protein_g: protein, fat_g: 0, carbs_g: 0, fiber_g: 0, sugar_g: 0, added_sugar_g: 0, sodium_mg: 0, water_ml: 0, workout_kcal_burned: 0 },
	});
	it("adherence: unlogged days are neither met nor missed and end a streak; unset targets are not tracked", () => {
		const days = [day("d1", true, 150), day("d2", true, 150), day("d3", false, 0), day("d4", true, 150), day("d5", true, 100), day("d6", true, 160)];
		const r = adherence(days, { protein_g: spec(150, "at_least") });
		expect(r.days_with_data).toBe(5);
		expect(r.targets).toHaveLength(1);
		expect(r.targets[0]).toMatchObject({ metric: "protein_g", days_met: 4, days_missed: 1, missed_below: 1, missed_above: 0, days_unlogged: 1, adherence_pct: 80, current_streak: 1, longest_streak: 2, range_min: 135 });
		expect(r.days_all_targets_met).toBe(4);
		expect(r.not_tracked).toContain("kcal");
		expect(r.not_tracked).not.toContain("protein_g");
	});

	it("trend compares averages per logged day", () => {
		expect(trend([day("a", true, 100), day("b", false, 0)], [day("c", true, 80)]).protein_g).toEqual({ direction: "down", change_pct: -20 });
		expect(trend([day("a", true, 100)], [day("c", true, 102)]).protein_g).toEqual({ direction: "flat", change_pct: 2 });
		expect(trend([day("a", false, 0)], [day("c", true, 80)])).toEqual({});
	});

	it("date helpers", () => {
		expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
		expect(mondayOf("2026-03-15")).toBe("2026-03-09"); // a Sunday
		expect(mondayOf("2026-03-09")).toBe("2026-03-09");
		expect(monthStart("2026-03-15", -5)).toBe("2025-10-01");
		expect(monthEnd("2026-02-10")).toBe("2026-02-28");
		expect(localIso(new Date("2026-03-12T19:30:00Z"), "America/New_York")).toBe("2026-03-12T15:30:00-04:00");
		expect(localIso(new Date("2026-01-12T19:30:00Z"), "Asia/Kolkata")).toBe("2026-01-13T01:00:00+05:30");
	});
});

describe("get_report", () => {
	let u: string, other: string;
	const A = { name: "Food A", kcal: 100, protein_g: 10, fat_g: 5, carbs_g: 10, ...REST, sugar_g: 8, added_sugar_g: 4, sodium_mg: 100, source: "label" as const };
	const B = { name: "Food B", kcal: 200, protein_g: 5, fat_g: 10, carbs_g: 20, ...REST, sugar_g: 20, added_sugar_g: 10, sodium_mg: 50, source: "estimate" as const };
	const END = "2026-03-15"; // a Sunday, well in the past

	beforeAll(async () => {
		u = (await findOrCreateUser(db, { provider: "github", subject: "6001" })).id;
		other = (await findOrCreateUser(db, { provider: "github", subject: "6002" })).id;
		const a = await createFood(db, u, A);
		const b = await createFood(db, u, B);
		await logFood(db, u, { meal_type: "breakfast", food_id: a.id, grams: 200, eaten_at: "2026-03-12T08:00:00-04:00" });
		await logFood(db, u, { meal_type: "snack", food_id: b.id, grams: 100, eaten_at: "2026-03-12T15:30:00-04:00" });
		await logEntries(db, u, { client_request_id: crypto.randomUUID(), water_ml: 500, date: "2026-03-12" });
		await logFood(db, u, { meal_type: "lunch", food_id: a.id, grams: 100, date: "2026-03-13" });
		await logFood(db, u, { meal_type: "snack", food_id: b.id, grams: 100, date: "2026-03-14", eaten: false }); // planned: not counted
		const archived = await logFood(db, u, { meal_type: "snack", food_id: b.id, grams: 100, date: "2026-03-14" });
		await archiveLog(db, u, archived.log_id); // archived: not counted
		await logWorkout(db, u, { client_request_id: crypto.randomUUID(), type: "run", duration_minutes: 30, kcal_burned: 300, intensity: "hard", source: "reported", date: "2026-03-12" });
		await setDailyTargetMetricsView(db, u, { protein_g: { target: 40 }, added_sugar_g: { target: 15, tolerance_pct: 0 }, kcal: { target: 400 },
			fat_g: { target: 1000, tolerance_pct: 100 }, carbs_g: { target: 1000, tolerance_pct: 100 }, fiber_g: { target: 1000, tolerance_pct: 100 }, sugar_g: { target: 1000, tolerance_pct: 100 }, sodium_mg: { target: 100000, tolerance_pct: 100 }, water_ml: { target: 100000, tolerance_pct: 100 },
		});
	});

	it("day: seven rows with food, water, workouts, top sugar sources and time buckets", async () => {
		const r = await getReport(db, u, { granularity: "day", end_date: END });
		expect(r.covered).toEqual({ granularity: "day", period_start: "2026-03-09", period_end: END });
		const rows = r.data.rows as Record<string, any>[];
		expect(rows).toHaveLength(7);
		const d = rows.find((x) => x.period_start === "2026-03-12")!;
		expect(d).toMatchObject({
			in_progress: false, days_with_data: 1, kcal_total: 400, protein_g: 25, fat_g: 20, carbs_g: 40, sugar_g: 36, added_sugar_g: 18, sodium_mg: 250, water_ml: 500,
			kcal_from_protein: 100, kcal_from_fat: 180, kcal_from_carbs: 160, kcal_other: -40, entries: 2, estimated_entries: 1,
			workouts: 1, workout_minutes: 30, workout_kcal_burned: 300,
		});
		expect(d.top_sugar_sources.map((s: any) => [s.food, s.sugar_g, s.eaten_at])).toEqual([["Food B", 20, "2026-03-12T15:30:00-04:00"], ["Food A", 16, "2026-03-12T08:00:00-04:00"]]);
		expect(d.time_buckets).toEqual([
			{ bucket: "early_morning", kcal: 200, sugar_g: 16, entries: 1 }, { bucket: "late_morning", kcal: 0, sugar_g: 0, entries: 0 },
			{ bucket: "afternoon", kcal: 200, sugar_g: 20, entries: 1 }, { bucket: "evening", kcal: 0, sugar_g: 0, entries: 0 }, { bucket: "night", kcal: 0, sugar_g: 0, entries: 0 },
		]);
		expect(d).not.toHaveProperty("daily_avg");
		// planned and archived food is left out, and an empty day comes back as zeros, not skipped
		expect(rows.find((x) => x.period_start === "2026-03-14")).toMatchObject({ days_with_data: 0, kcal_total: 0, entries: 0, workouts: 0 });
		expect(rows.find((x) => x.period_start === "2026-03-09")!.time_buckets).toHaveLength(5);
	});

	it("summary: adherence, top foods, meal types, workout types and the text", async () => {
		const s = (await getReport(db, u, { granularity: "day", end_date: END })).data.summary as Record<string, any>;
		const by = (m: string) => s.adherence.targets.find((t: any) => t.metric === m);
		expect(s.adherence.days_with_data).toBe(2);
		expect(by("protein_g")).toMatchObject({ days_met: 0, days_missed: 2, missed_below: 2, days_unlogged: 5, range_min: 36, tolerance_is_default: true });
		expect(by("added_sugar_g")).toMatchObject({ days_met: 1, days_missed: 1, missed_above: 1, tolerance_pct: 0, tolerance_is_default: false, current_streak: 0, longest_streak: 1, range_max: 15 });
		expect(by("kcal")).toMatchObject({ days_met: 1, missed_below: 1, range_min: 360, range_max: 440 });
		expect(s.adherence.days_all_targets_met).toBe(0);
		expect(s.adherence.not_tracked).toEqual(["workout_kcal_burned"]);

		expect(s.meal_types.map((m: any) => m.meal_type)).toEqual(["breakfast", "lunch", "dinner", "snack", "dessert"]);
		expect(s.meal_types.reduce((n: number, m: any) => n + m.share_of_kcal_pct, 0)).toBe(100);
		expect(s.meal_types.find((m: any) => m.meal_type === "breakfast")).toMatchObject({ kcal_total: 200, share_of_kcal_pct: 40, daily_avg_kcal: 100, entries: 1 });
		expect(s.workout_types).toEqual([{ type: "run", workouts: 1, days_with_workout: 1, minutes_total: 30, kcal_burned_total: 300, estimated_workouts: 0, hard_workouts: 1 }]);
		expect(s.text).toBe("2 of 7 days were logged, averaging 250 kcal and 17.5 g protein a day; every target was met on 0 of 2 logged days.");
	});

	it("week and month: one shape with daily averages, and fixed windows", async () => {
		const w = await getReport(db, u, { granularity: "week", end_date: END });
		expect(w.covered).toEqual({ granularity: "week", period_start: "2026-01-19", period_end: END });
		const rows = w.data.rows as Record<string, any>[];
		expect(rows).toHaveLength(8);
		expect(rows[7]).toMatchObject({ period_start: "2026-03-09", period_end: END, days_with_data: 2, kcal_total: 500, entries: 3, workouts: 1 });
		expect(rows[7].daily_avg).toMatchObject({ kcal_total: 250, protein_g: 17.5, water_ml: 250 });
		expect(rows[7]).not.toHaveProperty("top_sugar_sources");
		expect(rows[0]).toMatchObject({ days_with_data: 0, kcal_total: 0 });
		expect(rows[0].daily_avg.kcal_total).toBe(0);

		const m = await getReport(db, u, { granularity: "month", end_date: END });
		expect(m.covered).toEqual({ granularity: "month", period_start: "2025-10-01", period_end: "2026-03-31" });
		expect((m.data.rows as any[])).toHaveLength(6);
		expect((m.data.rows as any[])[5]).toMatchObject({ period_start: "2026-03-01", period_end: "2026-03-31", kcal_total: 500 });
	});

	it("today is in progress and left out of adherence; a future end_date is refused with a way forward", async () => {
		await logFood(db, u, { meal_type: "snack", food_id: (await createFood(db, u, { ...A, name: "Today snack" })).id, grams: 50, date: localDate(new Date(), "America/New_York") });
		const r = await getReport(db, u, { granularity: "day" });
		const rows = r.data.rows as any[];
		expect(rows[6].in_progress).toBe(true);
		expect(rows[0].in_progress).toBe(false);
		await expect(getReport(db, u, { granularity: "day", end_date: "2099-01-01" })).rejects.toMatchObject({ code: "validation_failed", message: expect.stringContaining("Try again with end_date") });
		await expect(getReport(db, u, { granularity: "day", end_date: "2026-02-30" })).rejects.toMatchObject({ code: "validation_failed" });
	});

	it("is refused until every required target is set, and the error names what is missing", async () => {
		const err = await getReport(db, other, { granularity: "day", end_date: END }).catch((e) => e);
		expect(err).toMatchObject({ code: "validation_failed", field: "targets" });
		expect(err.message).toContain("kcal_target");
		expect(err.message).toContain("set_daily_target_metrics");
		expect(err.message).not.toContain("workout_kcal_burned_target");
		await setDailyTargetMetricsView(db, other, { kcal: { target: 2000 } });
		expect((await getReport(db, other, { granularity: "day", end_date: END }).catch((e) => e)).message).not.toContain("kcal_target");
	});

	it("the week report opens 7 days after the first log and the month report 30; the day report does not wait", async () => {
		const w = (await findOrCreateUser(db, { provider: "github", subject: "6004" })).id;
		for (const m of ["kcal", "protein_g", "fat_g", "carbs_g", "fiber_g", "sugar_g", "added_sugar_g", "sodium_mg", "water_ml"] as const) await setDailyTargetMetricsView(db, w, { [m]: { target: 100 } });
		await expect(getReport(db, w, { granularity: "week" })).rejects.toMatchObject({ code: "validation_failed", field: "granularity", message: expect.stringContaining("you must log food or water for at least 7 days") });
		const food = await createFood(db, w, A);
		const today = localDate(new Date(), "America/New_York");
		await logFood(db, w, { meal_type: "lunch", food_id: food.id, grams: 100, date: addDays(today, -6) });
		await expect(getReport(db, w, { granularity: "week" })).rejects.toMatchObject({ message: expect.stringContaining(`opens on ${addDays(today, 1)}`) });
		await getReport(db, w, { granularity: "day" });
		await logFood(db, w, { meal_type: "lunch", food_id: food.id, grams: 100, date: addDays(today, -7) });
		await getReport(db, w, { granularity: "week" });
		await expect(getReport(db, w, { granularity: "month" })).rejects.toMatchObject({ field: "granularity", message: expect.stringContaining(`at least 30 days`) });
		await logFood(db, w, { meal_type: "lunch", food_id: food.id, grams: 100, date: addDays(today, -30) });
		await getReport(db, w, { granularity: "month" });
	});

	it("has no setup block, and shows nothing of another user's data", async () => {
		expect(await getReport(db, u, { granularity: "day", end_date: END })).not.toHaveProperty("setup");
		for (const m of ["protein_g", "fat_g", "carbs_g", "fiber_g", "sugar_g", "added_sugar_g", "sodium_mg", "water_ml"] as const) await setDailyTargetMetricsView(db, other, { [m]: { target: 100 } });
		await expect(getReport(db, other, { granularity: "day", end_date: END })).rejects.toMatchObject({ code: "validation_failed", message: expect.stringContaining("Nothing has been logged yet") }); // none of u's data shows
	});

	it("a window with nothing in it is an error that says where the data starts", async () => {
		const early = await getReport(db, u, { granularity: "day", end_date: "2025-01-01" }).catch((e) => e);
		expect(early).toMatchObject({ code: "validation_failed", field: "end_date" });
		expect(early.message).toContain("No food, water or workouts logged between 2024-12-26 and 2025-01-01");
		expect(early.message).toContain("first log is on 2026-03-12: try an end_date on or after 2026-03-12");
		const gap = await getReport(db, u, { granularity: "day", end_date: "2026-03-30" }).catch((e) => e);
		expect(gap.message).toContain("try an end_date on a day they logged");
	});

	it("planned and archived logs are left out of the report", async () => {
		const rows = (await getReport(db, u, { granularity: "day", end_date: END })).data.rows as any[];
		const day14 = rows.find((r) => r.period_start === "2026-03-14");
		expect(day14).toMatchObject({ entries: 0, days_with_data: 0, kcal_total: 0 }); // one planned and one archived log that day
	});
});
