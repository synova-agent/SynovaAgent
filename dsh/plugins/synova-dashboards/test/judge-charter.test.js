// test/judge-charter.test.js — 宪章判据执行器（judge-charter.mjs）行为测试
// 覆盖：ready+exit0→green / ready+exit≠0→red / todo→empty(⚪) / 映射缺失→empty /
//       命令超时→red / dry-run 不写盘 / 幂等 / counts.filled = green+red
// 铁律 48：非空壳，每条路径都有真实断言（含降级与边界）。
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "../scripts/judge-charter.mjs");
const CHARTER_REL = "docs/synova/coordination/宪章三问-48格.json";
const MAP_REL = "docs/synova/coordination/charter-judge-map.json";

/** 造一个最小仓库夹具：2 个扩展点 × 4 问。 */
function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), "synova-judge-"));
  const cells = [];
  let n = 0;
  for (const [layer, ext] of [["对象层", "甲"], ["判据层", "乙"]]) {
    for (const [q, text] of [["q1", "加了吗"], ["q2", "接上了吗"], ["q3", "生效了吗"], ["q4", "删了吗"]]) {
      n += 1;
      cells.push({ id: "C" + String(n).padStart(2, "0"), layer, ext_point: ext, question: q, question_text: text, status: "empty" });
    }
  }
  const write = (rel, obj) => {
    const abs = join(root, rel);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, JSON.stringify(obj, null, 2) + "\n", "utf8");
  };
  write(CHARTER_REL, { schema: "charter-three-questions/1.0", counts: { cells: 8, ext_points: 2, questions: 4, filled: 0 }, cells });
  write(MAP_REL, {
    schema: "charter-judge-map/1",
    convention: { exit0: "green", nonzero: "red", todo: "empty" },
    probes: [
      {
        layer: "对象层", ext_point: "甲",
        q1: { state: "ready", cmd: "true", basis: "恒真（存在性成立）" },
        q2: { state: "ready", cmd: "false", basis: "恒假（无生产调用点）" },
        q3: { state: "todo", cmd: "", todo_reason: "缺穿入口用例证据" },
        q4: { state: "ready", cmd: "test -f ./present.txt", basis: "删除演练记录存在" }
      },
      {
        layer: "判据层", ext_point: "乙",
        q1: { state: "ready", cmd: "sleep 5", basis: "会超时的判据" },
        q2: { state: "todo", cmd: "", todo_reason: "待映射" },
        q3: { state: "todo", cmd: "", todo_reason: "待映射" },
        q4: { state: "todo", cmd: "", todo_reason: "待映射" }
      }
    ]
  });
  return root;
}

function run(root, extraArgs = []) {
  return execFileSync("node", [SCRIPT, "--repo-root", root, "--timeout-ms", "1000", ...extraArgs], {
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"]
  });
}
const readCharter = (root) => JSON.parse(readFileSync(join(root, CHARTER_REL), "utf8"));
const byId = (doc, id) => doc.cells.find((c) => c.id === id);

test("判据执行器：ready+exit0 → green；ready+exit≠0 → red；todo → empty（⚪ 不折算成绿）", () => {
  const root = makeRepo();
  writeFileSync(join(root, "present.txt"), "ok");
  run(root);
  const doc = readCharter(root);
  assert.equal(byId(doc, "C01").status, "green", "q1 恒真 ⇒ green");
  assert.equal(byId(doc, "C02").status, "red", "q2 恒假 ⇒ red");
  assert.equal(byId(doc, "C03").status, "empty", "todo ⇒ empty");
  assert.equal(byId(doc, "C03").judge_state, "todo");
  assert.match(byId(doc, "C03").judgement, /缺穿入口用例证据/);
  assert.equal(byId(doc, "C04").status, "green", "文件存在 ⇒ green");
  // 超时 → red（不静默、不判绿）
  assert.equal(byId(doc, "C05").status, "red", "超时必须判红");
  assert.match(byId(doc, "C05").evidence, /exit=124|超时/);
  // 计数口径
  assert.equal(doc.counts.filled, doc.cells.filter((c) => c.status !== "empty").length);
  // C01 green + C04 green + C02 red + C05 red = 4；C03/C06/C07/C08 保持 ⚪
  const greens = doc.cells.filter((c) => c.status === "green").map((c) => c.id).sort();
  const reds = doc.cells.filter((c) => c.status === "red").map((c) => c.id).sort();
  assert.deepEqual(greens, ["C01", "C04"]);
  assert.deepEqual(reds, ["C02", "C05"]);
  assert.equal(doc.counts.filled, 4, "green(2) + red(2)");
  assert.equal(doc.counts.cells, 8);
  assert.ok(doc.judged_by.includes("judge-charter.mjs"));
});

