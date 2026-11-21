// Read-only range queries for get_report. Logs come back with their food's per-100g values; the math is in src/nutrition.ts.
import { NUTRIENT_KEYS, type NutrientValues } from "../nutrition";
import type { MealType, UserId } from "./types";
import type { Workout } from "./workouts";

export interface RangeLogRow extends NutrientValues {
	id: string;
	date: string;
	meal_type: MealType;
	food_id: string;
	grams: number;
	note: string | null;
	eaten_at: string;
	food_name: string;
	brand: string | null;
	source: string;
}

const SELECT = `SELECT l.id, l.date, l.meal_type, l.food_id, l.grams, l.note, l.eaten_at,
	       f.name AS food_name, f.brand, f.source, ${NUTRIENT_KEYS.map((k) => `f.${k}`).join(", ")}
	FROM food_logs l JOIN foods f ON f.id = l.food_id AND f.user_id = l.user_id
	WHERE l.user_id = ? AND l.date >= ? AND l.date <= ? AND l.archived_at IS NULL AND l.eaten = 1`;

/** Every eaten, active food log (water included) from `from` to `to`, both days included, oldest first. */
export async function listEatenLogsInRange(db: D1Database, userId: UserId, from: string, to: string): Promise<RangeLogRow[]> {
	return (await db.prepare(`${SELECT} ORDER BY l.eaten_at, l.created_at, l.id`).bind(userId, from, to).all<RangeLogRow>()).results;
}

/** The local date of the user's first eaten, active food log (water included), or null when there is none. Stops at the first match. */
export async function firstLogDate(db: D1Database, userId: UserId): Promise<string | null> {
	return (await db.prepare("SELECT date FROM food_logs WHERE user_id = ? AND archived_at IS NULL AND eaten = 1 ORDER BY date LIMIT 1").bind(userId).first<{ date: string }>())?.date ?? null;
}

/** One row per food eaten in the range (water left out, optionally one meal type): its per-100g values and the grams, entries and days summed over the range. */
export interface FoodTotalsRow extends NutrientValues {
	food_id: string;
	food_name: string;
	brand: string | null;
	source: string;
	grams: number;
	entries: number;
	days: number;
}

export async function listFoodTotalsInRange(db: D1Database, userId: UserId, from: string, to: string, mealType?: MealType): Promise<FoodTotalsRow[]> {
	const meal = mealType ? "AND l.meal_type = ?" : "";
	return (
		await db
			.prepare(
				`SELECT l.food_id, f.name AS food_name, f.brand, f.source, ${NUTRIENT_KEYS.map((k) => `f.${k}`).join(", ")},
				        SUM(l.grams) AS grams, COUNT(*) AS entries, COUNT(DISTINCT l.date) AS days
				 FROM food_logs l JOIN foods f ON f.id = l.food_id AND f.user_id = l.user_id
				 WHERE l.user_id = ? AND l.date >= ? AND l.date <= ? AND l.archived_at IS NULL AND l.eaten = 1 AND l.meal_type != 'water' ${meal}
				 GROUP BY l.food_id`,
			)
			.bind(...[userId, from, to, ...(mealType ? [mealType] : [])])
			.all<FoodTotalsRow>()
	).results;
}

export async function listWorkoutsInRange(db: D1Database, userId: UserId, from: string, to: string): Promise<Workout[]> {
	return (await db.prepare("SELECT * FROM workouts WHERE user_id = ? AND date >= ? AND date <= ? AND archived_at IS NULL ORDER BY date, created_at").bind(userId, from, to).all<Workout>()).results;
}
