import { TARGET_METRICS, type TargetMetric, type TargetSpec, type Targets } from "../nutrition";
import { now, type UserId } from "./types";

export type { Targets, TargetSpec } from "../nutrition";

interface TargetRow extends TargetSpec { metric: TargetMetric }

/** The user's active daily target metrics, or null if none are set. A metric that is missing (or archived) has no target. */
export async function getDailyTargetMetrics(db: D1Database, userId: UserId): Promise<Targets | null> {
	const rows = (await db.prepare("SELECT metric, target, tolerance_pct, direction FROM daily_target_metrics WHERE user_id = ? AND archived_at IS NULL").bind(userId).all<TargetRow>()).results;
	if (rows.length === 0) return null;
	return Object.fromEntries(rows.map((r) => [r.metric, { target: r.target, tolerance_pct: r.tolerance_pct, direction: r.direction }]));
}

/** What to save for each metric: a spec replaces the row (and brings back an archived one). Metrics not listed keep their value. */
export type DailyTargetMetricChanges = Partial<Record<TargetMetric, TargetSpec>>;

/** Saves the changes together. Saving the same thing again changes nothing. Returns the active targets as they are now. */
export async function setDailyTargetMetrics(db: D1Database, userId: UserId, changes: DailyTargetMetricChanges): Promise<Targets | null> {
	const ts = now();
	const statements = TARGET_METRICS.filter((m) => changes[m] !== undefined).map((m) => {
		const c = changes[m]!;
		return db
			.prepare(
				`INSERT INTO daily_target_metrics (user_id, metric, target, tolerance_pct, direction, updated_at) VALUES (?, ?, ?, ?, ?, ?)
				 ON CONFLICT (user_id, metric) DO UPDATE SET target = excluded.target, tolerance_pct = excluded.tolerance_pct, direction = excluded.direction, updated_at = excluded.updated_at, archived_at = NULL`,
			)
			.bind(userId, m, c.target, c.tolerance_pct, c.direction, ts);
	});
	if (statements.length > 0) await db.batch(statements);
	return getDailyTargetMetrics(db, userId);
}

/** Archives one metric (it is kept, but has no target and is left out of reports). False if it was not set or already archived. */
export async function archiveDailyTargetMetric(db: D1Database, userId: UserId, metric: TargetMetric): Promise<boolean> {
	const ts = now();
	const r = await db.prepare("UPDATE daily_target_metrics SET archived_at = ?, updated_at = ? WHERE user_id = ? AND metric = ? AND archived_at IS NULL").bind(ts, ts, userId, metric).run();
	return (r.meta.changes ?? 0) > 0;
}
