---
name: ticktick-llm-bridge
description: Bridge TickTick/Dida task data into LLM workflows through direct API-backed CLI commands, producing structured JSON for summarization, prioritization, and planning. Use when users ask to connect TickTick with AI assistants, automate task analysis, or feed task context into model prompts.
---

# TickTick LLM Bridge

## Quick Start

1. Ensure `TickTickSync` exists and `data.json` is available.
2. Set config path when auto-discovery is unreliable:
   - `export TICKTICKSYNC_CONFIG="/path/to/.obsidian/plugins/tickticksync/data.json"`
3. Generate machine-readable context:
   - `node ./bin/tt-llm.mjs digest --format json`

## Integration Workflow

1. Pull structured tasks from `digest --format json`.
2. Feed JSON to LLM for prioritization, scheduling, or summary.
3. If cleanup is needed, run `wechat --format json` or `dedupe --format json`.
4. Execute `--apply` only after user confirms the planned modifications.

## Command Matrix

- Daily/weekly context:
  - `node ./bin/tt-llm.mjs digest --date 2026-02-28 --days 7 --format json`
- WeChat cleanup plan:
  - `node ./bin/tt-llm.mjs wechat --window-seconds 240 --format json`
- Duplicate cleanup plan:
  - `node ./bin/tt-llm.mjs dedupe --scope inbox --window-hours 24 --format json`
- Offline cache-only mode:
  - `node ./bin/tt-llm.mjs cache-digest --format json`

## Operational Guardrails

1. Keep token/cookie values out of logs and prompts.
2. Default to preview mode and require explicit confirmation before mutation.
3. Report exact counts and IDs before and after apply.
4. Use timezone-explicit dates in outputs (for example `2026-02-28`).

## References

- Read [llm-prompt-template.md](references/llm-prompt-template.md) when generating AI summaries from digest JSON.
