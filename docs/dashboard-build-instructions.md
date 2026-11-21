# Food Dashboard: Build Instructions

**Before you start building, tell the user three things in a short message** (then build, unless they ask to wait):
- **What they get:** a reusable dashboard of their healthy data. When the page can call the tools it updates itself each time it is opened (the first time, they are asked to allow the healthy connector).
- **How long it takes:** the model matters. Roughly 3 minutes with Haiku or Sonnet, and about 18 minutes with Opus. Sonnet's quality is fine for this.
- **Choosing the model:** if they care about speed or quality, they should pick the model before building, since you cannot switch it yourself. Do not ask more than this once.

**Always build this as an artifact when your client can create one** (an artifact, canvas, preview or standalone page: whatever your client renders), not as text, a table or a code block in the chat. **Always include two sections: the Day explorer (what I ate each day, one click per day) and Curious things in your numbers.** Pick the other sections to fit what the user asked for and leave out the rest. A bare request for a "report", "overview", "summary", "scorecard" or "progress page" means a page, not a text answer.

The artifact calls the tools itself, so it shows live data with each reader's own access. If your client cannot render a page, give one self-contained HTML file instead. To make it live:
- **Declare** the read tools when you publish: `capabilities: {mcp: {servers: [{server: "healthy", tools: ["get_report", "get_top_foods", "get_day", "get_daily_target_metrics"]}]}}` (`server` is the connector's display name in your client).
- **Call** them from the page: `const mcp = await claude.use("mcp")` (show a short message if it is `null`), `mcp.watchTool("healthy", tool, input, (ev) => ...)` for data that stays on screen (`ev.result.payload`, add `{ refetchInterval: 300000 }` to refresh), and `(await mcp.callTool("healthy", tool, input)).payload` for clicks. Handle each failure in its own section by `error.code`; a `tool_error` message is how the `get_report` refusals arrive.

Everything here is built from the **healthy** connector. The one rule that always applies: every number comes from the server. Never add up nutrients yourself. The page only picks, filters and reshapes what the tools return. Tool replies may carry a `next_step` note for the assistant: the page ignores it.

If the user does not say what they want, a good starting set is: the headline sentence, the six tiles, the Day explorer, "Day by day", "Where the calories came from" and Curious things in your numbers.

## 1. The tools: what each gives you

Each is a live call, so every reader runs it with their own access. Nested objects can arrive as JSON text: parse strings before reading them.

### Response shapes (read these first)

{{RESPONSE_SHAPES}}

Lists to chart: `get_report` → `data.rows`; `get_top_foods` → `data.foods`; `get_day` → `food_logs` and `workouts`. Turn `targets` into a list yourself (one row per metric).

### `get_report`: rows over a period, with trend and adherence

**Arguments:** `granularity` (`day`, `week` or `month`) and optional `end_date` (YYYY-MM-DD, not after today, default today). The window is fixed by the granularity and ends with the day, week or month that holds `end_date`:

| granularity | Window | One row per |
| --- | --- | --- |
| `day` | the last 7 days | day |
| `week` | the last 8 weeks (Monday to Sunday) | week |
| `month` | the last 6 calendar months | month |

To see further back, call again with a different `end_date` or granularity.

**What comes back**
- `covered`: `granularity`, `period_start`, `period_end`.
- `data.rows`, oldest first. Fields: `period_start`, `period_end`, `in_progress`, `days_with_data`, `kcal_total`, `kcal_from_protein/fat/carbs`, `protein_g`, `fat_g`, `carbs_g`, `fiber_g`, `sugar_g`, `added_sugar_g`, `sodium_mg`, `water_ml`, `entries`, `estimated_entries`, `workouts`, `workout_minutes`, `workout_kcal_burned`.
- Day rows also carry `time_buckets` (kcal and sugar by early\_morning, late\_morning, afternoon, evening, night) and `top_sugar_sources`.
- Week and month rows also carry `daily_avg` (the same nutrients as daily averages over days with data).
- `data.summary`: `trend` (change between the first and second half of the completed days), `adherence` (per target: days met and missed, streaks), `meal_types`, `workout_types` and `text` (one sentence to quote).

**Shaping it (reshape only, no math)**
- **Day report:** use the rows, and attach `summary.trend` to every row.
- **Week report:** lift `daily_avg` into columns named `avg_kcal`, `avg_protein_g`, `avg_fat_g`, `avg_carbs_g`, `avg_fiber_g`, `avg_sugar_g`, `avg_added_sugar_g`, `avg_sodium_mg`, `avg_water_ml`, and attach `meal_types` and `workout_types` to each row.

**When it refuses** (an error result, not a report; handle each before building anything)
- **Targets missing:** the error names the required daily targets that are not set (for example `kcal_target, protein_g_target`). Ask the user once for the values (say what they gain), save them with `set_daily_target_metrics`, then call again. Never invent a value. Only `workout_kcal_burned` is optional.
- **Not enough history:** the week report fails until 7 days after the user's first log, and the month report until 30. The error gives the date it opens. Tell the user to keep logging, and build only from the day report until then.
- **Nothing in the window:** the error says where the user's data starts. Try an `end_date` on or after the first log.

### `get_top_foods`: which foods contribute most of one metric

**Arguments:** `granularity` and optional `end_date` (the same windows as `get_report`), `rank_by` (`kcal`, `protein_g`, `fat_g`, `carbs_g`, `fiber_g`, `sugar_g`, `added_sugar_g`, `sodium_mg`, `days_eaten`, `entries` or `grams`), optional `limit` (1 to 20, default 5) and optional `meal_type` (`breakfast`, `lunch`, `dinner`, `snack`, `dessert`). Water is always left out. No targets are needed.

**What comes back**
- `covered`: the window, `rank_by` and `meal_type`.
- `data.foods`: ranked rows with `rank`, `food`, `brand`, `source`, `value` (the total for the ranked metric), `share_pct`, `days_eaten`, `entries`, `grams_total`, `kcal_total`, `protein_g_total`, `sugar_g_total`, `sodium_mg_total`.
- `data.everything_else` (when there are more foods than `limit`): `foods`, `value`, `share_pct`. The shares and this row add up to 100.
- `data.foods_in_window` and `data.window_total`. `days_eaten` has no shares or total, because days overlap between foods.

**Shaping it:** use the foods as rows. Tidy ALL-CAPS names to title case. Call it once per ranking and window the page shows. If nothing was logged in the window it fails and says where the data starts.

### `get_day`: one day in full

**Arguments:** `date` (YYYY-MM-DD). **Returns** the day's total with its targets, every food and water entry (with meal type, grams, nutrients and the local time eaten; planned items have `eaten: false`) and every workout (duration, intensity, kcal burned).

**Shaping it:** first row is the day total with targets, then one row per food or water entry, then one per workout. `date` must match `YYYY-MM-DD`.

### `get_daily_target_metrics`: the saved targets

**Arguments:** none. **Returns** one entry per metric with `target`, `tolerance_pct` and `direction` (`at_least`, `at_most` or `around`), or null where nothing is set.

**Shaping it:** one row per metric: `metric`, `target`, `direction`, `tolerance_pct`. Skip the null ones.

## 2. Rules that apply everywhere

- **Full day** means `in_progress` is false and `entries > 0`. Averages, peaks and shares use full days only. Today still appears in charts, drawn faded and labeled "so far".
- **Target band**: `at_most` allows 0 to target×(1+tol). `at_least` allows target×(1−tol) and up. `around` allows target±tol. Default tolerance is 10%. A metric with no saved target (only `workout_kcal_burned` is optional) falls back to relative shading.
- Any number the page derives (a share, an average, a peak) is declared as a named calculation over the sources, not computed inline.
- Mark every displayed value with its source (the tool and the field) so readers can trace it.
- Show "—" for missing values, and a short "didn't load" message on an error.
- Charts size from container width, so they work from 400px to full width. Each chart has a hover tooltip.

## 3. Building blocks (the Day explorer and Curious things are always included; the rest are optional)

Each says what it shows and what it is built from. Use any subset of the others. The sources below are `daily` = `get_report` with `granularity: day`, `weekly` = `get_report` with `granularity: week`, `targets`, `day` (from `get_day`), and `get_top_foods` (one call per ranking and window).

### Headline sentence

**Shows:** the number of full days, average calories, average protein and the percent of calories eaten in the evening or at night. **Built from:** `daily` through the `avg7` calc (mean of full-day `kcal_total` and `protein_g`, rounded), and the `facts` calc for the late percent.

### Six tiles: Calories, Protein, Fiber, Added sugar, Sodium, Water

**Shows:** the average per full day, plus a "second half vs first" change with an arrow. **Built from:** `avg7` for the value. The change comes from the report's own `summary.trend` (calc `trend`: metric, direction, change\_pct). Match metrics `kcal`, `protein_g`, `fiber_g`, `added_sugar_g`, `sodium_mg`, `water_ml`. **Arrow color:** green when the move is in the healthy direction (up for protein, fiber, water; down for added sugar and sodium). Grey for calories.

### Day explorer

**Shows:** a row of 7 day buttons with step arrows, a date picker, the day's total, tiles, a water-cups meter and the list of entries. **Built from:** `day`, filtered by `day`. Default to today, allow back to 365 days.

- Tiles: calories, protein, carbs, fat, fiber, sugar, added sugar, sodium, water, exercise. Each has a target and progress bar when a target exists. Bars turn red when a limit is exceeded and green when a minimum is met.
- Water cups: a calc `day_cups` converts ml to US cups (236.588 ml each). Draw one circle per cup, filled by fraction.
- Entry list: group by meal type (breakfast, lunch, dinner, snack, dessert, water, exercise), sorted by time. Show name, grams, protein, carbs, fat, kcal. Planned items (`eaten: false`) are dimmed with a "planned" tag. Workouts show duration, intensity and kcal burned.

### Day by day (bar chart)

**Shows:** one bar per day, with a row of clickable buttons to choose the nutrient (not a dropdown): calories, protein, fat, carbs, fiber, sugar, added sugar, sodium, water. One button is active at a time, and the chart redraws when you click another. **Built from:** `daily`, plus calc `stack` for calories. Calories are a stacked bar of protein, fat and carb kcal, each scaled by `kcal_total / (sum of the three)` so the parts add up to the day total. **Target line:** a dashed line at the saved target for the chosen nutrient, if one exists.

### Every day at a glance (heat grid)

**Shows:** a grid, one row per nutrient and one column per day. **Built from:** `daily` and `targets`.

- With a target: cell is green with ✓ in range, red with ▲ above, blue with ▼ below.
- Without: shade by where the value falls between that nutrient's own min and max.
- Show a note and legend that switch based on whether any target is saved.

### Where the calories came from

**Shows:** one stacked horizontal bar per day plus an average row, with protein / fat / carb percentages. **Built from:** calc `shares`: each day's macro kcal divided by their sum. The average row sums the macro kcal across full days first, then takes percentages.

### When the calories land

**Shows:** five columns (early morning, late morning, afternoon, evening, night) with kcal and sugar grams. **Built from:** calc `clock`: sum each bucket's `kcal` and `sugar_g` from `time_buckets` across full days. Bar height is relative to the largest bucket. `share_pct` is the bucket's share of the total.

### Your top foods

**Shows:** the top five foods, with two rows of clickable buttons (not dropdowns), one button active in each row:
- **Window:** "Last 7 days" (`granularity: day`) and "Last 8 weeks" (`granularity: week`).
- **Ranking:** "By days eaten" (`rank_by: days_eaten`, `value` is days), "By sodium" (`sodium_mg`, `value` is mg), "By added sugar" (`added_sugar_g`), "By fiber" (`fiber_g`) and "By sugar" (`sugar_g`), with `value` in grams for the last three.

**Built from:** `get_top_foods` with the active window and ranking, so every click is one call. Drop the `everything_else` row. Any other metric (protein, sugar, calories) is just another `rank_by` if the user asks for it.

### Which meal carries the day

**Shows:** average daily kcal per meal type with its share of calories. **Built from:** calc `meals`, which reads `summary.meal_types` from `weekly` (`daily_avg_kcal`, `share_of_kcal_pct`).

### The biggest sugar hits

**Shows:** the eight largest single sugar sources over the 7 days. **Built from:** calc `sugar_hits`: flatten every day's `top_sugar_sources` from `daily`, sort by `sugar_g` descending, keep eight. Tooltip shows date, time and grams.

### Curious things in your numbers

**Shows:** a grid of short insight cards. Each card hides itself when its data is missing. **Built from:** one calc `facts`, which returns a single row with these fields:

- `snack_pct`, `snack_kcal` (snack row of `meals`)
- `late_pct` (evening plus night share of `clock`)
- Peaks and lows over full days: sodium peak, sugar peak (with added sugar), protein high and low, calorie high and low, water high, days with zero water
- `fiber_target` and `fiber_days`: full days at or above the fiber target (only if a target exists)
- `food_name`, `food_days`: the food eaten on the most days (from `get_top_foods` with `rank_by: days_eaten`)
- `wend_kcal`, `wday_kcal`: weekend and weekday average calories (only if both exist)
- `window_bucket`, `window_pct`: the busiest time-of-day window
- `est_pct`: estimated entries as a percent of all entries on full days
- `hit_food`, `hit_g`, `hit_day`: the top item from `sugar_hits`
- `meal_name`, `meal_kcal`: the biggest meal type excluding snack and dessert

**Colors.** Give each card one tone and use it the same way as the rest of the page: **green** = good (a target met, a streak, fiber days), **red** = over a limit (the sodium peak or sugar peak above its target, a high-calorie day over target), **amber** = worth a look (late eating, snack share, estimated entries), **blue** = below a minimum, **neutral gray** = just a fact (favorite food, weekday vs weekend, busiest window). If the metric has no target, use neutral, not red or green. Apply the tone to a thin accent bar on the card's left edge and to its big number, on a card background that stays plain, and keep the label text in the normal text color. Never rely on color alone: put a small ✓, ▲, ▼ or • in front of the number and say the verdict in words ("above your limit"). Pick colors that keep readable contrast in both light and dark mode, and use the same green, red, amber and blue as the tiles and the heat grid.

### Workouts

**Shows:** tiles for workouts, active minutes, calories burned and weeks with a workout. Below, minutes per week and a by-type breakdown. If there are none, show an invitation to log one. **Built from:** calcs `wo_total` (sums over `weekly`) and `wo_types` (from `summary.workout_types`, accepting alternate field names like `count` or `duration_minutes`).

### Week by week (table)

**Shows:** one row per week that has any data: days logged, average calories, protein, fiber, added sugar, sodium. A week in progress is labeled "(so far)". **Built from:** `weekly` after the loader above. Skip rows where `days_with_data` is 0.

### Footnote ("How these numbers are worked out")

A collapsed note covering: the app does the adding up, averages use full days only, calorie bars are scaled to the day total, how "second half vs first" works, and that water counts only what was logged.

## 4. Before handing over

- Confirm each source you used returns rows and that no mark points at a missing field.
- Check the empty cases: no workout target, no workouts, a day with nothing logged, and a user with under 7 days of logs (the week report refuses, so skip the weekly blocks).
- Check that the page reads well at about 400px wide.
- Remind the reader that live queries run with each reader's own healthy access.
