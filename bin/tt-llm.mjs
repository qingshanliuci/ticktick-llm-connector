#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");

const args = process.argv.slice(2);
let target = path.join(root, "src", "ticktick-live.mjs");
let forwardArgs = args;

if (args[0] === "cache-digest") {
  target = path.join(root, "src", "ticktick-digest.mjs");
  forwardArgs = args.slice(1);
}

const ret = spawnSync(process.execPath, [target, ...forwardArgs], {
  stdio: "inherit",
});

if (ret.error) {
  console.error(ret.error.message);
  process.exit(1);
}

process.exit(ret.status ?? 1);