test("判据执行器：已填格必须带 judge_cmd + evidence；空格必须带 judge_state + 待办理由", () => {
  const root = makeRepo();
  writeFileSync(join(root, "present.txt"), "ok");
  run(root);
  const doc = readCharter(root);
  for (const c of doc.cells) {
    assert.ok(c.judge_state === "ready" || c.judge_state === "todo", c.id + " 必须带 judge_state");
    if (c.status !== "empty") {
      assert.ok(c.judge_cmd && c.judge_cmd.length > 0, c.id + " 已填格必须有 judge_cmd（可复跑）");
      assert.match(c.evidence, /^exit=\d+/, c.id + " 已填格必须有执行证据");
      assert.ok(c.judgement.length > 0, c.id + " 必须有判词");
      assert.equal(c.checked_by, "judge-charter.mjs@D1066");
    } else {
      assert.equal(c.judge_cmd, "", c.id + " 空格不得带可执行判据（避免误跑成绿）");
      assert.ok(c.judgement.length > 0, c.id + " 空格必须写明待办理由");
    }
  }
});

test("判据执行器：--dry-run 不写盘（文件逐字节不变）", () => {
  const root = makeRepo();
  const before = readFileSync(join(root, CHARTER_REL), "utf8");
  const out = run(root, ["--dry-run"]);
  assert.match(out, /\[dry-run\] ready=\d+ green=\d+ red=\d+ empty=\d+/);
  assert.equal(readFileSync(join(root, CHARTER_REL), "utf8"), before, "dry-run 必须零写入");
});

test("判据执行器：映射缺该格 ⇒ empty + 显式理由（不默认红也不默认绿）", () => {
  const root = makeRepo();
  const map = JSON.parse(readFileSync(join(root, MAP_REL), "utf8"));
  map.probes = map.probes.filter((p) => p.ext_point !== "乙"); // 整点从映射里拿掉
  writeFileSync(join(root, MAP_REL), JSON.stringify(map, null, 2));
  writeFileSync(join(root, "present.txt"), "ok");
  run(root);
  const doc = readCharter(root);
  for (const id of ["C05", "C06", "C07", "C08"]) {
    assert.equal(byId(doc, id).status, "empty", id + " 映射缺失 ⇒ 未填");
    assert.match(byId(doc, id).judge_basis, /映射缺失/);
  }
});

test("判据执行器：幂等（连跑两次结果一致，除 checked_at 时间字段）", () => {
  const root = makeRepo();
  writeFileSync(join(root, "present.txt"), "ok");
  run(root);
  const a = readCharter(root);
  run(root);
  const b = readCharter(root);
  const strip = (d) => JSON.stringify(Object.assign({}, d, { judged_at: null }));
  assert.equal(strip(a), strip(b), "同仓库状态 ⇒ 同结论");
});

test("判据执行器：重复的 (layer, ext_point) 映射 ⇒ 显式报错退出（不猜用哪条）", () => {
  const root = makeRepo();
  const map = JSON.parse(readFileSync(join(root, MAP_REL), "utf8"));
  map.probes.push(JSON.parse(JSON.stringify(map.probes[0])));
  writeFileSync(join(root, MAP_REL), JSON.stringify(map, null, 2));
  assert.throws(() => run(root), (err) => {
    assert.match(String(err.stderr ?? err.message), /judge-map 重复项/);
    return true;
  });
});
