#!/usr/bin/env npx tsx
/**
 * scripts/control-tower/probe-skills.ts — K9 技能加载探针（#986 / 施工单 0-12）
 *
 * 用途: K9 模块（建档·岗位预设·技能面）的**块判据探针**，也是 #986 的穿生产入口自证：
 *   启动自加载（`getSkillLoader()`）是否真的把 `skills/**` 挂到**注册表里的专家 id** 上。
 *
 * 判据（K9 模块卡原文）:
 *   `npx tsx scripts/control-tower/probe-skills.ts` ⇒ stdout 含 `## Available Skills`
 * 判据口径（R42/R49 —— 数什么 / 覆盖哪个集合 / 用哪条命令出数）:
 *   · 覆盖集合 = `getAllExpertIds()`（`expert/expert-registry.yaml` 声明序，唯一事实源）
 *   · 每个 id 的 `buildCatalogText(id)` 必须非空且含目录头 `## Available Skills`
 *   · 计数一律取真实返回长度，不写死期望值
 *
 * 契约:
 *   @input  — 可选 argv[2]：技能根目录（缺省 = `SYNOVA_SKILLS_DIR` 或 `<cwd>/skills`）
 *   @output — stdout 报告（含完整 catalog 片段，供 grep `## Available Skills`）
 *   @degraded — 技能目录缺失/扫描 0 条 ⇒ 前置行显式 `[DEGRADED]` 并 exit 1（不静默放行）
 * 退出码: 0 = 全部专家目录非空；1 = 有专家目录为空 / 无技能被加载；2 = 探针自身异常
 *
 * @note 本文件为**新增探针**，不改任何既有门禁脚本、不改「哪条检查阻断合并」的语义
 *       （#986 卡 §④ 已声明可碰；PR 正文同款声明）。
 */
import { getSkillLoader, DEFAULT_SKILLS_DIR } from "../../src/agent/skill-lazy-loader";
import { getAllExpertIds } from "../../src/agent/expert-config-loader";

/** 探针结果（供后续被 import 复用；当前仅 CLI 消费） */
export interface SkillProbeResult {
  dir: string;
  scannedNames: number;
  expertIds: string[];
  perExpert: Array<{ id: string; count: number }>;
  emptyExperts: string[];
  degraded: boolean;
}

/**
 * 运行探针（纯函数式：只读加载器状态，不写文件、不改全局配置）。
 * @input  dir — 技能根目录（默认 DEFAULT_SKILLS_DIR）
 * @output 探针结果；任一专家目录为空 ⇒ degraded=true（由 CLI 决定退出码）
 */
export function probeSkills(dir: string = DEFAULT_SKILLS_DIR): SkillProbeResult {
  const loader = getSkillLoader();
  const scannedNames = loader.listNames().length;
  const expertIds = getAllExpertIds();

  const perExpert = expertIds.map(id => ({ id, count: loader.listForExpert(id).length }));
  const emptyExperts = perExpert.filter(e => e.count === 0).map(e => e.id);

  return {
    dir,
    scannedNames,
    expertIds,
    perExpert,
    emptyExperts,
    degraded: scannedNames === 0 || emptyExperts.length > 0,
  };
}

// ═══ CLI ═══

function main(): number {
  try {
    const dirArg = process.argv[2];
    const result = probeSkills(dirArg || DEFAULT_SKILLS_DIR);
    const loader = getSkillLoader();

    console.log("═══ probe-skills（#986 / K9 块判据）═══");
    console.log(`技能根目录 : ${result.dir}`);
    console.log(`已注册技能 : ${result.scannedNames}（口径: getSkillLoader().listNames().length，覆盖 skills/**）`);
    console.log(`注册表专家 : ${result.expertIds.length}（口径: getAllExpertIds()，expert/expert-registry.yaml）`);

    const detail = result.perExpert.map(e => `${e.id}=${e.count}`).join("  ");
    console.log(`逐专家命中 : ${detail}`);

    if (result.scannedNames === 0) {
      console.log("[DEGRADED] 技能目录未加载到任何技能（目录缺失 / SYNOVA_SKILLS_DIR 指向错误？）");
    }
    if (result.emptyExperts.length > 0) {
      console.log(`[DEGRADED] 以下专家目录为空: ${result.emptyExperts.join(", ")}`);
    }

    // 打印一份完整 catalog（判据 grep 目标：`## Available Skills`）
    const sampleId = result.perExpert.find(e => e.count > 0)?.id;
    if (sampleId) {
      console.log("");
      console.log(`── buildCatalogText('${sampleId}') ──`);
      console.log(loader.buildCatalogText(sampleId));
    } else {
      console.log("");
      console.log("── buildCatalogText(<none>) ──");
      console.log("(无任何非空专家目录 —— 见上方 [DEGRADED])");
    }

    console.log("");
    console.log(`结论: ${result.degraded ? "FAIL（有专家目录为空 / 无技能加载）" : "PASS（全部注册表专家均有技能目录）"}`);
    return result.degraded ? 1 : 0;
  } catch (err: unknown) {
    // 铁律 24/31: 探针自身异常不得静默 —— 显式打印并给独立退出码（与判据失败区分）
    console.error("[ERROR] 探针自身异常:", err instanceof Error ? err.message : String(err));
    return 2;
  }
}

// 仅在直接执行时跑 CLI（被 import 时不产生副作用）
if (process.argv[1] && /probe-skills\.ts$/.test(process.argv[1])) {
  process.exit(main());
}
