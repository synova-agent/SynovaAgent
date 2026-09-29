// lib/repofile.js — 仓库文件「工作区 → origin/main」二级取数（纯 Node，无 cordis 依赖 → 可 node --test）
//
// 为什么单独抽一个模块：D1060 的两个新面板要读 5 个数据源（宪章格子 / 账本 / 完成度 /
//   待规划 / PR 快照），若每个源各写一遍三级取数，必然出现「某个源忘了回退就静默空数据」
//   （D794 实测教训：只读工作区文件时，谁 checkout 了别的分支就「数据不通」）。
//   故把取数顺序收敛到**一处**，行为一致、可单测、可逐个源降级。
//
// 契约（铁律 47）：
//   @input   repoRoot: string — SynovaAgent 仓库根目录
//            relPath:  string — 仓库根相对路径（正斜杠）
//   @output  Promise<RepoFileResult>
//              成功 → { ok:true, source:"worktree"|"origin/main", ref:string,
//                       raw:string, parsed:unknown, fallback_note:string|null }
//              降级 → { ok:false, degraded:true, error:string, attempts:string[], path:string }
//   @取数顺序（二级，禁静默跳过）：
//     ① 工作区 <repoRoot>/<relPath>        → source="worktree"
//     ② 否则 git -C <repoRoot> show origin/main:<relPath> → source="origin/main"
//     ③ 两级都失败 → 显式 degraded，error 带上**每一级各自的失败原因**
//   @degraded 全程**不抛异常**（铁律 24/31）：坏 JSON 不直接判死（继续尝试第②级并记账）；
//             git 不可用/无 origin ref → 记录原因后降级，不猜测、不返回空对象冒充成功。
//   @write   零写入：只 readFile + 只读 git show。
//
// 注：本模块**不执行 git fetch** —— origin/main ref 的新鲜度依赖仓库既有 fetch 纪律
//     （铁律 0-3 开工前 git fetch --all / pre-push 门禁）。ref 不存在时如实降级。
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";

const execFileP = promisify(execFile);

/** git 回退时读取的权威分支（D334：main 是唯一真相）。 */
export const FALLBACK_REF = "origin/main";

function tryParse(raw) {
  try {
    return { ok: true, parsed: JSON.parse(raw) };
  } catch (err) {
    return { ok: false, error: `JSON 解析失败：${err?.message ?? err}` };
  }
}

/** ① 工作区文件。 */
async function readWorktree(repoRoot, relPath) {
  const abs = join(repoRoot, relPath);
  let raw;
  try {
    raw = await readFile(abs, "utf8");
  } catch (err) {
    const code = err?.code ?? "EIO";
    return {
      ok: false,
      error: code === "ENOENT" ? `工作区无 ${relPath}` : `工作区读取失败（${code}）：${err?.message ?? err}`
    };
  }
  const parsed = tryParse(raw);
  if (!parsed.ok) return { ok: false, error: `工作区 ${relPath} ${parsed.error}` };
  return { ok: true, ref: abs, raw, parsed: parsed.parsed };
}

/** ② git 权威回退：origin/main:<relPath>，只读 show。 */
async function readFallbackRef(repoRoot, relPath) {
  const ref = `${FALLBACK_REF}:${relPath}`;
  let stdout;
  try {
    const out = await execFileP("git", ["-C", repoRoot, "show", ref], {
      timeout: 10000,
      maxBuffer: 64 * 1024 * 1024
    });
    stdout = out.stdout;
  } catch (err) {
    const reason = String(err?.stderr ?? err?.message ?? err).trim().split("\n")[0] || "git show 失败";
    return { ok: false, error: `${FALLBACK_REF} 取数失败：${reason}` };
  }
  if (!stdout || stdout.trim() === "") {
    return { ok: false, error: `${FALLBACK_REF} 上的 ${relPath} 为空` };
  }
  const parsed = tryParse(stdout);
  if (!parsed.ok) return { ok: false, error: `${FALLBACK_REF} ${relPath} ${parsed.error}` };
  return { ok: true, ref, raw: stdout, parsed: parsed.parsed };
}

/**
 * 二级取数读取仓库内 JSON：工作区 → origin/main → 显式降级。
 * @param {string} repoRoot SynovaAgent 仓库根目录。
 * @param {string} relPath  仓库根相对路径。
 * @returns {Promise<{ok:true,source:string,ref:string,raw:string,parsed:unknown,fallback_note:string|null}|{ok:false,degraded:true,error:string,attempts:string[],path:string}>}
 */
export async function readRepoJson(repoRoot, relPath) {
  const attempts = [];

  const worktree = await readWorktree(repoRoot, relPath);
  if (worktree.ok) {
    return {
      ok: true,
      source: "worktree",
      ref: worktree.ref,
      raw: worktree.raw,
      parsed: worktree.parsed,
      fallback_note: null
    };
  }
  attempts.push(worktree.error);

  const fromGit = await readFallbackRef(repoRoot, relPath);
  if (fromGit.ok) {
    return {
      ok: true,
      source: FALLBACK_REF,
      ref: fromGit.ref,
      raw: fromGit.raw,
      parsed: fromGit.parsed,
      fallback_note: `${attempts[0]}；已回退 git 权威 ${FALLBACK_REF}`
    };
  }
  attempts.push(fromGit.error);

  return {
    ok: false,
    degraded: true,
    error: attempts.join("；"),
    attempts,
    path: join(repoRoot, relPath)
  };
}

