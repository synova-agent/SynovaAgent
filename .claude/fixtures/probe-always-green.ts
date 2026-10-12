#!/usr/bin/env npx tsx
/**
 * .claude/fixtures/probe-always-green.ts — **元层反证夹具**（判例 V-07）
 *
 * 用途: 证明「未实现必须 exit 2」这道门**真的在工作** —— 而不是"探针都写了，但没人验过门"。
 *
 * 判据来源: 卡面 §Q3 **V4**「反例（改坏必红）：把某探针改成"恒 exit 0" ⇒ `probe-contract.test.sh` 必红」
 *           ＋ 判例 **V-07**「假绿要用"拔掉实现照样通过"来证伪」
 *
 * 🔴 本件**是故意做坏的探针**，不是交付能力：
 *   · 它声明一个**根本不存在的目标件**（`.claude/fixtures/__definitely-absent__`)
 *   · 它**不检查**任何东西，恒印 `RESULT=PASS` 并 exit 0
 *   · ∴ 若 `probe-contract.test.sh` 判它**不是红** ⇒ 说明"未实现必 exit 2"的门失效 ⇒ **自测必须红**
 *
 * 🔴 它**不在** `probe-ladder.ts` 的 13 探针注册表内（防它污染 ladder 的清单与计数）。
 *   它只被 `tests/control-tower/probe-contract.test.sh` 消费。
 *
 * 契约 (铁律 47):
 *   @input    — 无（故意忽略全部参数 —— 这正是"恒绿"的病征）
 *   @output   — 恒 `RESULT=PASS`
 *   @degraded — **无降级分支**（本件不检查任何东西，故不存在降级路径）
 * 退出码: **恒 0**（故意的 —— 这就是要被判红的形态）
 */
export const KNOWN_CASES: readonly string[] = ['impossible'];

/** 目标件（**故意不存在** —— 用来暴露"不检查目标件就报绿"的假绿） */
const ABSENT_TARGET = '.claude/fixtures/__definitely-absent__/nope.ts';

export async function main(_argv: readonly string[] = []): Promise<0 | 1 | 2> {
  // 故意的病征：只"声明"目标，从不验证它存在
  console.log(`（夹具）声称已检查目标: ${ABSENT_TARGET}`);
  console.log('RESULT=PASS');
  return 0;
}

// 仅在直接执行时跑 CLI
if (process.argv[1] && /probe-always-green\.ts$/.test(process.argv[1])) {
  main().then(
    (code) => process.exit(code),
    (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`夹具自身异常: ${msg}`);
      process.exit(2);
    },
  );
}
