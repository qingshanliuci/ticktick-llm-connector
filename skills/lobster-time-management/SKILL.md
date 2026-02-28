---
name: lobster-time-management
description: Organize TickTick/Dida tasks for personal time management with WeChat-capture cleanup, marker-link merge (待投递/待阅读/好素材), action-vs-material classification, duplicate cleanup, and safe apply flow. Use when a user asks to clean inbox tasks, merge split WeChat tasks, classify captured content, or produce daily/weekly actionable views.
---

# Lobster Time Management

## Quick Start

1. Move to project root where `bin/tt-llm.mjs` exists.
2. Run dry-run first:
   - `node ./bin/tt-llm.mjs wechat --window-seconds 240 --format md`
3. Show merge and classification preview to user.
4. Apply only after explicit confirmation:
   - `node ./bin/tt-llm.mjs wechat --window-seconds 240 --apply --format md`

## Task Routing

- Use `wechat` when the problem is WeChat capture fragmentation or action/material classification.
- Use `dedupe` when the problem is near-duplicate tasks not limited to WeChat marker pairs.
- Use `digest` when the user wants today/next-days planning or review output.

## Safe Execution Rules

1. Always run dry-run before `--apply`.
2. Present three numbers before modifying data: merge pairs, planned updates, planned deletes.
3. Treat ambiguous merges as preview-only and ask for confirmation.
4. After `--apply`, run `digest` once to verify state and report changes.

## Command Reference

- WeChat organize preview:
  - `node ./bin/tt-llm.mjs wechat --window-seconds 240 --format md`
- WeChat organize apply:
  - `node ./bin/tt-llm.mjs wechat --window-seconds 240 --apply --format md`
- Duplicate cleanup preview:
  - `node ./bin/tt-llm.mjs dedupe --scope inbox --window-hours 24 --format md`
- Daily digest JSON (for downstream LLM):
  - `node ./bin/tt-llm.mjs digest --date 2026-02-28 --tz Asia/Shanghai --format json`

## References

- Read [classification-rules.md](references/classification-rules.md) when adjusting marker keywords or classification behavior.