/**
 * 只读执行一条 git 子命令（供 git log / remote 解析复用；不写盘、不 fetch）。
 * @param {string} repoRoot 仓库根。
 * @param {string[]} args git 参数（不含 `git` 本体）。
 * @returns {Promise<{ok:true,stdout:string}|{ok:false,error:string}>} 绝不抛异常。
 */
export async function gitRead(repoRoot, args, { timeout = 10000, maxBuffer = 32 * 1024 * 1024 } = {}) {
  try {
    const out = await execFileP("git", ["-C", repoRoot, ...args], { timeout, maxBuffer });
    return { ok: true, stdout: out.stdout };
  } catch (err) {
    const reason = String(err?.stderr ?? err?.message ?? err).trim().split("\n")[0] || "git 执行失败";
    return { ok: false, error: `git ${args.join(" ")} 失败：${reason}` };
  }
}

// ══ D1066「时效真」：来源/生成时间/陈旧/易失路径自检 ══════════════════════════
// 目的（派单 §一.3）：面板每块数据旁可见 **来源路径 + 生成时间 + 是否陈旧**；
//   且数据源一旦落在易失路径（/tmp、临时 worktree）⇒ **显式告警**，防 D1066 病根复发。
//
// 契约（铁律 47）：
//   @input  p: string（绝对或相对路径）｜generatedAt: string|Date|null｜now: Date
//   @output { path, generated_at, age_hours|null, stale: boolean|null, volatile: boolean, warning: string|null }
//   @degraded 时间不可解析 → age_hours=null / stale=null（UI 显「—」），**不猜 0、不默认新鲜**
//   @write 零写入（纯函数）

/** 易失路径黑名单（与 install-dashboards.sh 的来源黑名单同口径，防两条链各写一套）。 */
export const VOLATILE_PATH_RE = /(^|\/)(tmp|private\/tmp|var\/folders)(\/|$)|(^|\/)\.?synova-wt-/;

/**
 * 判断路径是否易失（会被清理的临时位置）。
 * @param {string} p
 * @returns {boolean}
 */
export function isVolatilePath(p) {
  return VOLATILE_PATH_RE.test(String(p ?? ""));
}

/** 陈旧阈值（小时）：超过即 UI 变灰并提示重生成。 */
export const STALE_AFTER_HOURS = 24;

/**
 * 组装一条来源说明（供每个数据块旁展示）。
 * @param {{label:string, path:string, source?:string|null, generated_at?:string|Date|null, now:Date, note?:string|null}} args
 * @returns {{label:string, path:string, source:string|null, generated_at:string|null, age_hours:number|null, stale:boolean|null, volatile:boolean, warning:string|null, note:string|null}}
 */
export function provenanceOf(args) {
  const now = args.now instanceof Date ? args.now : new Date();
  const raw = args.generated_at ?? null;
  let iso = null;
  let ageHours = null;
  if (raw instanceof Date) {
    iso = Number.isFinite(raw.getTime()) ? raw.toISOString() : null;
    ageHours = iso ? (now.getTime() - raw.getTime()) / 3600000 : null;
  } else if (typeof raw === "string" && raw.trim() !== "") {
    const t = Date.parse(raw);
    if (Number.isFinite(t)) {
      iso = new Date(t).toISOString();
      ageHours = (now.getTime() - t) / 3600000;
    } else {
      iso = raw; // 原样保留（人可读但不可解析），age 保持 null
    }
  }
  ageHours = ageHours === null ? null : Math.round(ageHours * 10) / 10;
  const p = String(args.path ?? "");
  const volatile = isVolatilePath(p);
  return {
    label: args.label,
    path: p,
    source: args.source ?? null,
    generated_at: iso,
    age_hours: ageHours,
    stale: ageHours === null ? null : ageHours > STALE_AFTER_HOURS,
    volatile,
    warning: volatile
      ? `数据源落在易失路径（${p}）—— /tmp 与临时 worktree 会被清理，清理后面板将读不到数据（D1066 病根）。请把来源指向主仓。`
      : null,
    note: args.note ?? null
  };
}

/**
 * 把多条 provenance 汇总成面板级自检（供顶端横幅）。
 * @param {Array<object>} list provenanceOf 结果数组
 * @returns {{ok:boolean, volatile_paths:string[], stale_paths:string[], unknown_time_paths:string[]}}
 */
export function provenanceSummary(list) {
  const arr = Array.isArray(list) ? list : [];
  return {
    ok: arr.every((x) => !x.volatile),
    volatile_paths: arr.filter((x) => x.volatile).map((x) => x.path),
    stale_paths: arr.filter((x) => x.stale === true).map((x) => x.path),
    unknown_time_paths: arr.filter((x) => x.stale === null).map((x) => x.path)
  };
}
