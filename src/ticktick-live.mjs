#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

function parseArgs(argv) {
  const opts = {
    command: "digest",
    date: null,
    days: 7,
    format: "md",
    limit: 20,
    tz: Intl.DateTimeFormat().resolvedOptions().timeZone || "Asia/Shanghai",
    scope: "inbox",
    windowHours: 12,
    windowSeconds: 180,
    apply: false,
  };

  const args = [...argv];
  if (args[0] && !args[0].startsWith("--")) {
    opts.command = args.shift();
  }

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    const next = args[i + 1];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);

    if (key === "config" && next) {
      opts.config = next;
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
    } else if (key === "scope" && next) {
      opts.scope = next;
      i += 1;
    } else if (key === "window-hours" && next) {
      opts.windowHours = Number(next);
      i += 1;
    } else if (key === "window-seconds" && next) {
      opts.windowSeconds = Number(next);
      i += 1;
    } else if (key === "apply") {
      opts.apply = true;
    } else if (key === "help") {
      opts.help = true;
    }
  }

  return opts;
}

function usage() {
  console.log(`TickTick direct API helper (without Obsidian task parsing)

Usage:
  node scripts/ticktick_live.mjs <command> [options]

Commands:
  digest   read tasks directly from TickTick/Dida API and print digest
  dedupe   detect near-duplicate tasks (default dry-run), optional apply delete
  wechat   merge WeChat-captured split tasks and classify into action/material

Options:
  --config <path>      tickticksync data.json path (default: auto detect)
  --date <YYYY-MM-DD>  digest anchor date (default: today in --tz)
  --days <N>           digest future window days (default: 7)
  --format <md|json>   output format (default: md)
  --limit <N>          max rows shown in md output (default: 20)
  --tz <IANA TZ>       timezone for date bucketing (default: system TZ)
  --scope <inbox|all>  dedupe scope (default: inbox)
  --window-hours <N>   dedupe time window by modifiedTime (default: 12)
  --window-seconds <N> wechat merge window by task create time (default: 180)
  --apply              apply dedupe/wechat plan to TickTick
  --help               show this help
`);
}

function assertDate(text) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw new Error(`Invalid date "${text}", expected YYYY-MM-DD`);
  }
  return text;
}

function resolveDefaultConfig() {
  if (process.env.TICKTICKSYNC_CONFIG) {
    const fromEnv = path.resolve(process.env.TICKTICKSYNC_CONFIG);
    if (fs.existsSync(fromEnv)) return fromEnv;
  }

  const candidates = [
    path.resolve(process.cwd(), ".obsidian/plugins/tickticksync/data.json"),
    path.resolve(process.cwd(), "../.obsidian/plugins/tickticksync/data.json"),
    path.resolve(process.cwd(), "../../.obsidian/plugins/tickticksync/data.json"),
    path.resolve(process.cwd(), "../../../.obsidian/plugins/tickticksync/data.json"),
  ];

  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return candidates[0];
}

