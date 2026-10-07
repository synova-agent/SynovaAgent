/**
 * src/tools/tool-registry.ts — D65 Tool 定义注册表 + D68 原子性验证（规范面）
 *
 * 🔴 2026-10-08（#985 / 施工项 0-11）: 本类的「执行 + 权限门禁」面**已拆除**。
 *    被拆的两半 = 原**权限引擎注入点**（旧 `:119`）与**工具执行入口**（旧 `:170`）——
 *    实测为**双重死门**：`git grep -n "tool-registry" -- src/ tests/ packages/`
 *    除本文件与自身测试外**零命中**（生产导入者 = 0）⇒ 该注入点与执行入口在**生产侧
 *    零装配、零调用** ⇒ 属「看着在、其实不拦」的假门
 *    ⇒ 按《施工单》0-11「**不留假门**」裁定 **选 (b)：删除**
 *    （连同审计回调、门禁专用类型与全局单例；被拆符号的实名见卡面 #985 与 git log）。
 *
 *    施工单原拟注释「门禁由 Goal 链路承载」**经实测不成立**（其载体
 *    `src/growth/goal-lifecycle.ts` 为 `@deprecated 未接线`，接入点 #1010）——
 *    此处按实测记录，不把假前提写进代码。
 *
 *    ⚠️ **「门禁」现状（2026-10-08 实测 + 独立复核；勿据此断言已有防护）**：
 *      · 工具执行面 `src/agent/tools.ts:186 execute()` 存在**条件**授权分支
 *        `:188-194`（`if (this._role)`）——但 `setRole()` 全仓**零调用方**（仅定义 `:140`；
 *        `_role` 初值 `null`、仅 `:141` 赋值；5 处生产实例化
 *        `conversation-engine.ts:413` / `bootstrap.ts:831` / `routes/conversations.ts:119,280`
 *        / `routes/diagnosis.ts:261` 均未设置）
 *        ⇒ **该分支在生产不可达**；「接通角色授权（角色来源 = 认证上下文）」属**新卡
 *          #1347**（《接通角色授权：`setRole()` 零调用 ⇒ 执行面授权分支不可达》，CTO 2026-10-08 立）
 *      · 角色授权表 `src/agent/tool-profiles.ts`（规则源在位）——其两个消费点
 *        `src/agent/tools.ts:170-171`（listTools 过滤）与 `:189-190`（execute 拒绝）
 *        **同属 `_role === null` 路径** ⇒ 当前**不构成生产授权**
 *      · 运行时守卫 `src/l3/tool-guard.ts`（接 `src/agent/tool-loop-executor.ts:38` / `:205` / `:351`）
 *        —— 循环/重复失败/参数校验，**可触达**（非授权门）
 *      · 写入门禁 施工项 2-4（#1052，`src/security/file-guard.ts`）—— **未开工**
 *
 *    若未来要做权威文档12 第五章 §六的三元组（role, dataLevel, SOI）逐次仲裁，属**新卡**：
 *    须先合并两套 `ToolRegistry`（旧注「Phase 2 考虑整合」即指该事）。
 *
 * 与 src/agent/tools.ts 的 ToolRegistry 不同：
 * 后者是对话引擎的工具系统（有 execute/toOpenAITools/executeParallel + 角色 profile 过滤），
 * 本类只做**工具定义注册 + 原子性验证** —— 权威文档12 第五章「Tool原子性定义（D68规范）」
 * 直接引用 `ToolRegistry.validateAtomicity()`，同章 §七记 34-tool 目录仍有 7 个 Tool 待建
 * ⇒ 本类为**规范载体**，故保留（不是假门）。
 *
 * 契约（铁律 47）:
 *   @input    — ToolDef（name / version / description / fn / inputSchema / outputType
 *               ＋ 原子性可选字段 contractId / hasTests / skills）
 *   @output   — register/get/unregister/list 返回定义或其状态；
 *               validateAtomicity(tool) ⇒ AtomicityResult { atomic, checks{...}, details[] }
 *   @degraded — **无**（纯内存 Map + 纯函数，不触 IO/DB ⇒ 无降级路径；铁律 24/31 不适用）
 *   @not-here — 执行与权限仲裁**不在本类**（见上方「门禁现状」：其中**授权分支当前不可达**）
 *
 * 设计原则:
 *   - 不改 D65 register/get 签名
 *   - validateAtomicity 纯函数 — 不依赖外部状态
 *   - 零 as any
 */

