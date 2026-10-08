/**
 * extensions/sentinels/shared/computes/assert-finite-inputs.ts — 输入有效性检查（共享助手；#1408）
 *
 * 契约（铁律 47）:
 *   @input  input —— compute 的入参（`Record<string, unknown>` 或**行数组**）
 *           fields —— **该 compute 自己声明的**必需数值字段名（**需求声明必须手写**：只有本人知道它需要什么）
 *   @output string[] —— **问题清单**（`缺字段: x` / `非有限数: x=NaN` …）；无问题 ⇒ `[]`
 *   @invariant ① **不改返回值语义**（纯检查；不包装、不改调用方结果）
 *              ② **各 compute 显式调用** —— 本助手【不是】统一包装器（CTO 2026-10-08 裁 (c) 的边界）
 *              ③ **不抛异常**｜④ **不猜**（字段名由调用方给出，本助手不推断）
 *   @degraded 助手本身**不置 degraded**；由 compute 依清单**自行决定**（本批统一：有清单 ⇒ `degraded:true` + `warnings` 追加）
 *   @not-here 检查的**覆盖面**由"调用点扫描"判（见 `tests/sentinel/silent-wrong-value.test.ts` V3）——
 *             **清单不手写（会漂）；声明必须手写（只有本人知道）**
 */
export function checkFiniteInputs(
  input: Record<string, unknown> | Array<Record<string, unknown>>,
  fields: readonly string[],
): string[] {
  const rows: Array<Record<string, unknown>> = Array.isArray(input) ? input : [input];
  const issues: string[] = [];
  // #1408：**空数组不在此处报** —— 交回各 compute 自己的"无数据"守卫（**不改既有降级语义/消息**）
  if (rows.length === 0) return issues;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const where = Array.isArray(input) ? `#${i}.` : '';
    if (row === null || typeof row !== 'object') {
      issues.push(`${where}入参非对象`);
      continue;
    }
    for (const f of fields) {
      const v = (row as Record<string, unknown>)[f];
      if (v === undefined || v === null) {
        issues.push(`缺字段: ${where}${f}`);
        continue;
      }
      const n = typeof v === 'number' ? v : Number(v);
      if (!Number.isFinite(n)) {
        issues.push(`非有限数: ${where}${f}=${String(v)}`);
      }
    }
  }
  return issues;
}
