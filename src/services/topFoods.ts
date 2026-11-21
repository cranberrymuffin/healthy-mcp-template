// get_top_foods: the foods that contribute most of one metric over the same window get_report uses. Read-only.
// SQL only groups (grams, entries, days per food); the nutrient math is here and in src/nutrition.ts.
import { listFoodTotalsInRange, type MealType, type UserId } from "../data";
import { round1, roundKcal, scale, shares, type Nutrients } from "../nutrition";
import { noDataError, reportWindow, type Granularity } from "./report";

export const RANK_BY = ["kcal", "protein_g", "fat_g", "carbs_g", "fiber_g", "sugar_g", "added_sugar_g", "sodium_mg", "days_eaten", "entries", "grams"] as const;
export type RankBy = (typeof RANK_BY)[number];
export const TOP_FOOD_MEALS = ["breakfast", "lunch", "dinner", "snack", "dessert"] as const satisfies readonly MealType[];
export const DEFAULT_LIMIT = 5;
export const MAX_LIMIT = 20;

export interface TopFoodsInput { granularity: Granularity; end_date?: string; rank_by: RankBy; limit?: number; meal_type?: (typeof TOP_FOOD_MEALS)[number] }

const round = (metric: RankBy, v: number) => (metric === "kcal" ? roundKcal(v) : round1(v));

export async function getTopFoods(db: D1Database, userId: UserId, input: TopFoodsInput) {
	const { rank_by: metric } = input;
	const limit = input.limit ?? DEFAULT_LIMIT;
	const { from, to } = await reportWindow(db, userId, input.granularity, input.end_date);
	const rows = await listFoodTotalsInRange(db, userId, from, to, input.meal_type);
	if (rows.length === 0) throw await noDataError(db, userId, input.meal_type ? `${input.meal_type} foods logged` : "foods logged", from, to);

	const foods = rows.map((r) => {
		const n: Nutrients = scale(r, r.grams);
		const value = metric === "days_eaten" ? r.days : metric === "entries" ? r.entries : metric === "grams" ? r.grams : n[metric];
		return { r, n, value };
	});
	foods.sort((a, b) => b.value - a.value || a.r.food_name.localeCompare(b.r.food_name));
	const top = foods.slice(0, limit);
	const rest = foods.slice(limit);

	// Shares add up to 100 for the metrics that add across foods. Days do not (two foods eaten on the same day), so days_eaten has none.
	const additive = metric !== "days_eaten";
	const restValue = rest.reduce((s, f) => s + f.value, 0);
	const pct = additive ? shares([...top.map((f) => f.value), restValue]) : [];
	const total = foods.reduce((s, f) => s + f.value, 0);

	return {
		covered: { granularity: input.granularity, period_start: from, period_end: to, rank_by: metric, meal_type: input.meal_type ?? null },
		data: {
			foods: top.map((f, i) => ({
				rank: i + 1, food: f.r.food_name, brand: f.r.brand, source: f.r.source, value: round(metric, f.value),
				share_pct: additive ? pct[i] : null, days_eaten: f.r.days, entries: f.r.entries, grams_total: round1(f.r.grams),
				kcal_total: roundKcal(f.n.kcal), protein_g_total: round1(f.n.protein_g), sugar_g_total: round1(f.n.sugar_g), sodium_mg_total: round1(f.n.sodium_mg),
			})),
			everything_else: rest.length > 0 && additive ? { foods: rest.length, value: round(metric, restValue), share_pct: pct[top.length] } : null,
			foods_in_window: foods.length,
			window_total: additive ? round(metric, total) : null,
		},
	};
}
