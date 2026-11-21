import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { createFood, findOrCreateUser } from "../src/data";
import { getDay } from "../src/services/logs";
import { updateSettings } from "../src/services/settings";
import { archiveDailyTargetMetricView, getDailyTargetMetricsView, setDailyTargetMetricsView } from "../src/services/dailyTargetMetrics";
import { logFood, REST } from "./helpers";

const db = env.DB;
let a: string, b: string;

beforeAll(async () => {
	a = (await findOrCreateUser(db, { provider: "github", subject: "5001" })).id;
	b = (await findOrCreateUser(db, { provider: "github", subject: "5002" })).id;
});

describe("update_settings", () => {
	it("sets the time zone, rejects a bad one, and only changes that user", async () => {
		await expect(updateSettings(db, a, { time_zone: "Mars/Olympus" })).rejects.toMatchObject({ code: "validation_failed" });
		expect((await updateSettings(db, a, { time_zone: "Asia/Tokyo" })).time_zone).toBe("Asia/Tokyo");
		await setDailyTargetMetricsView(db, b, { kcal: { target: 1800 } });
		expect((await updateSettings(db, b, { time_zone: "America/New_York" })).time_zone).toBe("America/New_York");
	});

	it("needs a time zone", async () => {
		await expect(updateSettings(db, a, {})).rejects.toMatchObject({ code: "validation_failed" });
	});
});

describe("get, set and archive daily target metrics", () => {
	it("starts empty, with setup incomplete and every target named as missing", async () => {
		const r = await getDailyTargetMetricsView(db, a);
		expect(Object.values(r.data.targets).every((t) => t === null)).toBe(true);
		expect(r.setup).toMatchObject({ setup_complete: false });
		expect((r.setup as { missing: string[] }).missing).toContain("added_sugar_g_target");
	});

	it("saves with default direction and tolerance, flags the default, and merges what is not sent", async () => {
		await setDailyTargetMetricsView(db, a, { kcal: { target: 2000 }, protein_g: { target: 150 }, added_sugar_g: { target: 25 } });
		const r = await setDailyTargetMetricsView(db, a, { protein_g: { target: 160, tolerance_pct: 5 } });
		expect(r.data.targets.kcal).toEqual({ target: 2000, tolerance_pct: 10, tolerance_is_default: true, direction: "around" });
		expect(r.data.targets.protein_g).toEqual({ target: 160, tolerance_pct: 5, tolerance_is_default: false, direction: "at_least" });
		expect(r.data.targets.added_sugar_g).toMatchObject({ direction: "at_most" });
		expect(r.data.targets.fiber_g).toBeNull();
	});

	it("retrying is harmless, and an explicit direction sticks", async () => {
		const again = await setDailyTargetMetricsView(db, a, { protein_g: { target: 160, tolerance_pct: 5 } });
		expect(again.data.targets.protein_g).toMatchObject({ target: 160, tolerance_pct: 5 });
		const r = await setDailyTargetMetricsView(db, a, { kcal: { direction: "at_most" } });
		expect(r.data.targets.kcal).toMatchObject({ target: 2000, direction: "at_most" });
	});

	it("validates: a new metric needs a target, a target above zero, a tolerance from 0 to 100", async () => {
		await expect(setDailyTargetMetricsView(db, a, { fiber_g: { direction: "at_least" } })).rejects.toMatchObject({ code: "validation_failed" });
		await expect(setDailyTargetMetricsView(db, a, { fiber_g: { target: 0 } })).rejects.toMatchObject({ code: "validation_failed" });
		await expect(setDailyTargetMetricsView(db, a, { fiber_g: { target: 30, tolerance_pct: 101 } })).rejects.toMatchObject({ code: "validation_failed" });
		await expect(setDailyTargetMetricsView(db, a, {})).rejects.toMatchObject({ code: "validation_failed" });
		expect((await getDailyTargetMetricsView(db, a)).data.targets.fiber_g).toBeNull(); // nothing from a failed call was saved
	});

	it("targets show up in get_day as remaining, archiving one removes it, and another user is untouched", async () => {
		const food = await createFood(db, a, { name: "Test food", kcal: 100, protein_g: 10, fat_g: 0, carbs_g: 0, ...REST, source: "label" });
		await logFood(db, a, { meal_type: "lunch", food_id: food.id, grams: 200 });
		const day = await getDay(db, a);
		expect(day.totals.remaining.protein_g).toBe(140);
		expect(day.totals.targets.protein_g).toBe(160);

		const r = await archiveDailyTargetMetricView(db, a, "kcal");
		expect(r.data).toMatchObject({ metric: "kcal", archived: true });
		expect(r.data.targets.kcal).toBeNull();
		expect((await getDailyTargetMetricsView(db, b)).data.targets.kcal).toMatchObject({ target: 1800 });
	});

	it("an archived metric is kept, not deleted; archiving twice is not an error; setting it again brings it back", async () => {
		const d = (await findOrCreateUser(db, { provider: "github", subject: "5003" })).id;
		await setDailyTargetMetricsView(db, d, { sodium_mg: { target: 2300, tolerance_pct: 5 } });
		expect((await archiveDailyTargetMetricView(db, d, "sodium_mg")).data.archived).toBe(true);
		const row = await db.prepare("SELECT archived_at FROM daily_target_metrics WHERE user_id = ? AND metric = 'sodium_mg'").bind(d).first<{ archived_at: string | null }>();
		expect(row?.archived_at).not.toBeNull(); // the row is still there
		expect((await archiveDailyTargetMetricView(db, d, "sodium_mg")).data.archived).toBe(false);
		expect((await archiveDailyTargetMetricView(db, d, "fiber_g")).data.archived).toBe(false); // never set
		expect((await getDailyTargetMetricsView(db, d)).setup).toMatchObject({ setup_complete: false });
		const back = await setDailyTargetMetricsView(db, d, { sodium_mg: { target: 2000 } });
		expect(back.data.targets.sodium_mg).toMatchObject({ target: 2000, direction: "at_most" });
		expect(((await db.prepare("SELECT archived_at FROM daily_target_metrics WHERE user_id = ? AND metric = 'sodium_mg'").bind(d).first<{ archived_at: string | null }>()))?.archived_at).toBeNull();
	});

	it("workout_kcal_burned is optional: setup never lists it as missing, and it defaults to at_least", async () => {
		const c = (await findOrCreateUser(db, { provider: "github", subject: "3099" })).id;
		expect((await getDailyTargetMetricsView(db, c)).setup).not.toMatchObject({ missing: expect.arrayContaining(["workout_kcal_burned_target"]) });
		const r = await setDailyTargetMetricsView(db, c, { workout_kcal_burned: { target: 400 } });
		expect(r.data.targets.workout_kcal_burned).toMatchObject({ target: 400, direction: "at_least", tolerance_pct: 10 });
	});

	it("a complete set reports just setup_complete true", async () => {
		const all = Object.fromEntries(["kcal", "protein_g", "fat_g", "carbs_g", "fiber_g", "sugar_g", "added_sugar_g", "sodium_mg", "water_ml"].map((m) => [m, { target: 10 }]));
		expect((await setDailyTargetMetricsView(db, b, all)).setup).toEqual({ setup_complete: true });
	});
});
