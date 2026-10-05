#!/bin/bash
# D313 M5 UTF-8 强制: Windows 控制台/子进程统一 UTF-8
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════════════════════
# gen-system-registry.sh — 结构化 ID/计数寄存器生成器（D782 / K3 §10.1 规格）
#
# 解决的问题（K3 P0-02）: 42 条边 ID 无唯一权威来源——全仓零个机器可读的
#   E-NN → 名称/硬度/覆盖率 定义文件；现有门禁只校验格式+范围，语义错位恒绿
#   （compute-map-consistency 7/7 通过但 E-11 一码三义）。本脚本从权威文档01
#   第四章（边节点映射矩阵）抽取生成 docs/authority/system-registry.json。
#
# 契约（铁律 47 契约优先）:
#   @input  — AD01 第四章 md（generatedFrom 锚定）; DOC_TRUTH_ROOT 覆盖仓库根（测试用）
#   @output — docs/authority/system-registry.json:
#             schemaVersion / generatedFrom / generatedBy / generatedAtCommit /
#             edges[{id,name,group,hardness,coverage,coveragePct,authorityRef}] /
#             counters{sentinelDirs,computeFiles,skillDirs,playbookYaml,experts}
#             （counters 由 derivedBy 命令实时实测——K3 §12b.4 多口径原则：每个
#              counter 自带 scope 声明，不压平语义；compute 多口径留 TODO 注释）
#   @exit   — 0 = 生成成功; 1 = 源文档缺失/零边抽取（业务失败）; 2 = 执行降级（D328 三态）
#   @degraded — python3 不可用 / git 不可用（generatedAtCommit 置 null 并 stderr 提示）
#
# 关键约束（K3 §10.1）: 必须由生成器产出，禁止手编——generatedBy/generatedAtCommit
#   两字段为空即判「手编嫌疑」（防手编伪造）。
#   ⚠️ D1149（2026-10-05）更正: 原句为「两字段为空时 verify-system-registry.sh 判红」——
#   该校验器已按「零调用方」退役（无 ci.yml 登记 / 无 pre-commit 接线 / 无脚本调用）
#   ⇒ 该判定当前**无执行体**。生成器自身仍强制写这两字段；接线与否见 #1046 批 4「另开卡」。
# ═══════════════════════════════════════════════════════════════════════════════
set +e
ROOT="${DOC_TRUTH_ROOT:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}" # swallow-ok:
OUT="$ROOT/docs/authority/system-registry.json"

PYBIN=""
for _c in python3 python py; do
  if command -v "$_c" >/dev/null 2>&1 && "$_c" -c "import sys" >/dev/null 2>&1; then PYBIN="$_c"; break; fi
done
if [ -z "$PYBIN" ]; then
  echo "degraded: python3 不可用，无法生成寄存器（D328 exit 2）" >&2
  exit 2
fi

# 源文档锚定：AD01 第四章（glob 兼容目录名后缀变化）
SRC=$(ls "$ROOT"/docs/synova/research/权威文档01-*/SYNOVA-RESEARCH-第四章-边节点映射矩阵-*.md 2>/dev/null | head -1) # swallow-ok: 无匹配=业务失败走 exit 1
if [ -z "$SRC" ]; then
  echo "❌ 未找到权威文档01 第四章（边节点映射矩阵）——寄存器源缺失" >&2
  exit 1
fi
REL_SRC="${SRC#"$ROOT"/}"

# git 锚点（不可用 → null + degraded 提示，不静默）
GIT_SHA=$(git -c safe.directory="$ROOT" -C "$ROOT" rev-parse HEAD 2>/dev/null || echo "") # swallow-ok:
GIT_DEGRADED=0
if [ -z "$GIT_SHA" ]; then
  GIT_DEGRADED=1
  echo "⚠️ degraded: git 不可用，generatedAtCommit=null（verify 将判红——K3 §10.1 禁手编）" >&2
fi