function parseTickTickDate(value) {
  if (!value || typeof value !== "string") return null;
  const normalized = value.replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
  const d = new Date(normalized);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function objectIdTimeMs(id) {
  if (!/^[0-9a-f]{24}$/i.test(String(id || ""))) return null;
  const sec = parseInt(String(id).slice(0, 8), 16);
  if (!Number.isFinite(sec)) return null;
  return sec * 1000;
}

function ymdInTZ(date, timeZone) {
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

function compareByDueThenPriority(a, b) {
  if (a.dueLocalDate && b.dueLocalDate) {
    const c = cmpYmd(a.dueLocalDate, b.dueLocalDate);
    if (c !== 0) return c;
  } else if (a.dueLocalDate && !b.dueLocalDate) {
    return -1;
  } else if (!a.dueLocalDate && b.dueLocalDate) {
    return 1;
  }
  return (b.priority || 0) - (a.priority || 0);
}

function mkDevice() {
  const randomHex = Array.from({ length: 22 }, () =>
    Math.floor(Math.random() * 16).toString(16)
  ).join("");
  return JSON.stringify({
    platform: "web",
    os: "Windows 10",
    device: "Firefox 117.0",
    name: "",
    version: 6070,
    id: `66${randomHex}`,
    channel: "website",
    campaign: "",
    websocket: "",
  });
}

class TickTickClient {
  constructor({ baseURL, token }) {
    if (!baseURL || !token) {
      throw new Error("Missing baseURL/token in config");
    }
    this.baseURL = baseURL;
    this.token = token;
    this.device = mkDevice();
    this.apiRoot = `https://api.${baseURL}/api/v2`;
  }

  headers() {
    return {
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0",
      "x-device": this.device,
      Cookie: `t=${this.token};`,
      t: this.token,
    };
  }

  async request(method, endpoint, body) {
    const res = await fetch(`${this.apiRoot}${endpoint}`, {
      method,
      headers: this.headers(),
      body: body ? JSON.stringify(body) : undefined,
    });

    const text = await res.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }

    if (!res.ok) {
      throw new Error(
        `HTTP ${res.status} ${method} ${endpoint} ${text.slice(0, 300)}`
      );
    }

    return json;
  }

  async fetchStatus() {
    return this.request("GET", "/user/status");
  }

  async fetchProjects() {
    return this.request("GET", "/projects");
  }

  async fetchSync(checkPoint = 0) {
    return this.request("GET", `/batch/check/${checkPoint}`);
  }

  async deleteTasks(items) {
    const payload = {
      add: [],
      addAttachments: [],
      delete: items.map((x) => ({ taskId: x.id, projectId: x.projectId })),
      deleteAttachments: [],
      updateAttachments: [],
      update: [],
    };
    return this.request("POST", "/batch/task", payload);
  }

  async updateTasks(items) {
    const payload = {
      add: [],
      addAttachments: [],
      delete: [],
      deleteAttachments: [],
      updateAttachments: [],
      update: items,
    };
    return this.request("POST", "/batch/task", payload);
  }
}

function mapProjects(projects = []) {
  const m = new Map();
  for (const p of projects) {
    if (!p?.id) continue;
    m.set(p.id, p.name || p.title || p.id);
  }
  return m;
}

function cleanTitle(raw) {
  let s = String(raw || "");

  // Remove Obsidian backlink artifacts injected by integrations.
  s = s.replace(/\[[^\]]*]\((obsidian:\/\/[^)]+)\)/gi, " ");

  // Keep markdown link text but drop the URL.
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/gi, "$1");

  // Drop plain URLs and normalize whitespace.
  s = s.replace(/https?:\/\/\S+/gi, " ");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

function normalizeTasks(tasks, projectMap, inboxID, baseURL, tz) {
  return tasks.map((t) => {
    const due = parseTickTickDate(t.dueDate);
    const start = parseTickTickDate(t.startDate);
    const mod = parseTickTickDate(t.modifiedTime);
    const createdAtMs = objectIdTimeMs(t.id);
    const titleRaw = t.title || t.content || "";
    return {
      id: t.id,
      titleRaw,
      title: cleanTitle(titleRaw),
      desc: t.desc || "",
      status: t.status,
      projectId: t.projectId,
      projectName: projectMap.get(t.projectId) || t.projectId,
      isInbox: t.projectId === inboxID,
      priority: t.priority || 0,
      dueDateRaw: t.dueDate || "",
      dueLocalDate: due ? ymdInTZ(due, tz) : null,
      startLocalDate: start ? ymdInTZ(start, tz) : null,
      modifiedAtMs: mod ? mod.getTime() : null,
      modifiedTimeRaw: t.modifiedTime || "",
      createdAtMs,
      parentId: t.parentId || null,
      tags: Array.isArray(t.tags) ? t.tags : [],
      hasUrl: /https?:\/\/|v\.douyin\.com|mp\.weixin\.qq\.com|x\.com\//i.test(titleRaw),
      raw: t,
      url: `https://${baseURL}/webapp/#p/${t.projectId}/tasks/${t.id}`,
    };
  });
}

function titleNorm(title) {
  return String(title || "")
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[\s\p{P}\p{S}]+/gu, "");
}

function diceSimilarity(a, b) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;

  const makeBigrams = (s) => {
    const map = new Map();
    for (let i = 0; i < s.length - 1; i += 1) {
      const bg = s.slice(i, i + 2);
      map.set(bg, (map.get(bg) || 0) + 1);
    }
    return map;
  };

  const a2 = makeBigrams(a);
  const b2 = makeBigrams(b);
  let inter = 0;
  for (const [bg, c] of a2.entries()) {
    inter += Math.min(c, b2.get(bg) || 0);
  }
  return (2 * inter) / (a.length + b.length - 2);
}

