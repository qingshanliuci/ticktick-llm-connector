#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

function parseArgs(argv) {
  const opts = {
    days: 7,
    format: "md",
    limit: 20,
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];

    if (key === "source" && next) {
      opts.source = next;
      i += 1;
    } else if (key === "date" && next) {
      opts.date = next;
      i += 1;
    } else if (key === "days" && next) {
      opts.days = Number(next);
      i += 1;
    } else if (key === "format" && next) {
      opts.format = next;
      i += 1;
    } else if (key === "limit" && next) {
      opts.limit = Number(next);
      i += 1;
    } else if (key === "tz" && next) {
      opts.tz = next;
      i += 1;
    } else if (key === "help") {
      opts.help = true;
    }
  }

  return opts;
}

function usage() {
  console.log(`TickTick digest from TickTickSync cache

Usage:
  node scripts/ticktick_digest.mjs [options]

Options:
  --source <path>   path to tickticksync data.json
  --date <YYYY-MM-DD>  anchor date (default: today in --tz)
  --days <N>        next N days window (default: 7)
  --format <md|json>  output format (default: md)
  --limit <N>       max items per section in md (default: 20)
  --tz <IANA TZ>    timezone for date bucketing (default: system TZ)
  --help            show this help
`);
}

function assertDate(text) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new Error(`Invalid date "${text}", expected YYYY-MM-DD`);
  }
  return text;
}

function partsToYmd(date, timeZone) {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = fmt.formatToParts(date);
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const d = parts.find((p) => p.type === "day")?.value;
  return `${y}-${m}-${d}`;
}

