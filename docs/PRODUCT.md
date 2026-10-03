# Voice-first analytics

## User hypothesis to validate at the venue

A founder preparing an investor update has an Excel revenue export and only a few minutes.
They need to compare regions, investigate a drop, and rearrange the presentation while talking
through it with a teammate. Interview one actual person before treating this as validated.

## Demo sequence

1. Connect a small Excel workbook. Show its sheets, inferred columns and snapshot timestamp.
2. Say “Build a revenue dashboard by month and region.”
3. Gemini Live calls a data tool and delegates planning to Gemini 3.8 Flash while conversation continues.
4. Render the returned chart plan with query IDs and actual values.
5. Interrupt: “Make that a line chart, put the region comparison first, remove the table.”
6. Select a chart and ask “Why did this drop?” Answer with measured changes and limitations;
   do not invent causes absent explanatory evidence.
7. Demonstrate a read-only database/API source only after its real connection is verified.

## Scope

Core: Excel/CSV import, two useful charts, add/update/remove/reorder/select, interruption,
selected-chart questions, filters, evidence and spoken explanations.
Next: Postgres, JSON API, refresh state, more chart families, reusable dashboards.
Extensible: visualization renderer registry, validated declarative specs, isolated custom renderers.
“Any visualization” is a direction, not an implemented capability.

## Hackathon differentiation

Demonstrate asynchronous chart building during an interruptible live discussion, then refer to
specific charts and evidence across turns. Use September's 3.8 Live and 3.8 Flash capabilities.
Novelty remains a hypothesis until demonstrated; generic voice-to-dashboard products already exist.
