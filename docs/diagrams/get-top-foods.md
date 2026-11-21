# get_top_foods

How a top-foods list is built. It uses the same window as `get_report` (7 days, 8 weeks or 6 months ending with `end_date`). The database only groups the logs by food; the server does the nutrient math, ranks the foods by the one metric asked for and makes the shares add up to 100.

```mermaid
%%{init: {'theme': 'base', 'themeVariables': {'fontFamily': 'ui-sans-serif, system-ui, sans-serif', 'fontSize': '14px', 'lineColor': '#64748b', 'primaryTextColor': '#0f172a'}}}%%
flowchart TD
    L["Assistant<br/>granularity, end_date, rank_by,<br/>limit, meal_type"] -->|"1. JSON arguments"| T["<b>src/tools/report.ts</b><br/>check the shape with zod"]
    T --> S["<b>src/services/topFoods.ts</b><br/>the report's window, rank, limit,<br/>everything_else row"]
    S --> Q["<b>src/data/report.ts</b><br/>one row per food: grams, entries, days<br/>always scoped to your user"]
    Q <--> DB[("<b>D1</b><br/>food_logs, foods")]
    S --> N["<b>src/nutrition.ts</b><br/>nutrients from grams,<br/>shares that add up to 100"]
    N --> S
    S -->|"ranked foods"| R["<b>respond()</b><br/>compact JSON text"]
    R -->|"2. reply"| L

    classDef you fill:#dbeafe,stroke:#2563eb,stroke-width:1.5px,color:#1e3a8a
    classDef code fill:#dcfce7,stroke:#16a34a,stroke-width:1.5px,color:#14532d
    classDef data fill:#fef3c7,stroke:#d97706,stroke-width:1.5px,color:#78350f
    classDef outside fill:#ede9fe,stroke:#7c3aed,stroke-width:1.5px,color:#4c1d95
    classDef auto fill:#f1f5f9,stroke:#64748b,stroke-width:1.5px,color:#0f172a
    class L you
    class T,S,Q,N,R code
    class DB data
```

What is in the answer: the foods ranked by `rank_by` (calories, protein, fat, carbs, fiber, sugar, added sugar, sodium, days eaten, entries or grams), each with its total for that metric (`value`), its share of the window total, days eaten, entries and grams, then an `everything_else` row when there are more foods than `limit`, so the shares add up to 100 (days eaten has no shares, since days overlap between foods). Water is left out, and `meal_type` limits the list to one meal. Archived and planned entries are left out. If nothing was logged in the window the call fails and says where the user's data starts. No targets are needed.

Colors: see the [legend](README.md#colors).