function parseTickTickDate(value) {
  if (!value || typeof value !== "string") return null;
  const normalized = value.replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  const date = new Date(normalized);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

function addDays(ymd, days) {
  const [y, m, d] = ymd.split("-").map(Number);
  const base = new Date(Date.UTC(y, m - 1, d));
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

function cmpYmd(a, b) {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function resolveDefaultSource() {
  if (process.env.TICKTICKSYNC_CONFIG) {
    const fromEnv = path.resolve(process.env.TICKTICKSYNC_CONFIG);
    if (fs.existsSync(fromEnv)) return fromEnv;
  }

  const candidates = [
    path.resolve(process.cwd(), ".obsidian/plugins/tickticksync/data.json"),
    path.resolve(process.cwd(), "../../.obsidian/plugins/tickticksync/data.json"),
    path.resolve(process.cwd(), "../.obsidian/plugins/tickticksync/data.json"),
    path.resolve(process.cwd(), "../../../.obsidian/plugins/tickticksync/data.json"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return candidates[0];
}

function mapProjectNames(projects = []) {
  const map = new Map();
  for (const p of projects) {
    if (!p || !p.id) continue;
    map.set(p.id, p.name || p.title || p.id);
  }
  return map;
}

function makeTask(task, data, projectNames, tz) {
  const due = parseTickTickDate(task.dueDate);
  const start = parseTickTickDate(task.startDate);
  const dueLocalDate = due ? partsToYmd(due, tz) : null;
  const projectName = projectNames.get(task.projectId) || task.projectId;

  return {
    id: task.id,
    title: task.title || task.content || "",
    desc: task.desc || "",
    status: task.status,
    projectId: task.projectId,
    projectName,
    isInbox: task.projectId === data.inboxID,
    dueDateRaw: task.dueDate || "",
    dueLocalDate,
    startDateRaw: task.startDate || "",
    startLocalDate: start ? partsToYmd(start, tz) : null,
    priority: task.priority,
    tags: Array.isArray(task.tags) ? task.tags : [],
    url: `https://${data.baseURL}/webapp/#p/${task.projectId}/tasks/${task.id}`,
  };
}

function textHasThoughts(t) {
  const text = `${t.title} ${t.desc}`.toLowerCase();
  return /(思考|复盘|反思|总结|回顾|感谢)/i.test(text);
}

function sortByDueThenPriority(a, b) {
  if (a.dueLocalDate && b.dueLocalDate) {
    const d = cmpYmd(a.dueLocalDate, b.dueLocalDate);
    if (d !== 0) return d;
  } else if (a.dueLocalDate && !b.dueLocalDate) {
    return -1;
  } else if (!a.dueLocalDate && b.dueLocalDate) {
    return 1;
  }
  return (b.priority || 0) - (a.priority || 0);
}

function renderMd(report, limit) {
  const lines = [];
  lines.push(`# TickTick Digest (${report.today}, ${report.timeZone})`);
  lines.push(`Source: ${report.source}`);
  lines.push("");

  const sections = [
    ["Inbox Todo", report.inboxTodo],
    ["Today Todo", report.todayTodo],
    [`Next ${report.days} Days Todo`, report.nextDaysTodo],
    [`Next ${report.days} Days Thoughts`, report.nextDaysThoughts],
  ];

  for (const [name, items] of sections) {
    lines.push(`## ${name} (${items.length})`);
    if (items.length === 0) {
      lines.push("- (empty)");
      lines.push("");
      continue;
    }
    for (const t of items.slice(0, limit)) {
      const due = t.dueLocalDate ? ` due:${t.dueLocalDate}` : "";
      lines.push(`- [ ] ${t.title}${due} [open](${t.url})`);
    }
    if (items.length > limit) {
      lines.push(`- ... ${items.length - limit} more`);
    }
    lines.push("");
  }
  return lines.join("\n");
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    usage();
    return;
  }
  if (!Number.isFinite(opts.days) || opts.days < 1) {
    throw new Error("--days must be a positive integer");
  }
  if (!Number.isFinite(opts.limit) || opts.limit < 1) {
    throw new Error("--limit must be a positive integer");
  }
  if (!["md", "json"].includes(opts.format)) {
    throw new Error("--format must be md or json");
  }

  const source = opts.source ? path.resolve(opts.source) : resolveDefaultSource();
  if (!fs.existsSync(source)) {
    throw new Error(`data.json not found: ${source}`);
  }

  const data = JSON.parse(fs.readFileSync(source, "utf8"));
  const tasks = data?.TickTickTasksData?.tasks;
  const projects = data?.TickTickTasksData?.projects;
  if (!Array.isArray(tasks) || !Array.isArray(projects)) {
    throw new Error("invalid TickTickSync data.json: missing TickTickTasksData.tasks/projects");
  }
  if (!data.inboxID || !data.baseURL) {
    throw new Error("invalid TickTickSync data.json: missing inboxID/baseURL");
  }

  const today = opts.date ? assertDate(opts.date) : partsToYmd(new Date(), opts.tz);
  const end = addDays(today, opts.days);
  const projectNames = mapProjectNames(projects);

  const normalized = tasks
    .map((t) => makeTask(t, data, projectNames, opts.tz))
    .filter((t) => t.status === 0);

  const inboxTodo = normalized.filter((t) => t.isInbox).sort(sortByDueThenPriority);
  const todayTodo = normalized.filter((t) => t.dueLocalDate === today).sort(sortByDueThenPriority);
  const nextDaysTodo = normalized
    .filter(
      (t) =>
        t.dueLocalDate &&
        cmpYmd(t.dueLocalDate, today) > 0 &&
        cmpYmd(t.dueLocalDate, end) <= 0
    )
    .sort(sortByDueThenPriority);
  const nextDaysThoughts = nextDaysTodo.filter(textHasThoughts);

  const report = {
    source,
    timeZone: opts.tz,
    today,
    end,
    days: opts.days,
    counts: {
      totalTodo: normalized.length,
      inboxTodo: inboxTodo.length,
      todayTodo: todayTodo.length,
      nextDaysTodo: nextDaysTodo.length,
      nextDaysThoughts: nextDaysThoughts.length,
    },
    inboxTodo,
    todayTodo,
    nextDaysTodo,
    nextDaysThoughts,
  };

  if (opts.format === "json") {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  console.log(renderMd(report, opts.limit));
}

try {
  main();
} catch (err) {
  console.error(`Error: ${err.message}`);
  process.exit(1);
}
