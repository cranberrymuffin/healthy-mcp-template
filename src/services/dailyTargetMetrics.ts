// get_daily_target_metrics, set_daily_target_metrics and archive_daily_target_metric, and the setup block that the target tools carry.
import { archiveDailyTargetMetric as dbArchiveDailyTargetMetric, getDailyTargetMetrics, setDailyTargetMetrics as dbSetDailyTargetMetrics, type DailyTargetMetricChanges, type UserId } from "../data";
import { DEFAULT_DIRECTION, DEFAULT_TOLERANCE_PCT, OPTIONAL_METRICS, TARGET_METRICS, type Direction, type TargetMetric, type Targets } from "../nutrition";
import { fail } from "./common";

/** What the caller may send for one metric. Fields not sent keep their value; a metric with no target yet needs `target`. */
export interface TargetInput { target?: number; tolerance_pct?: number | null; direction?: Direction }
export type SetDailyTargetMetricsInput = Partial<Record<TargetMetric, TargetInput>>;

/** The required targets that are not set yet, as `<metric>_target`. The server never guesses a target. */
export function missingTargets(targets: Targets | null): string[] {
	return TARGET_METRICS.filter((m) => !OPTIONAL_METRICS.includes(m) && targets?.[m] === undefined).map((m) => `${m}_target`);
}

/**
 * Tells the model what is missing so it can ask once. Always present on the target tools; with every target set it is just { setup_complete: true }.
 */
export function setupBlock(targets: Targets | null) {
	const missing = missingTargets(targets);
	if (missing.length === 0) return { setup_complete: true as const };
	return {
		setup_complete: false as const,
		missing,
		instruction: "After answering, ask the user once for the missing items (say what they gain: the report says more with targets), then save them with set_daily_target_metrics. Never invent a value.",
	};
}

/** Every metric with its target, tolerance, direction and whether the tolerance is the default; null where nothing is set. */
export async function getDailyTargetMetricsView(db: D1Database, userId: UserId) {
	const targets = await getDailyTargetMetrics(db, userId);
	const view = Object.fromEntries(
		TARGET_METRICS.map((m) => {
			const t = targets?.[m];
			return [m, t ? { target: t.target, tolerance_pct: t.tolerance_pct ?? DEFAULT_TOLERANCE_PCT, tolerance_is_default: t.tolerance_pct == null, direction: t.direction } : null];
		}),
	);
	return { data: { targets: view }, setup: setupBlock(targets) };
}

/** Changes only the metrics sent. Validated here; saving the same thing again is harmless. To stop tracking a metric, archive it. */
export async function setDailyTargetMetricsView(db: D1Database, userId: UserId, input: SetDailyTargetMetricsInput) {
	const metrics = TARGET_METRICS.filter((m) => m in input);
	if (metrics.length === 0) throw fail(`Send at least one target. Metrics: ${TARGET_METRICS.join(", ")}.`, "targets");
	const prev = (await getDailyTargetMetrics(db, userId)) ?? {};
	const changes: DailyTargetMetricChanges = {};
	for (const m of metrics) {
		const c = input[m]!;
		const target = c.target ?? prev[m]?.target;
		if (target === undefined) throw fail(`${m} has no target yet, so send target (a number above 0).`, `${m}.target`);
		if (!(target > 0)) throw fail(`${m}.target must be above 0. To stop tracking a metric, use archive_daily_target_metric.`, `${m}.target`);
		const tolerance = c.tolerance_pct !== undefined ? c.tolerance_pct : (prev[m]?.tolerance_pct ?? null);
		if (tolerance !== null && !(tolerance >= 0 && tolerance <= 100)) throw fail(`${m}.tolerance_pct must be from 0 to 100.`, `${m}.tolerance_pct`);
		changes[m] = { target, tolerance_pct: tolerance, direction: c.direction ?? prev[m]?.direction ?? DEFAULT_DIRECTION[m] };
	}
	await dbSetDailyTargetMetrics(db, userId, changes);
	return getDailyTargetMetricsView(db, userId);
}

/** Archives one metric: it is kept but has no target until it is set again. Archiving one that is not set is not an error. */
export async function archiveDailyTargetMetricView(db: D1Database, userId: UserId, metric: TargetMetric) {
	const archived = await dbArchiveDailyTargetMetric(db, userId, metric);
	const v = await getDailyTargetMetricsView(db, userId);
	return { data: { metric, archived, ...v.data }, setup: v.setup };
}
