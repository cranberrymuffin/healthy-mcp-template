# get_report

How a report is built. The server reads the rows for the whole window once, adds everything up and judges every day against the targets, then replies with compact JSON. The assistant never adds numbers up, and draws any chart itself from the rows.

```mermaid
%%{init: {'theme': 'base', 'themeVariables': {'fontFamily': 'ui-sans-serif, system-ui, sans-serif', 'fontSize': '14px', 'lineColor': '#64748b', 'primaryTextColor': '#0f172a'}}}%%
flowchart TD
    L["Assistant<br/>granularity, end_date"] -->|"1. JSON arguments"| T["<b>src/tools/report.ts</b><br/>check the shape with zod"]
    T --> S["<b>src/services/report.ts</b><br/>fixed window: 7 days, 8 weeks or 6 months<br/>one row per day, week or month<br/>summary over the whole window"]
    S --> Q["<b>src/data/report.ts</b><br/>eaten, active logs and workouts in the window<br/>always scoped to your user"]
    Q <--> DB[("<b>D1</b><br/>food_logs, foods, workouts,<br/>daily_target_metrics")]
    S --> N["<b>src/nutrition.ts</b><br/>nutrient sums, adherence per day,<br/>trend, shares that add up to 100,<br/>time-of-day buckets"]
    N --> S
    S -->|"rows + summary"| R["<b>respond()</b><br/>compact JSON text"]
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

What is in the answer: a row per period (calories and where they came from, macros, fiber, sugar, added sugar, sodium, water, workouts, how many entries were estimated), and a summary with the trend, adherence to each target (days met and missed, streaks), the meal types and workout types over the whole window, one sentence to quote. Top foods are a separate tool: [get_top_foods](get-top-foods.md). The report needs every required daily target to be set: until then the call fails and names the missing ones. The week report also needs 7 days since the first log, and the month report 30. Archived and planned entries are left out, and today counts as in progress and is left out of adherence. If nothing at all was logged in the window the call fails and says where the user's data starts. For the individual foods of one day, `get_day` lists each with the local time it was eaten.

Colors: see the [legend](README.md#colors).
