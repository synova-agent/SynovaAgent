/**
 * rules.mjs — issue policy 的纯规则层（零 I/O、零第三方依赖、可直接单测）
 *
 * 契约（铁律 47）:
 *   @input   evaluate({ pr, config, issues })
 *              · pr     — 归一化或原始 PR 对象；至少可含 { number, title, body, labels, isDraft, html_url }
 *              · config — 已解析的 config.json（缺失时调用方须先补默认，见 policy.mjs）
 *              · issues — 可选：{ "<issue号>": { labels: [...] } }，仅当 linkedIssueLabels.enabled 时消费
 *   @output  { findings: Finding[], summary: Summary }
 *              · Finding = { rule, severity, message, fix, evidence }
 *              · severity ∈ "block" | "warn"（语义 = "若执法则阻断" / "仅提示"）
 *              · Summary = { block, warn, total, degraded, degradedReasons, draft, exempted }
 *   @degraded  输入缺关键字段（pr/body/labels 非预期类型）⇒ 不抛异常，记入
 *              summary.degraded + degradedReasons[]（铁律 11/24: 不静默降级）
 *   @never-throws 纯函数保证：任何输入都返回结构化结果，绝不 throw
 *   @pure      不读文件、不发网络、不读环境变量 —— 便于 node --test 直测
 */

/** 规则求值顺序（输出稳定，便于断言逐字节一致） */
export const RULE_ORDER = [
  "linkedIssue",
  "typeLabel",
  "priorityLabel",
  "areaLabel",
  "requiredSections",
  "placeholderLeft",
  "linkedIssueLabels",
];

/** 标签归一化: 支持 ["a"], [{name:"a"}], 或混合；非法项丢弃 */
function normalizeLabels(raw) {
  if (!Array.isArray(raw)) return { labels: [], bad: raw !== undefined && raw !== null };
  const out = [];
  for (const item of raw) {
    if (typeof item === "string") out.push(item);
    else if (item && typeof item === "object" && typeof item.name === "string") out.push(item.name);
  }
  return { labels: out, bad: false };
}

/** PR 归一化: 缺字段按空值参与判定，并回报 degraded 原因 */
export function normalizePr(pr) {
  const reasons = [];
  const src = pr && typeof pr === "object" ? pr : null;
  if (!src) reasons.push("pr 缺失或非对象");

  const title = typeof src?.title === "string" ? src.title : "";
  const bodyRaw = src?.body;
  const body = typeof bodyRaw === "string" ? bodyRaw : "";
  if (bodyRaw !== undefined && bodyRaw !== null && typeof bodyRaw !== "string") {
    reasons.push("pr.body 非字符串");
  }
  if (bodyRaw === undefined || bodyRaw === null) reasons.push("pr.body 缺失");

  const { labels, bad } = normalizeLabels(src?.labels);
  if (bad) reasons.push("pr.labels 非数组");
  else if (!Array.isArray(src?.labels)) reasons.push("pr.labels 缺失");

  return {
    number: typeof src?.number === "number" ? src.number : null,
    title,
    body,
    labels,
    isDraft: src?.isDraft === true,
    url: typeof src?.html_url === "string" ? src.html_url : "",
    degradedReasons: reasons,
  };
}

/** 引用提取: 返回去重后的 issue 号字符串数组（保持出现顺序） */
export function collectIssueRefs(text, acceptPatterns) {
  const found = [];
  const seen = new Set();
  for (const p of acceptPatterns) {
    let re;
    try {
      re = new RegExp(p, "g");
    } catch {
      continue; // 非法配置正则 → 跳过该模式（不抛；配置错误由单测/CI 配置校验兜）
    }
    for (const m of String(text).matchAll(re)) {
      const num = m[2] !== undefined ? m[2] : m[1];
      if (num && !seen.has(num)) {
        seen.add(num);
        found.push(num);
      }
    }
  }
  return found;
}

/**
 * 逐条规则求值。每条规则返回 Finding | null（null = 通过或被豁免）。
 * 规则签名统一为 (ctx) => Finding | null，便于逐条单测。
 */