function shouldMergePair(a, b, windowMs) {
  if (a.projectId !== b.projectId) return false;
  if (a.parentId || b.parentId) return false;

  if (a.dueLocalDate || b.dueLocalDate) {
    if (a.dueLocalDate !== b.dueLocalDate) return false;
  }

  if (a.modifiedAtMs && b.modifiedAtMs) {
    if (Math.abs(a.modifiedAtMs - b.modifiedAtMs) > windowMs) return false;
  }

  const na = titleNorm(a.title);
  const nb = titleNorm(b.title);
  if (!na || !nb) return false;

  if (na === nb) return true;
  if (na.length < 4 || nb.length < 4) return false;

  const shorter = na.length <= nb.length ? na : nb;
  const longer = na.length <= nb.length ? nb : na;
  const includes = longer.includes(shorter);
  if (includes && shorter.length >= 4) {
    const ratio = shorter.length / longer.length;
    if (ratio >= 0.4) return true;
  }

  const sim = diceSimilarity(na, nb);
  if (sim >= 0.92 && Math.min(na.length, nb.length) >= 8) return true;

  return false;
}

class UnionFind {
  constructor(n) {
    this.parent = Array.from({ length: n }, (_, i) => i);
    this.rank = Array(n).fill(0);
  }

  find(x) {
    if (this.parent[x] !== x) {
      this.parent[x] = this.find(this.parent[x]);
    }
    return this.parent[x];
  }

  union(a, b) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra === rb) return;
    if (this.rank[ra] < this.rank[rb]) {
      this.parent[ra] = rb;
    } else if (this.rank[ra] > this.rank[rb]) {
      this.parent[rb] = ra;
    } else {
      this.parent[rb] = ra;
      this.rank[ra] += 1;
    }
  }
}

function pickKeeper(tasks) {
  const copy = [...tasks];
  copy.sort((a, b) => {
    const la = titleNorm(a.title).length;
    const lb = titleNorm(b.title).length;
    if (lb !== la) return lb - la;
    return (b.priority || 0) - (a.priority || 0);
  });
  return copy[0];
}

