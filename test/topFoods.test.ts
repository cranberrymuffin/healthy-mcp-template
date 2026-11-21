import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { createFood, findOrCreateUser } from "../src/data";
import { logEntries } from "../src/services/logs";
import { getTopFoods } from "../src/services/topFoods";
import { logFood, REST } from "./helpers";

const db = env.DB;
const END = "2026-03-15"; // a Sunday, well in the past

describe("get_top_foods", () => {
	let u: string, other: string;
	const A = { name: "Food A", kcal: 100, protein_g: 10, fat_g: 5, carbs_g: 10, ...REST, sugar_g: 8, added_sugar_g: 4, sodium_mg: 100, source: "label" as const };

	beforeAll(async () => {
		u = (await findOrCreateUser(db, { provider: "github", subject: "7001" })).id;
		other = (await findOrCreateUser(db, { provider: "github", subject: "7002" })).id;
		const x = await createFood(db, u, { ...A, name: "X", kcal: 100, protein_g: 5, sodium_mg: 10 });
		const y = await createFood(db, u, { ...A, name: "Y", kcal: 50, protein_g: 20, sodium_mg: 500 });
		await logFood(db, u, { meal_type: "lunch", food_id: x.id, grams: 100, date: "2026-03-10" });
		await logFood(db, u, { meal_type: "lunch", food_id: x.id, grams: 100, date: "2026-03-11" });
		await logFood(db, u, { meal_type: "dinner", food_id: y.id, grams: 100, date: "2026-03-11" });
		await logEntries(db, u, { client_request_id: crypto.randomUUID(), water_ml: 500, date: "2026-03-11" }); // water is never a top food
		await logFood(db, u, { meal_type: "snack", food_id: y.id, grams: 100, date: "2026-03-12", eaten: false }); // planned: not counted
		await logFood(db, other, { meal_type: "lunch", food_id: (await createFood(db, other, { ...A, name: "Theirs" })).id, grams: 100, date: "2026-03-11" });
	});

	const names = async (rank_by: any, extra: Record<string, unknown> = {}) =>
		((await getTopFoods(db, u, { granularity: "day", end_date: END, rank_by, ...extra })).data.foods as any[]).map((f) => f.food);

	it("ranks by the chosen metric, with totals computed by the server", async () => {
		expect(await names("kcal")).toEqual(["X", "Y"]); // 200 vs 50
		expect(await names("protein_g")).toEqual(["Y", "X"]); // 20 vs 10
		expect(await names("sodium_mg")).toEqual(["Y", "X"]); // 500 vs 20
		expect(await names("days_eaten")).toEqual(["X", "Y"]); // 2 days vs 1
		expect(await names("entries")).toEqual(["X", "Y"]);
		const r = await getTopFoods(db, u, { granularity: "day", end_date: END, rank_by: "kcal" });
		expect(r.covered).toEqual({ granularity: "day", period_start: "2026-03-09", period_end: END, rank_by: "kcal", meal_type: null });
		expect((r.data.foods as any[])[0]).toMatchObject({ rank: 1, food: "X", value: 200, share_pct: 80, days_eaten: 2, entries: 2, grams_total: 200, protein_g_total: 10, sodium_mg_total: 20 });
		expect((r.data.foods as any[])[1]).toMatchObject({ rank: 2, food: "Y", value: 50, share_pct: 20 });
		expect(r.data.window_total).toBe(250);
		expect(r.data.everything_else).toBeNull();
	});

	it("days_eaten has no shares (days overlap between foods)", async () => {
		const r = await getTopFoods(db, u, { granularity: "day", end_date: END, rank_by: "days_eaten" });
		expect((r.data.foods as any[]).map((f) => [f.value, f.share_pct])).toEqual([[2, null], [1, null]]);
		expect(r.data.window_total).toBeNull();
	});

	it("limit cuts the list and the rest becomes everything_else, so shares add up to 100", async () => {
		const r = await getTopFoods(db, u, { granularity: "day", end_date: END, rank_by: "kcal", limit: 1 });
		expect(r.data.foods).toHaveLength(1);
		expect(r.data.everything_else).toEqual({ foods: 1, value: 50, share_pct: 20 });
		expect((r.data.foods as any[])[0].share_pct + (r.data.everything_else as any).share_pct).toBe(100);
		expect(r.data.foods_in_window).toBe(2);
	});

	it("meal_type limits the foods, and the window is the report's window", async () => {
		expect(await names("kcal", { meal_type: "dinner" })).toEqual(["Y"]);
		const w = await getTopFoods(db, u, { granularity: "week", end_date: END, rank_by: "kcal" });
		expect(w.covered).toMatchObject({ period_start: "2026-01-19", period_end: END });
	});

	it("nothing in the window is an error that says where the data starts; another user's foods never show", async () => {
		await expect(getTopFoods(db, u, { granularity: "day", end_date: "2025-01-01", rank_by: "kcal" })).rejects.toMatchObject({ code: "validation_failed", message: expect.stringContaining("first log is on 2026-03-10") });
		await expect(getTopFoods(db, u, { granularity: "day", end_date: END, rank_by: "kcal", meal_type: "breakfast" })).rejects.toMatchObject({ message: expect.stringContaining("No breakfast foods logged") });
		await expect(getTopFoods(db, u, { granularity: "day", end_date: "2026-03-30", rank_by: "kcal" })).rejects.toMatchObject({ message: expect.stringContaining("No foods logged between 2026-03-24 and 2026-03-30") });
		expect(await names("kcal")).not.toContain("Theirs");
		await expect(getTopFoods(db, await findOrCreateUser(db, { provider: "github", subject: "7003" }).then((x) => x.id), { granularity: "day", end_date: END, rank_by: "kcal" })).rejects.toMatchObject({ message: expect.stringContaining("Nothing has been logged yet") });
		await expect(getTopFoods(db, u, { granularity: "day", end_date: "2099-01-01", rank_by: "kcal" })).rejects.toMatchObject({ field: "end_date" });
	});
});