// ═══ Types ═══

/** 工具定义 — D65 基础 + D68 原子性字段 */
export interface ToolDef {
  name: string;
  version: string;
  description: string;
  /** 工具执行函数（接收 params 返回结果） */
  fn: (params: Record<string, unknown>) => unknown;
  /** 输入参数 schema（字段名 → 类型描述） */
  inputSchema: Record<string, string>;
  /** 输出类型描述 */
  outputType: string;
  // ── D68 原子性验证字段（可选） ──
  /** 契约 ID（如 COMPUTE-BREAK-EVEN-v1），用于原子性条件1 */
  contractId?: string;
  /** 是否可独立测试，用于原子性条件2 */
  hasTests?: boolean;
  /** 复用此工具的 Skill 名称列表，用于原子性条件3 */
  skills?: string[];
}

/** 原子性验证结果 */
export interface AtomicityResult {
  /** 是否通过全部 3 项检查 */
  atomic: boolean;
  /** 各项检查详情 */
  checks: {
    hasContract: boolean;
    hasTests: boolean;
    reusedByMultiple: boolean;
  };
  /** 未通过项的说明 */
  details: string[];
}

// ═══ Registry ═══

export class ToolRegistry {
  private tools = new Map<string, ToolDef>();

  /** 注册一个工具定义。同名时覆盖已有。 */
  register(tool: ToolDef): void {
    this.tools.set(tool.name, tool);
  }

  /** 按名称获取工具定义。不存在时返回 undefined。 */
  get(name: string): ToolDef | undefined {
    return this.tools.get(name);
  }

  /** 按名称注销工具。返回 true 表示实际删除。 */
  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  /** 返回全部已注册工具。 */
  list(): ToolDef[] {
    return [...this.tools.values()];
  }

  /**
   * 原子性验证 — 检查 3 项条件。
   *
   * 条件 1: 输入/输出契约明确（contractId 非空）
   * 条件 2: 可独立测试（hasTests === true）
   * 条件 3: 被至少 2 个 Skill 复用（skills.length >= 2）
   *
   * @param tool - 待验证的工具定义
   * @returns AtomicityResult — 每项检查的通过状态 + 说明
   *
   * 纯函数：输入确定则输出确定，不依赖外部状态。
   */
  static validateAtomicity(tool: ToolDef): AtomicityResult {
    const hasContract = typeof tool.contractId === 'string' && tool.contractId.length > 0;
    const hasTests = tool.hasTests === true;
    const reusedByMultiple = Array.isArray(tool.skills) && tool.skills.length >= 2;

    const details: string[] = [];
    if (!hasContract) details.push('缺少 contractId — 输入/输出契约不明确');
    if (!hasTests) details.push('hasTests 不为 true — 没有独立测试');
    if (!reusedByMultiple) {
      const count = Array.isArray(tool.skills) ? tool.skills.length : 0;
      details.push(`skills 引用数 (${count}) < 2 — 未被至少 2 个 Skill 复用`);
    }

    return {
      atomic: hasContract && hasTests && reusedByMultiple,
      checks: { hasContract, hasTests, reusedByMultiple },
      details,
    };
  }

  /**
   * 按 Skill 名称反向查询所有被该 Skill 复用的工具。
   *
   * @param skillName - Skill 名称（如 'analyze-break-even'）
   * @returns 被该 Skill 复用的工具列表
   */
  getToolsBySkill(skillName: string): ToolDef[] {
    return [...this.tools.values()].filter(
      t => Array.isArray(t.skills) && t.skills.includes(skillName),
    );
  }
}