function detectDuplicates(tasks, opts) {
  const list = tasks.filter((t) => t.status === 0 && (opts.scope === "all" || t.isInbox));
  const uf = new UnionFind(list.length);
  const windowMs = opts.windowHours * 3600 * 1000;

  // Bucket by project + dueDate to reduce pair checks.
  const buckets = new Map();
  for (let i = 0; i < list.length; i += 1) {
    const t = list[i];
    const key = `${t.projectId}__${t.dueLocalDate || "none"}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(i);
  }

  for (const idxs of buckets.values()) {
    for (let i = 0; i < idxs.length; i += 1) {
      for (let j = i + 1; j < idxs.length; j += 1) {
        const ia = idxs[i];
        const ib = idxs[j];
        if (shouldMergePair(list[ia], list[ib], windowMs)) {
          uf.union(ia, ib);
        }
      }
    }
  }

  const groups = new Map();
  for (let i = 0; i < list.length; i += 1) {
    const r = uf.find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(list[i]);
  }

  const merges = [];
  for (const g of groups.values()) {
    if (g.length < 2) continue;
    const keep = pickKeeper(g);
    const remove = g.filter((x) => x.id !== keep.id);
    if (remove.length === 0) continue;
    merges.push({ keep, remove });
  }

  merges.sort((a, b) => b.remove.length - a.remove.length);
  return merges;
}

function buildDigest(tasks, date, days) {
  const today = date;
  const end = addDays(today, days);

  const todo = tasks.filter((t) => t.status === 0).sort(compareByDueThenPriority);
  const inboxTodo = todo.filter((t) => t.isInbox);
  const todayTodo = todo.filter((t) => t.dueLocalDate === today);
  const nextDaysTodo = todo.filter(
    (t) =>
      t.dueLocalDate &&
      cmpYmd(t.dueLocalDate, today) > 0 &&
      cmpYmd(t.dueLocalDate, end) <= 0
  );
  const nextDaysThoughts = nextDaysTodo.filter((t) =>
    /(思考|复盘|反思|总结|回顾|感谢)/i.test(`${t.title} ${t.desc}`)
  );

  return {
    today,
    end,
    days,
    counts: {
      totalTodo: todo.length,
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
}

function renderDigestMd(meta, digest, limit) {
  const out = [];
  out.push(`# TickTick Live Digest (${digest.today}, ${meta.tz})`);
  out.push(`User: ${meta.user}`);
  out.push(`Server: ${meta.baseURL}`);
  out.push(`Sync checkPoint: ${meta.checkPoint}`);
  out.push("");

  const sections = [
    ["Inbox Todo", digest.inboxTodo],
    ["Today Todo", digest.todayTodo],
    [`Next ${digest.days} Days Todo`, digest.nextDaysTodo],
    [`Next ${digest.days} Days Thoughts`, digest.nextDaysThoughts],
  ];

  for (const [title, list] of sections) {
    out.push(`## ${title} (${list.length})`);
    if (list.length === 0) {
      out.push("- (empty)");
      out.push("");
      continue;
    }
    for (const t of list.slice(0, limit)) {
      const due = t.dueLocalDate ? ` due:${t.dueLocalDate}` : "";
      out.push(`- [ ] ${t.title}${due} [open](${t.url})`);
    }
    if (list.length > limit) out.push(`- ... ${list.length - limit} more`);
    out.push("");
  }
  return out.join("\n");
}

function renderDedupeMd(meta, merges, apply, deletedCount) {
  const out = [];
  out.push(`# TickTick Dedupe (${apply ? "APPLIED" : "DRY-RUN"})`);
  out.push(`User: ${meta.user}`);
  out.push(`Server: ${meta.baseURL}`);
  out.push(`Duplicate groups: ${merges.length}`);
  out.push(`Tasks to delete: ${merges.reduce((n, m) => n + m.remove.length, 0)}`);
  if (apply) out.push(`Deleted: ${deletedCount}`);
  out.push("");

  if (merges.length === 0) {
    out.push("- No duplicates detected under current rules.");
    return out.join("\n");
  }

  for (const [idx, m] of merges.entries()) {
    out.push(`## Group ${idx + 1}`);
    out.push(`- keep: ${m.keep.title} (${m.keep.id})`);
    for (const r of m.remove) {
      out.push(`- delete: ${r.title} (${r.id})`);
    }
    out.push("");
  }

  return out.join("\n");
}

const WECHAT_TAG = "微信采集";
const CLASS_ACTION_TAG = "待行动";
const CLASS_MATERIAL_TAG = "材料";

function detectMarkerLabel(text) {
  const s = cleanTitle(text).replace(/\s+/g, "");
  if (!s) return null;
  if ((/待投递/.test(s) && s.length <= 8) || s === "待投递") return "待投递";
  if ((/待阅读/.test(s) && s.length <= 8) || s === "待阅读") return "待阅读";
  if ((/好素材/.test(s) && s.length <= 8) || s === "好素材") return "好素材";
  return null;
}

function markerToClass(label) {
  if (label === "待投递") return "action";
  if (label === "待阅读" || label === "好素材") return "material";
  return null;
}

function classifyTask(task, hintedClass = null) {
  if (hintedClass) {
    return { classType: hintedClass, reason: "marker_hint" };
  }

  const text = `${task.title} ${task.desc}`.toLowerCase();
  const actionRegex =
    /(待投递|讨论|开会|会议|面试|参加|发送|发给|提交|完成|处理|跟进|安排|提醒|明天|今天|下午|晚上|早上|电话|约)/i;
  const materialRegex =
    /(待阅读|好素材|素材|待读|收藏|链接|文章|视频|抖音|公众号|转发|学习|案例|资料)/i;

  if (actionRegex.test(text)) return { classType: "action", reason: "keyword_action" };
  if (materialRegex.test(text)) return { classType: "material", reason: "keyword_material" };
  if (task.hasUrl) return { classType: "material", reason: "has_url" };
  if (task.dueLocalDate) return { classType: "action", reason: "has_due" };
  return { classType: "action", reason: "fallback_action" };
}

function normalizeClassTags(tags, classType) {
  const base = (Array.isArray(tags) ? tags : []).filter(
    (t) => t !== CLASS_ACTION_TAG && t !== CLASS_MATERIAL_TAG
  );
  const tag = classType === "action" ? CLASS_ACTION_TAG : CLASS_MATERIAL_TAG;
  if (!base.includes(tag)) base.push(tag);
  return base;
}

function sameArray(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function isWechatCapturedTask(t) {
  return (
    t.status === 0 &&
    t.isInbox &&
    (t.tags.includes(WECHAT_TAG) || /微信采集/i.test(t.titleRaw || ""))
  );
}

function taskTimeMs(t) {
  return t.createdAtMs || t.modifiedAtMs || null;
}

function appendDescNote(desc, note) {
  const prefix = `微信标记: ${note}`;
  if ((desc || "").includes(prefix)) return desc || "";
  if (!desc) return prefix;
  return `${prefix}\n${desc}`;
}

function buildWechatPlan(tasks, opts) {
  const wechatTasks = tasks.filter(isWechatCapturedTask);
  const markers = wechatTasks
    .map((t) => ({ task: t, marker: detectMarkerLabel(t.title) }))
    .filter((x) => Boolean(x.marker));

  const normalTasks = wechatTasks.filter((t) => !detectMarkerLabel(t.title));
  const usedTaskIds = new Set();
  const mergePairs = [];
  const mergeHintByKeepId = new Map();
  const deleteById = new Map();
  const windowMs = opts.windowSeconds * 1000;

  for (const m of markers) {
    const mt = taskTimeMs(m.task);
    if (!mt) continue;

    let best = null;
    for (const t of normalTasks) {
      if (usedTaskIds.has(t.id)) continue;
      if (t.projectId !== m.task.projectId) continue;
      if (!t.hasUrl) continue;
      const tt = taskTimeMs(t);
      if (!tt) continue;
      const diff = Math.abs(tt - mt);
      if (diff > windowMs) continue;
      if (!best || diff < best.diff) best = { task: t, diff };
    }

    if (!best) continue;
    usedTaskIds.add(best.task.id);
    deleteById.set(m.task.id, m.task);
    const hintedClass = markerToClass(m.marker);
    mergeHintByKeepId.set(best.task.id, {
      marker: m.marker,
      hintedClass,
    });
    mergePairs.push({
      markerTask: m.task,
      marker: m.marker,
      keepTask: best.task,
      diffMs: best.diff,
    });
  }

  const updatesById = new Map();
  const classifyRows = [];
  let actionCount = 0;
  let materialCount = 0;

  for (const t of wechatTasks) {
    if (deleteById.has(t.id)) continue;
    const hint = mergeHintByKeepId.get(t.id);
    const c = classifyTask(t, hint?.hintedClass || markerToClass(detectMarkerLabel(t.title)));
    if (c.classType === "action") actionCount += 1;
    else materialCount += 1;

    let nextTags = normalizeClassTags(t.tags, c.classType);
    let nextDesc = t.raw.desc || "";
    if (hint?.marker) {
      nextDesc = appendDescNote(nextDesc, hint.marker);
    }

    const tagsChanged = !sameArray(nextTags, Array.isArray(t.raw.tags) ? t.raw.tags : []);
    const descChanged = nextDesc !== (t.raw.desc || "");
    if (tagsChanged || descChanged) {
      updatesById.set(t.id, {
        ...t.raw,
        tags: nextTags,
        desc: nextDesc,
      });
    }

    classifyRows.push({
      id: t.id,
      title: t.title,
      classType: c.classType,
      reason: c.reason,
      changed: tagsChanged || descChanged,
    });
  }

  return {
    wechatTaskCount: wechatTasks.length,
    mergePairs,
    classifyRows,
    classCounts: { action: actionCount, material: materialCount },
    updateTasks: Array.from(updatesById.values()),
    deleteTasks: Array.from(deleteById.values()),
  };
}

function renderWechatMd(meta, plan, apply, appliedStats = { updated: 0, deleted: 0 }) {
  const out = [];
  out.push(`# TickTick WeChat Organizer (${apply ? "APPLIED" : "DRY-RUN"})`);
  out.push(`User: ${meta.user}`);
  out.push(`Server: ${meta.baseURL}`);
  out.push(`WeChat tasks: ${plan.wechatTaskCount}`);
  out.push(`Merge pairs: ${plan.mergePairs.length}`);
  out.push(
    `Classified: action=${plan.classCounts.action}, material=${plan.classCounts.material}`
  );
  out.push(
    `Planned updates=${plan.updateTasks.length}, planned deletes=${plan.deleteTasks.length}`
  );
  if (apply) {
    out.push(`Applied updates=${appliedStats.updated}, applied deletes=${appliedStats.deleted}`);
  }
  out.push("");

  if (plan.mergePairs.length > 0) {
    out.push("## Merge Preview");
    for (const p of plan.mergePairs) {
      out.push(
        `- ${p.markerTask.title} (${p.markerTask.id}) -> ${p.keepTask.title} (${p.keepTask.id})`
      );
    }
    out.push("");
  }

  out.push("## Classification Preview");
  for (const row of plan.classifyRows.slice(0, 30)) {
    out.push(`- [${row.classType}] ${row.title} (${row.id}) reason=${row.reason}`);
  }
  if (plan.classifyRows.length > 30) {
    out.push(`- ... ${plan.classifyRows.length - 30} more`);
  }

  return out.join("\n");
}

function safeNumber(v, name) {
  if (!Number.isFinite(v) || v <= 0) {
    throw new Error(`${name} must be a positive number`);
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    usage();
    return;
  }

  if (!["digest", "dedupe", "wechat"].includes(opts.command)) {
    throw new Error(`Unknown command: ${opts.command}`);
  }
  if (!["md", "json"].includes(opts.format)) {
    throw new Error("--format must be md or json");
  }
  if (!["inbox", "all"].includes(opts.scope)) {
    throw new Error("--scope must be inbox or all");
  }
  safeNumber(opts.days, "--days");
  safeNumber(opts.limit, "--limit");
  safeNumber(opts.windowHours, "--window-hours");
  safeNumber(opts.windowSeconds, "--window-seconds");

  const configPath = opts.config
    ? path.resolve(opts.config)
    : resolveDefaultConfig();
  if (!fs.existsSync(configPath)) {
    throw new Error(`config not found: ${configPath}`);
  }

  const config = JSON.parse(fs.readFileSync(configPath, "utf8"));
  const client = new TickTickClient({
    baseURL: config.baseURL,
    token: config.token,
  });

  const [status, projects, sync] = await Promise.all([
    client.fetchStatus(),
    client.fetchProjects(),
    client.fetchSync(0),
  ]);

  const projectMap = mapProjects(projects || []);
  const rawTasks = sync?.syncTaskBean?.update;
  if (!Array.isArray(rawTasks)) {
    throw new Error("sync response does not contain syncTaskBean.update");
  }

  const tasks = normalizeTasks(
    rawTasks,
    projectMap,
    status?.inboxId || config.inboxID,
    config.baseURL,
    opts.tz
  );

  const meta = {
    configPath,
    baseURL: config.baseURL,
    user: status?.username || "unknown",
    checkPoint: sync?.checkPoint || null,
    tz: opts.tz,
  };

  if (opts.command === "digest") {
    const today = opts.date ? assertDate(opts.date) : ymdInTZ(new Date(), opts.tz);
    const digest = buildDigest(tasks, today, opts.days);
    const payload = { meta, digest };
    if (opts.format === "json") {
      console.log(JSON.stringify(payload, null, 2));
    } else {
      console.log(renderDigestMd(meta, digest, opts.limit));
    }
    return;
  }

  if (opts.command === "dedupe") {
    const merges = detectDuplicates(tasks, opts);
    let deletedCount = 0;
    if (opts.apply && merges.length > 0) {
      const toDelete = merges.flatMap((m) => m.remove);
      await client.deleteTasks(toDelete);
      deletedCount = toDelete.length;
    }

    const payload = { meta, apply: opts.apply, merges, deletedCount };
    if (opts.format === "json") {
      console.log(JSON.stringify(payload, null, 2));
    } else {
      console.log(renderDedupeMd(meta, merges, opts.apply, deletedCount));
    }
    return;
  }

  const plan = buildWechatPlan(tasks, opts);
  let appliedStats = { updated: 0, deleted: 0 };
  if (opts.apply) {
    if (plan.updateTasks.length > 0) {
      await client.updateTasks(plan.updateTasks);
      appliedStats.updated = plan.updateTasks.length;
    }
    if (plan.deleteTasks.length > 0) {
      await client.deleteTasks(plan.deleteTasks);
      appliedStats.deleted = plan.deleteTasks.length;
    }
  }

  const payload = { meta, apply: opts.apply, plan, appliedStats };
  if (opts.format === "json") {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    console.log(renderWechatMd(meta, plan, opts.apply, appliedStats));
  }
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