# ── counters 实测（derivedBy 即命令本身；scope 声明防口径压平——K3 §12b.4）──
SENTINEL_DIRS=$(find "$ROOT/extensions/sentinels" -maxdepth 1 -type d 2>/dev/null | tail -n +2 | grep -vE '_extinct|/shared$' | wc -l | tr -d ' ') # swallow-ok:
COMPUTE_FILES=$(find "$ROOT/extensions/sentinels" -path '*computes*' -name '*.ts' 2>/dev/null | grep -v '\.test\.' | wc -l | tr -d ' ') # swallow-ok:
SKILL_DIRS=$(find "$ROOT/extensions/skills/builtin" -maxdepth 1 -type d 2>/dev/null | tail -n +2 | wc -l | tr -d ' ') # swallow-ok:
PLAYBOOK_YAML=$(find "$ROOT/extensions/playbooks" -name '*.yaml' 2>/dev/null | wc -l | tr -d ' ') # swallow-ok:
EXPERTS=$("$PYBIN" -c "
import re,sys
try:
    t=open('$ROOT/expert/expert-registry.yaml',encoding='utf-8').read()
    seg=t.split('experts:')[1] if 'experts:' in t else ''
    print(len(re.findall(r'^  [a-z0-9_-]+:\s*$',seg,re.M)))
except OSError: print(0)" 2>/dev/null || echo 0) # swallow-ok: registry 缺失→0（I3 会报）

"$PYBIN" - "$SRC" "$REL_SRC" "$GIT_SHA" "$SENTINEL_DIRS" "$COMPUTE_FILES" "$SKILL_DIRS" "$PLAYBOOK_YAML" "$EXPERTS" "$OUT" <<'PYEOF'
import json, re, sys, datetime, os
src, rel_src, git_sha, n_sent, n_comp, n_skill, n_pb, n_exp, out = sys.argv[1:10]

text = open(src, encoding='utf-8').read()
# 第四章标题形态: "### E-01 ACTIVE_SCANNING（横切感知层 | soft | 2/4=50%）"
pat = re.compile(r'^### (E-\d{2}) ([A-Z_]+)（([^|）]+)\|\s*(hard|soft|heuristic)\s*\|\s*(\d+)/(\d+)=(\d+)%）\s*$', re.M)
edges = []
for m in pat.finditer(text):
    eid, name, group, hardness, num, den, pct = m.groups()
    line = text[:m.start()].count('\n') + 1
    edges.append({
        "id": eid, "name": name, "group": group.strip(),
        "hardness": hardness,
        "coverage": f"{num}/{den}", "coveragePct": int(pct),
        "authorityRef": {"doc": "权威文档01", "file": rel_src, "line": line,
                          "heading": m.group(0).lstrip('# ').strip()},
    })

if not edges:
    print("❌ 第四章零边抽取——标题格式漂移，请核对生成器正则", file=sys.stderr)
    sys.exit(1)

doc = {
    "schemaVersion": "1.0",
    "generatedFrom": [rel_src],
    "generatedBy": "scripts/doc-system/gen-system-registry.sh",
    "generatedAtCommit": git_sha or None,
    "generatedAt": datetime.datetime.now(datetime.timezone.utc).astimezone().isoformat(timespec='seconds'),
    "edges": edges,
    "nodePools": [],   # TODO(D782 样板后): 从第三章抽取（P0-03/P0-04 裁定后）
    "counters": {
        # K3 §12b.4: 每个计数自带 scope（口径声明），永远不要把多口径压平成一个数。
        # compute 的 6 种口径（实现数/规范数/文件数/契约ID数/批次规划数）留待下批。
        "sentinelDirs": {"value": int(n_sent), "scope": "extensions/sentinels 一级目录（除 _extinct/shared）",
                          "derivedBy": "find extensions/sentinels -maxdepth 1 -type d | grep -v _extinct|shared"},
        "computeFiles": {"value": int(n_comp), "scope": "*computes* 下非 .test.ts 的 .ts 文件数",
                          "derivedBy": "find extensions/sentinels -path '*computes*' -name '*.ts' ! -name '*.test.ts'"},
        "skillDirs": {"value": int(n_skill), "scope": "extensions/skills/builtin 一级目录",
                       "derivedBy": "find extensions/skills/builtin -maxdepth 1 -type d"},
        "playbookYaml": {"value": int(n_pb), "scope": "extensions/playbooks 下 *.yaml",
                          "derivedBy": "find extensions/playbooks -name '*.yaml'"},
        "experts": {"value": int(n_exp), "scope": "expert-registry.yaml experts 键计数（v3.0）",
                     "derivedBy": "yaml experts 键计数"},
    },
    "notes": "样板批（D782）: edges 从第四章抽取; coverageGraph/causalChains 待 K3 §8 裁定后补; 校验器已于 D1149 按零调用方退役（校验侧零执行体，接线见 #1046 批 4）——本文件当前无机器消费者。",
}
os.makedirs(os.path.dirname(out), exist_ok=True)
with open(out, 'w', encoding='utf-8') as f:
    json.dump(doc, f, ensure_ascii=False, indent=2)
    f.write('\n')
print(f"GEN-OK: {len(edges)} 条边 × {len(doc['counters'])} 个 counter → {out}")
PYEOF
exit $?
