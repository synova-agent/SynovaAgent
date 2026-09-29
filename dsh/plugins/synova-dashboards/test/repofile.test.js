// test/repofile.test.js — provenance（D1066「时效真」）单元测试
// 覆盖：易失路径判定 / 陈旧判定（>24h）/ 时间不可解析 → stale=null / 汇总 / 二级取数基本路径
// 铁律 48：非空壳，每条路径都有真实断言。
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import {
  isVolatilePath, provenanceOf, provenanceSummary, readRepoJson, gitRead,
  VOLATILE_PATH_RE, STALE_AFTER_HOURS
} from "../lib/repofile.js";

test("isVolatilePath：/tmp、/var/folders、.synova-wt-* 命中；主仓路径不命中", () => {
  assert.equal(isVolatilePath("/tmp/v-ux/x"), true);
  assert.equal(isVolatilePath("/private/tmp/x"), true);
  assert.equal(isVolatilePath("/var/folders/ab/cd/T/x"), true);
  assert.equal(isVolatilePath("/Users/wane/SynovaAgent/.synova-wt-d1066/x"), true);
  assert.equal(isVolatilePath("/Users/wane/SynovaAgent/dsh/plugins/x"), false, "主仓路径不得误报");
  assert.equal(isVolatilePath(undefined), false);
  assert.ok(VOLATILE_PATH_RE instanceof RegExp);
  assert.equal(STALE_AFTER_HOURS, 24);
});

test("provenanceOf：正常路径给 来源/生成时间/年龄；>24h 判陈旧；不陈旧不误报", () => {
  const now = new Date("2026-09-29T12:00:00Z");
  const fresh = provenanceOf({ label: "甲", path: "/repo/a.json", source: "worktree", generated_at: "2026-09-29T11:00:00Z", now });
  assert.equal(fresh.age_hours, 1);
  assert.equal(fresh.stale, false);
  assert.equal(fresh.volatile, false);
  assert.equal(fresh.warning, null);

  const old = provenanceOf({ label: "乙", path: "/repo/b.json", source: "worktree", generated_at: "2026-09-20T12:00:00Z", now });
  assert.equal(old.age_hours, 216);
  assert.equal(old.stale, true, ">24h 必须判陈旧");
});

test("provenanceOf 边界：时间不可解析 ⇒ age=null/stale=null（不折算成新鲜）；缺字段同样不猜", () => {
  const now = new Date("2026-09-29T12:00:00Z");
  for (const bad of ["不是时间", "", null, undefined]) {
    const pv = provenanceOf({ label: "x", path: "/repo/x", generated_at: bad, now });
    assert.equal(pv.age_hours, null, JSON.stringify(bad) + " 的 age 必须为 null");
    assert.equal(pv.stale, null, JSON.stringify(bad) + " 的 stale 必须为 null（不默认新鲜）");
  }
});

test("provenanceOf：易失路径 ⇒ volatile=true + warning 含路径与病根提示", () => {
  const pv = provenanceOf({ label: "x", path: "/tmp/foo/bar.json", source: "worktree", generated_at: new Date(), now: new Date() });
  assert.equal(pv.volatile, true);
  assert.match(pv.warning, /易失路径/);
  assert.match(pv.warning, /D1066 病根/);
});

test("provenanceSummary：ok 只在全部非易失时为真；三张清单逐条点名", () => {
  const now = new Date("2026-09-29T12:00:00Z");
  const okList = [provenanceOf({ label: "a", path: "/repo/a", generated_at: "2026-09-29T11:00:00Z", now })];
  assert.equal(provenanceSummary(okList).ok, true);
  const bad = [
    provenanceOf({ label: "a", path: "/tmp/a", generated_at: "2026-09-20T00:00:00Z", now }),
    provenanceOf({ label: "b", path: "/repo/b", generated_at: "不是时间", now })
  ];
  const sum = provenanceSummary(bad);
  assert.equal(sum.ok, false);
  assert.deepEqual(sum.volatile_paths, ["/tmp/a"]);
  assert.deepEqual(sum.stale_paths, ["/tmp/a"]);
  assert.deepEqual(sum.unknown_time_paths, ["/repo/b"]);
  assert.equal(provenanceSummary(null).ok, true, "空输入不炸");
});

test("readRepoJson/gitRead：坏 JSON 显式降级不抛；git 子命令失败返回 ok:false", async () => {
  const root = mkdtempSync(join(tmpdir(), "synova-rf-"));
  const abs = join(root, "docs/x.json");
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, "{ bad");
  const bad = await readRepoJson(root, "docs/x.json");
  assert.equal(bad.ok, false);
  assert.match(bad.error, /JSON 解析失败/);
  const gone = await readRepoJson(root, "docs/nope.json");
  assert.equal(gone.ok, false);
  assert.ok(gone.attempts.length >= 1, "两级取数必须记录每一级的失败原因");

  const g = await gitRead(root, ["rev-parse", "--show-toplevel"]);
  assert.equal(g.ok, false, "非 git 目录 ⇒ ok:false（不抛异常）");
  assert.match(g.error, /git rev-parse/);
});