export const RULES = {
  linkedIssue(ctx) {
    const { pr, rule } = ctx;
    if (!rule.enabled) return null;
    const refs = collectIssueRefs(`${pr.title}\n${pr.body}`, rule.acceptPatterns);
    if (refs.length >= (rule.minRefs ?? 1)) return null;
    return {
      rule: "linkedIssue",
      severity: rule.severity,
      message: `${rule.message}（要求 ≥${rule.minRefs ?? 1} 条，实测 0 条）`,
      fix: rule.fix,
      evidence: `title+body 长度=${pr.title.length + pr.body.length}`,
    };
  },

  typeLabel(ctx) {
    const { pr, rule } = ctx;
    if (!rule.enabled) return null;
    const hits = pr.labels.filter((l) => l.startsWith(rule.prefix));
    const known = hits.filter((l) => (rule.allowed || []).includes(l));
    if (known.length === 1 && hits.length === 1) return null;
    if (hits.length === 0) {
      return {
        rule: "typeLabel",
        severity: rule.severity,
        message: rule.message,
        fix: rule.fix,
        evidence: `现有标签=[${pr.labels.join(", ")}]`,
      };
    }
    return {
      rule: "typeLabel",
      severity: rule.severity,
      message: `kind/* 标签数量或取值不合规（命中 ${hits.length} 个：${hits.join(", ")}）`,
      fix: rule.fix,
      evidence: `允许值=[${(rule.allowed || []).join(", ")}]`,
    };
  },

  priorityLabel(ctx) {
    const { pr, rule } = ctx;
    if (!rule.enabled) return null;
    const hits = pr.labels.filter((l) => (rule.allowed || []).includes(l));
    if (hits.length >= 1) return null;
    return {
      rule: "priorityLabel",
      severity: rule.severity,
      message: rule.message,
      fix: rule.fix,
      evidence: `现有标签=[${pr.labels.join(", ")}]`,
    };
  },

  areaLabel(ctx) {
    const { pr, rule } = ctx;
    if (!rule.enabled) return null;
    if (pr.labels.some((l) => l.startsWith(rule.prefix))) return null;
    return {
      rule: "areaLabel",
      severity: rule.severity,
      message: rule.message,
      fix: rule.fix,
      evidence: `现有标签=[${pr.labels.join(", ")}]`,
    };
  },

  requiredSections(ctx) {
    const { pr, rule } = ctx;
    if (!rule.enabled) return null;
    const missing = (rule.sections || []).filter((s) => !new RegExp(`^#{1,6}\\s*${escapeRe(s)}`, "m").test(pr.body));
    if (missing.length === 0) return null;
    return {
      rule: "requiredSections",
      severity: rule.severity,
      message: `${rule.message}：缺 ${missing.join(" / ")}`,
      fix: rule.fix,
      evidence: `正文长度=${pr.body.length}`,
    };
  },

  placeholderLeft(ctx) {
    const { pr, rule } = ctx;
    if (!rule.enabled) return null;
    const hit = (rule.markers || []).filter((m) => pr.body.includes(m));
    if (hit.length === 0) return null;
    return {
      rule: "placeholderLeft",
      severity: rule.severity,
      message: `${rule.message}（${hit.length} 处）`,
      fix: rule.fix,
      evidence: `命中占位=${hit.map((h) => JSON.stringify(h.slice(0, 18) + "…")).join(", ")}`,
    };
  },

  linkedIssueLabels(ctx) {
    const { pr, rule, issues, refs } = ctx;
    if (!rule.enabled) return null;
    if (!issues || typeof issues !== "object") {
      return {
        rule: "linkedIssueLabels",
        severity: "warn",
        message: "规则已启用但未提供 issues 数据源（跳过判定并显式登记）",
        fix: "为 workflow 补 `issues: read` 并按引用号取回 Issue 标签后重跑",
        evidence: "issues=undefined",
      };
    }
    const bad = [];
    for (const num of refs) {
      const meta = issues[num];
      if (!meta) {
        bad.push(`#${num}(元数据缺失)`);
        continue;
      }
      const lbl = normalizeLabels(meta.labels).labels;
      const hasType = lbl.some((l) => l.startsWith("kind/"));
      const hasPrio = lbl.some((l) => ["p0", "p1", "p2", "p3"].includes(l));
      if (!hasType || !hasPrio) bad.push(`#${num}(kind=${hasType} prio=${hasPrio})`);
    }
    if (bad.length === 0) return null;
    return {
      rule: "linkedIssueLabels",
      severity: rule.severity,
      message: `${rule.message}：${bad.join(", ")}`,
      fix: rule.fix,
      evidence: `引用号=[${refs.join(", ")}]`,
    };
  },
};

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** 主入口: 见文件头契约 */
export function evaluate(input = {}, config = {}) {
  const pr = normalizePr(input.pr);
  const rules = config.rules || {};
  const draftExempt = new Set(config.draftExemptRules || []);

  const refs = collectIssueRefs(`${pr.title}\n${pr.body}`, rules.linkedIssue?.acceptPatterns || []);
  const ctxBase = { pr, config, issues: input.issues, refs };
  const exempted = [];
  const findings = [];

  for (const name of RULE_ORDER) {
    const rule = rules[name];
    if (!rule || rule.enabled === false) continue;
    if (pr.isDraft && draftExempt.has(name)) {
      exempted.push(name);
      continue;
    }
    const fn = RULES[name];
    if (typeof fn !== "function") continue;
    const finding = fn({ ...ctxBase, rule });
    if (finding) findings.push({ ...finding, severity: finding.severity || "warn" });
  }

  const summary = {
    block: findings.filter((f) => f.severity === "block").length,
    warn: findings.filter((f) => f.severity === "warn").length,
    total: findings.length,
    degraded: pr.degradedReasons.length > 0,
    degradedReasons: pr.degradedReasons,
    draft: pr.isDraft,
    exempted,
  };
  return { findings, summary };
}
