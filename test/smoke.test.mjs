import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const bin = path.join(root, "bin", "tt-llm.mjs");

function run(args) {
  return spawnSync(process.execPath, [bin, ...args], {
    cwd: root,
    encoding: "utf8",
  });
}

{
  const r = run(["--help"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /wechat\s+merge WeChat-captured/i);
}

{
  const r = run(["cache-digest", "--help"]);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /TickTick digest from TickTickSync cache/i);
}

console.log("smoke tests passed");
