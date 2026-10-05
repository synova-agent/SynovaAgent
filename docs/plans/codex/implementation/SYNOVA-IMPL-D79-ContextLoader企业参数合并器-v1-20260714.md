# SynovaAgent — D79 ContextLoader企业参数合并器 实施方案 v1.0

> 2026-07-14 | 第12份权威文档（Skill-Tool体系研究）第三章 §6.2 + 本地自适应层
> 执行标准: Anthropic 工程纪律 · 铁律 0-2 (spec→test→impl→wire) · 五层架构 · 垂直切片
> **此文档为 claude code 的唯一执行依据。不依赖任何其他文档或口头记忆。**

---

## 执行约束（每次提交前必须回答的 5 问）

```
1. 接线检查: 新 export 谁调用？（grep 确认调用方存在）
2. 异常处理: 每个 catch 有 log + degraded？（铁律 24+31）
3. 类型安全: as any = 0？（铁律 38）
4. 测试覆盖: 测试有 expect() 断言？（铁律 48）
5. 残留清理: 有死代码吗？旧文件删了？旧函数还有引用？
```

---

## 当前状态（2026-07-14 审计确认）

- D65: Skill/Tool注册中心 ✅
- D66: 41个内置Skill清单 ✅
- D67: Playbook加载器 ✅
- D68: Tool原子化验证 ✅
- D58: PROMPT.md文件驱动 ✅
- D69: expert-prompts.ts降级 ✅
- ContextLoader代码: **零存在** — 全部新建
- 第12份权威文档 §6.2 定义了企业参数覆盖表机制——Synova相对于Hermes的核心创新
- 第14份权威文档 Phase 2e CycleLoader同样需要ContextLoader合并企业参数

---

## 做了什么

### 1. src/growth/context-loader.ts — ContextLoader核心（新建）

```typescript
class ContextLoader {
  constructor(enterpriseId: string)
  
  // 加载企业参数覆盖表
  loadEnterpriseOverrides(): EnterpriseOverrides
  // 从 extensions/skills/custom/{enterpriseId}/overrides.json 读取
  // 降级: 文件不存在→返回空覆盖表 + degraded:true
  
  // 合并参数: 行业基准 → 企业覆盖 → 最终执行参数
  merge(industryBaseline: Record<string, unknown>): Record<string, unknown>
  // 覆盖规则: 企业参数覆盖行业同名参数，类型校验，无效覆盖→log.warn+跳过
  
  // 加载行业基准
  loadIndustryBaseline(industry: string): Record<string, unknown> | null
  // 从 extensions/industries/{sector}/thresholds.json 读取
  
  // 热更新: 修改覆盖表后重新加载
  reload(): void
  // 调用此方法后下次 merge 使用新覆盖参数
}
```

**企业参数覆盖表格式**（`extensions/skills/custom/{enterpriseId}/overrides.json`）:
```json
{
  "enterpriseId": "wowbaby",
  "thresholdOverrides": {
    "cash-runway-months": { "critical": 45, "warning": 90 },
    "customer-concentration": { "critical": 0.40 }
  },
  "skillOverrides": {
    "diagnose-cashflow-health": {
      "timeout": 45,
      "disabledSteps": []
    }
  },
  "computeOverrides": {
    "COMPUTE-DOL-v1": { "fixedCostRatioWarning": 0.60 }
  },
  "cycleOverrides": {
    "customer-cycle": {
      "newStoreInvestment": 300000,
      "reinvestmentRatio": 0.6
    }
  }
}
```

### 2. src/growth/context-loader.ts — 降级路径（铁律24+31）

- 企业覆盖表文件不存在 → 返回空覆盖表 + log.warn + degraded:true
- 覆盖表JSON解析失败 → 返回空覆盖表 + log.error + degraded:true
- 行业基准文件不存在 → 返回null（调用方使用系统默认值）
- 覆盖参数类型与行业基准不一致 → log.warn + 跳过该参数（不中断整体合并）
- 覆盖参数值超出合理范围 → clamp + log.warn + warnings[]

### 3. ContextLoader集成点

**Skill执行前**: SkillLoader → ContextLoader.merge(enterpriseId) → 注入执行上下文 → 专家执行
**哨兵阈值本地化**: SentinelLoader → ContextLoader合并企业阈值 → SentinelConfig.thresholds覆盖
**循环配置**: CycleLoader(D88 Phase 2e) → ContextLoader合并企业循环参数 → 注册到CycleRegistry
**启动序列**: Phase 2e 在 CycleLoader注册前调用 ContextLoader.loadEnterpriseOverrides()

---

## 不做什么

- 不修改 SentinelLoader/SkillLoader/PlaybookLoader核心
- 不修改 D66 的41个Skill manifest
- 不创建企业覆盖表示例文件（MVS阶段D85创建客户A示例）
- 不实现双层进化（联邦/本地）的自动推荐——那是后续研究任务

---

## 架构层

L4（本体层: `src/growth/context-loader.ts`）+ L2（编排层: 被各Loader调用）

---

## 实施优先级

| 顺序 | 步骤 | 工时 | 文件 |
|:---:|-------|:---:|------|
| 1 | context-loader.ts | 2h | ContextLoader类完整实现 |
| 2 | 降级路径 | 0.5h | 5条降级分支 |
| 3 | 测试文件 | 1.5h | tests/growth/context-loader.test.ts |

**总工时: 4h（半天）**

---

## 完成标准

```
[ ] context-loader.ts: loadEnterpriseOverrides — 从extensions/skills/custom/{id}/overrides.json读取
[ ] context-loader.ts: merge — 行业基准 × 企业覆盖 × 类型校验 = 最终参数
[ ] context-loader.ts: loadIndustryBaseline — 从extensions/industries/读取
[ ] context-loader.ts: reload — 清空缓存 + 重新加载
[ ] 降级1: 覆盖表不存在→空覆盖表 + degraded
[ ] 降级2: JSON解析失败→空覆盖表 + log.error + degraded
[ ] 降级3: 类型不匹配→log.warn + 跳过该参数
[ ] 降级4: 值超出范围→clamp + warnings[]
[ ] 降级5: 行业基准不存在→返回null
[ ] zero as any
[ ] npx tsc --noEmit 零新增错误
[ ] npx vitest run --changed 零新增失败
[ ] >=10测试: 正常合并5(覆盖/类型校验/基准/null覆盖表/全部缺失) + 降级5(不存在/解析失败/类型/范围/null基准)
```

---

## 权威文档引用

- 第12份权威文档: Skill-Tool体系研究 第三章 §6.2（企业参数覆盖表 + ContextLoader）
  - 补充修正: 文件驱动架构升级 — manifest.json Schema + 加载器
  - 本地自适应层设计: 三层参数覆盖（全局→行业→企业）
- 第14份权威文档: 系统集成与实施路线图 Phase 2e（CycleLoader依赖ContextLoader合并企业循环参数）
- 第15份权威文档: 企业循环溢出导航系统 §2.5（同一行业不同商业模式的差异化参数覆盖表）