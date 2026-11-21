-- daily_target_metrics: one row per user and metric. A metric with no row has no target (it is "not tracked" in reports).
--   target         one number; above zero
--   tolerance_pct  percent either way, 0 to 100; null means "use the default" (10), and reports flag it as a default
--   direction      at_least, at_most or around: decides what counts as met
--   archived_at    set instead of deleting: an archived metric has no target and is left out of reports; setting it again brings it back
-- Replaces the one-row `targets` table, which is dropped below. Nothing is copied over, so targets are set again with set_daily_target_metrics.
CREATE TABLE daily_target_metrics (
  user_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  metric        TEXT NOT NULL CHECK (metric IN ('kcal','protein_g','fat_g','carbs_g','fiber_g','sugar_g','added_sugar_g','sodium_mg','water_ml','workout_kcal_burned')),
  target        REAL NOT NULL CHECK (target > 0),
  tolerance_pct REAL CHECK (tolerance_pct IS NULL OR (tolerance_pct >= 0 AND tolerance_pct <= 100)),
  direction     TEXT NOT NULL CHECK (direction IN ('at_least','at_most','around')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  archived_at   TEXT,
  PRIMARY KEY (user_id, metric)
);

DROP TABLE targets;
