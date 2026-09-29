#!/bin/bash
# D313 M5 UTF-8 强制: Windows 控制台/子进程统一 UTF-8
export PYTHONIOENCODING=utf-8
export LC_ALL=C.UTF-8 2>/dev/null || true
# ═══════════════════════════════════════════════════════════════
# ct-suite-select.test.sh — D1061/PR-A: CT 密封套件变更选择器
#
# 覆盖矩阵（铁律 48 三路径 + 接线 + 变异体）:
#   正常   — 合成映射 A/B 域：改 src/l3/** → 只选 A 域（1 条）；--platform windows → A ∪ 平台敏感
#   降级   — 映射缺失 / 映射非法 JSON / 规则引用未定义域 → 显式回退全量 + [D1061-DEGRADED] + 落日志
#   边界   — 空变更集 / 未映射路径 / 命中空域 → **绝不 0 条静默通过**（一律显式回退全量）
#   接线   — ci.yml 引用选择器（WIRE CHECK）；域并集 == catalog（完整性不变式）；平台敏感 ⊆ 全量
#   变异体① — 选择器恒返回全量        → 「只选 A 域 = 1 条」断言必红
#   变异体② — 删 D4 守卫致 0 选中静默 → 「0 选中必须显式」断言必红
#
# 沙箱: mktemp -d 合成 git 仓 + 合成 ci.yml + 合成 map（零真实门禁执行、零网络）
#   ⚠️ 语义断言走 `--changed-files` **注入缝**（确定性、全平台一致）；
#      git 三段点解析另立一条独立断言（生产路径），失败时打印原始输出以自诊断。
#      —— 首版把语义断言全压在沙箱 git 范围上，在 CI windows 变红（4 条断言连带红），
#         根因即「夹具依赖 git 范围解析的跨平台行为」；此版即该次的修复。
# 注入缝: SYNO_CT_SELECT_BIN（指向变异体副本 → 本夹具应在对应断言处变红）
# ═══════════════════════════════════════════════════════════════
set -uo pipefail
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SEL="${SYNO_CT_SELECT_BIN:-$REPO/scripts/control-tower/ct-suite-select.sh}"
MAP="$REPO/scripts/control-tower/ct-suite-map.json"
CIY="$REPO/.github/workflows/ci.yml"
PASS=0; FAIL=0
ok() { echo "  ✅ $1"; PASS=$((PASS+1)); }
no() { echo "  ❌ $1"; FAIL=$((FAIL+1)); }
TMPD="$(mktemp -d)"; trap 'rm -rf "$TMPD"' EXIT
G() { git -C "$SB" -c user.name=t -c user.email=t@t "$@"; }
cnt() { printf '%s\n' "${1:-}" | grep -c . || true; }

# PYBIN 三级探测（PLATFORM-CHECKLIST #1，禁裸 python3 调用）
PYBIN=""
for _c in python3 python py; do  # D520: 三级探测 python3/python/py（见 PLATFORM-CHECKLIST.md #1）
  if command -v "$_c" >/dev/null 2>&1 && "$_c" -c "import sys" >/dev/null 2>&1; then PYBIN="$_c"; break; fi
done
if [ -z "$PYBIN" ]; then
  no "PYBIN 不可用（python3/python/py 均缺失或不可运行）—— 变异体无法构造，显式失败而非静默跳过"
  echo ""; echo "结果: $PASS 通过, $FAIL 失败"; exit 1
fi

echo "=== D1061/PR-A: ct-suite-select ==="

# ── 接线 ──
[ -x "$SEL" ] && ok "ct-suite-select.sh 存在且可执行" || no "选择器缺失/不可执行"
[ -f "$MAP" ] && ok "ct-suite-map.json 存在" || no "映射缺失"
grep -q "ct-suite-select.sh" "$CIY" && ok "接线: ci.yml 引用 ct-suite-select.sh（WIRE CHECK）" || no "ci.yml 未接入选择器"
grep -q "ct-suite-select.test.sh" "$CIY" && ok "接线: 本夹具已入 ci.yml 密封清单" || no "本夹具未入 ci.yml 清单"

# ── 合成沙箱仓（只为 git 范围断言与「选中套件真实存在」检查存在）──
SB="$TMPD/sb"
mkdir -p "$SB/.github/workflows" "$SB/tests/control-tower" "$SB/tests/doc-system" "$SB/src/l3" "$SB/src/l4"
for f in tests/control-tower/sel-a.test.sh tests/control-tower/sel-b.test.sh tests/doc-system/sel-c.test.sh; do
  printf '#!/bin/bash\nexit 0\n' > "$SB/$f"
done
cat > "$SB/.github/workflows/ci.yml" <<'YML'
jobs:
  control-tower-tests:
    steps:
      - run: |
          FAIL=0
          for t in \
            tests/control-tower/sel-a.test.sh \
            tests/control-tower/sel-b.test.sh \
            tests/doc-system/sel-c.test.sh; do
            echo "── $t"
          done
YML
cat > "$SB/map.json" <<'JSON'
{
  "version": "test-fixture",
  "domains": {
    "A": ["tests/control-tower/sel-a.test.sh"],
    "B": ["tests/control-tower/sel-b.test.sh"],
    "EMPTY": []
  },
  "rules": [
    { "glob": "src/l3/*", "domains": ["A"] },
    { "glob": "src/l4/*", "domains": ["B"] },
    { "glob": "docs/empty-*", "domains": ["EMPTY"] }
  ],
  "platform_sensitive": { "windows": ["tests/control-tower/sel-b.test.sh"] }
}
JSON
printf '{ "domains": { broken' > "$SB/bad.json"
cat > "$SB/undef.json" <<'JSON'
{
  "version": "test-fixture-undef",
  "domains": { "A": ["tests/control-tower/sel-a.test.sh"] },
  "rules": [ { "glob": "src/l3/*", "domains": ["NOPE"] } ],
  "platform_sensitive": { "windows": [] }
}
JSON
git -C "$SB" init -q
G add -A; G commit -qm base
git -C "$SB" branch -M main
git -C "$SB" update-ref refs/remotes/origin/main HEAD
printf 'export const x = 1\n' > "$SB/src/l3/foo.ts"
G add -A; G commit -qm "change l3"
git -C "$SB" branch l3only HEAD

# 变更清单注入缝（一行一个路径；与 git 平台行为解耦）
CHG="$TMPD/chg"; mkdir -p "$CHG"
printf 'src/l3/foo.ts\n' > "$CHG/l3.txt"
printf 'src/l4/bar.ts\n' > "$CHG/l4.txt"
printf 'README.md\nwhatever.xyz\n' > "$CHG/unmapped.txt"
printf 'docs/empty-probe.md\n' > "$CHG/empty-domain.txt"
: > "$CHG/empty.txt"

# 降级日志放沙箱 git 树**外**：写沙箱内会弄脏工作区 → 后续 checkout 失败（本夹具已踩）
DEG="$TMPD/deg.log"
SB_MAP="$SB/map.json"
sel() { bash "$SEL" --repo "$SB" --map "$SB_MAP" --degraded-log "$DEG" "$@"; }
selq() { sel "$@" 2>/dev/null; }  # swallow-ok: 夹具只取被测脚本 stdout（需 stderr 的用例显式 2>"$TMPD/eN"）；判定由紧随断言承担（非生产吞错）
selprodq() { bash "$SEL" --repo "$REPO" --map "$MAP" --degraded-log "$TMPD/deg-prod.log" "$@" 2>/dev/null; }  # swallow-ok: 同上（生产映射路径）

# ── 正常: --all / 改 src/l3 → 只选 A 域 ──
OUT=$(selq --all); RC=$?; N=$(cnt "$OUT")
[ "$RC" -eq 0 ] && [ "${N:-0}" -eq 3 ] && ok "--all → 3 条（合成清单全量）rc=0" || no "--all 应 3 条 rc=0，实际 ${N:-0} 条 rc=$RC"

OUT=$(sel --changed-files "$CHG/l3.txt" 2>"$TMPD/e0"); RC=$?; N=$(cnt "$OUT")
[ "$RC" -eq 0 ] && [ "${N:-0}" -eq 1 ] && [ "$OUT" = "tests/control-tower/sel-a.test.sh" ] \
  && ok "正常: 改 src/l3/** → 只选 A 域（1/3 条）" \
  || no "正常路径应只选 A 域 1 条，实际 ${N:-0} 条: $OUT ｜ stderr=$(tr '\n' '|' < "$TMPD/e0")"

OUT=$(selq --changed-files "$CHG/l3.txt" --platform windows); N=$(cnt "$OUT")
[ "${N:-0}" -eq 2 ] && ok "--platform windows → A ∪ 平台敏感 = 2 条" || no "windows 应 2 条，实际 ${N:-0}"

OUT=$(selq --changed-files "$CHG/l4.txt"); N=$(cnt "$OUT")
[ "${N:-0}" -eq 1 ] && [ "$OUT" = "tests/control-tower/sel-b.test.sh" ] \
  && ok "正常: 改 src/l4/** → 只选 B 域（1/3 条）" || no "l4 应只选 B 域 1 条，实际 ${N:-0}"

OUT=$(sel --changed-files "$CHG/l3.txt" 2>&1 >/dev/null)
echo "$OUT" | grep -q "selected_of_total=1/3" && ok "摘要行含 selected_of_total=1/3（机器可读）" || no "摘要行缺 selected_of_total（stderr: $OUT）"

# ── CRLF 仿真（复现 Windows python 文本模式的 \r\n）──
# 依据: PLATFORM-CHECKLIST #2「python/命令输出进算术/比较前必清 CRLF」。
# 首推在 CI windows 变红（4 条断言连带红：正常/窗口/摘要/D4 全走「全量回退」），
# 根因 = 选择器 python 输出（MAP_TSV）未清 \r ⇒ 域名带尾 \r ⇒ DOM 查表落空 ⇒ D2 全量回退。
# 本用例用 PATH 前置 python3 shim（stdout 每行尾追加 \r）**真复现**该平台差异，零生产注入缝。
SHIM="$TMPD/shim"; mkdir -p "$SHIM"
REALPY="$(command -v "$PYBIN")"
cat > "$SHIM/python3" <<EOF
#!/bin/bash
"$REALPY" "\$@" | awk '{printf "%s\r\n", \$0}'
EOF
chmod +x "$SHIM/python3"
OUT=$(PATH="$SHIM:$PATH" bash "$SEL" --repo "$SB" --map "$SB/map.json" --degraded-log "$TMPD/deg-crlf.log" --changed-files "$CHG/l3.txt" 2>"$TMPD/e7"); RC=$?; N=$(cnt "$OUT")
[ "$RC" -eq 0 ] && [ "${N:-0}" -eq 1 ] && [ "$OUT" = "tests/control-tower/sel-a.test.sh" ] \
  && ok "CRLF 仿真（python 输出 \\r\\n，Windows 文本模式）→ 仍只选 A 域 1 条（PLATFORM-CHECKLIST #2）" \
  || no "CRLF 仿真下选择错误（rc=$RC n=${N:-0}）⇒ 域名带尾 \\r 查表落空 ｜ stderr=$(tr '\n' '|' < "$TMPD/e7")"

# ── git 三段点（生产路径）独立断言：失败时打印原始输出以自诊断 ──
RGBAD=$(git -C "$SB" diff --name-only origin/main...l3only 2>&1); RGBAD_RC=$?
RGOUT=$(selq --changed origin/main...l3only); RGN=$(cnt "$RGOUT")
if [ "$RGBAD_RC" -eq 0 ] && [ "$RGBAD" = "src/l3/foo.ts" ] && [ "${RGN:-0}" -eq 1 ]; then
  ok "git 三段点解析: origin/main...l3only → src/l3/foo.ts → 选 1 条（生产路径）"
else
  no "git 三段点路径异常（git rc=$RGBAD_RC range 输出=[$RGBAD]；选择输出 ${RGN:-0} 条）"
fi

# ── 降级: 映射缺失 / 映射非法 / 未定义域 ──
: > "$DEG"
SB_MAP="$SB/missing.json"
OUT=$(sel --changed-files "$CHG/l3.txt" 2>"$TMPD/e1"); RC=$?; N=$(cnt "$OUT")
[ "$RC" -eq 0 ] && [ "${N:-0}" -eq 3 ] && grep -q 'code=D1' "$TMPD/e1" && [ -s "$DEG" ] \
  && ok "降级 D1: 映射缺失 → 显式回退全量 3 条 + [D1061-DEGRADED] + 落日志" \
  || no "D1 降级不符（rc=$RC n=${N:-0}）: $(head -1 "$TMPD/e1")"

: > "$DEG"
SB_MAP="$SB/bad.json"
OUT=$(sel --changed-files "$CHG/l3.txt" 2>"$TMPD/e2"); RC=$?; N=$(cnt "$OUT")
[ "$RC" -eq 0 ] && [ "${N:-0}" -eq 3 ] && grep -q 'code=D1' "$TMPD/e2" && [ -s "$DEG" ] \
  && ok "降级 D1: 映射 JSON 非法 → 显式回退全量 + 落日志" || no "非法映射降级不符（rc=$RC n=${N:-0}）"

: > "$DEG"
SB_MAP="$SB/undef.json"
OUT=$(sel --changed-files "$CHG/l3.txt" 2>"$TMPD/e6"); RC=$?; N=$(cnt "$OUT")
[ "$RC" -eq 0 ] && [ "${N:-0}" -eq 3 ] && grep -q 'code=D2' "$TMPD/e6" && [ -s "$DEG" ] \
  && ok "降级 D2: 规则引用未定义域 → 显式回退全量 + 落日志" || no "D2 不符（rc=$RC n=${N:-0}）: $(head -1 "$TMPD/e6")"
SB_MAP="$SB/map.json"

# ── 边界: 空变更集 → 不得 0 条静默通过 ──
: > "$DEG"
OUT=$(sel --changed-files "$CHG/empty.txt" 2>"$TMPD/e3"); RC=$?; N=$(cnt "$OUT")
[ "$RC" -eq 0 ] && [ "${N:-0}" -eq 3 ] && grep -q 'code=D3' "$TMPD/e3" \
  && ok "边界 D3: 空变更集 → **非空**输出（3 条全量）+ 显式 degraded（绝不 0 条静默通过）" \
  || no "空变更集边界不符（rc=$RC n=${N:-0}）"

# ── 边界: 未映射路径 → D6 全量 ──
OUT=$(sel --changed-files "$CHG/unmapped.txt" 2>"$TMPD/e4"); RC=$?; N=$(cnt "$OUT")
[ "$RC" -eq 0 ] && [ "${N:-0}" -eq 3 ] && grep -q 'code=D6' "$TMPD/e4" \
  && ok "边界 D6: 未命中规则的路径 → fail-closed 回退全量" || no "D6 不符（rc=$RC n=${N:-0}）"

# ── 边界: 命中空域 → D4 全量（0 选中必须显式）──
OUT=$(sel --changed-files "$CHG/empty-domain.txt" 2>"$TMPD/e5"); RC=$?; N=$(cnt "$OUT")
[ "$RC" -eq 0 ] && [ "${N:-0}" -eq 3 ] && grep -q 'code=D4' "$TMPD/e5" \
  && ok "边界 D4: 选中 0 条 → 显式 degraded + 回退全量（0 条静默通过被禁）" || no "D4 不符（rc=$RC n=${N:-0}）"

# ── 边界: 注入缝参数非法 / --list 缺映射 → 非 0 ──
bash "$SEL" --repo "$SB" >/dev/null 2>&1; [ $? -eq 2 ] && ok "参数非法（无模式）→ exit 2" || no "无模式应 exit 2"
bash "$SEL" --repo "$SB" --changed-files "$TMPD/nope.txt" >/dev/null 2>&1
[ $? -eq 0 ] && ok "--changed-files 指向不存在文件 → 显式降级回退全量（rc=0）" || no "--changed-files 缺文件应显式降级"
bash "$SEL" --repo "$SB" --map "$SB/missing.json" --list >/dev/null 2>&1
[ $? -eq 1 ] && ok "--list + 映射缺失 → exit 1（fail-closed，无内容可打印）" || no "--list 缺映射应 exit 1"

# ── 生产映射 sanity ──
ALLOUT=$(selprodq --all)
N=$(cnt "$ALLOUT")
DOMOUT=$(selprodq --list | awk -F':: ' '/DOMAIN /{print $2}' | sort -u)
CATOUT=$(printf '%s\n' "$ALLOUT" | sort -u)
ONLY_IN_CAT=$(comm -13 <(printf '%s\n' "$DOMOUT") <(printf '%s\n' "$CATOUT"))
ONLY_IN_DOM=$(comm -23 <(printf '%s\n' "$DOMOUT") <(printf '%s\n' "$CATOUT"))
[ -z "$ONLY_IN_CAT" ] && [ -z "$ONLY_IN_DOM" ] \
  && ok "完整性不变式: 域并集 == ci.yml catalog（${N} 条集合相等，零缺口/零孤儿）" \
  || no "域并集 ≠ catalog：仅 catalog 有 [$(printf '%s' "$ONLY_IN_CAT" | tr '\n' ' ')]；仅域有 [$(printf '%s' "$ONLY_IN_DOM" | tr '\n' ' ')]"

PRODOUT=$(selprodq --changed HEAD~1...HEAD)
N=$(cnt "$PRODOUT"); MISSING=0
while IFS= read -r s; do [ -z "$s" ] && continue; [ -f "$REPO/$s" ] || MISSING=$((MISSING+1)); done <<< "$PRODOUT"
[ "${N:-0}" -gt 0 ] && [ "$MISSING" -eq 0 ] \
  && ok "生产映射: 真实 range 选择 ${N} 条，全部在仓库存在" || no "生产选择异常（${N:-0} 条，缺失 ${MISSING}）"

PLAT_N=$(selprodq --list | grep -c 'PLATFORM windows' || true)
PLAT_OUT=$(selprodq --list | awk -F':: ' '/PLATFORM windows/ {print $2}')
PLAT_ORPHAN=0
while IFS= read -r s; do
  [ -z "$s" ] && continue
  printf '%s\n' "$ALLOUT" | grep -qxF "$s" || PLAT_ORPHAN=$((PLAT_ORPHAN+1))
done <<< "$PLAT_OUT"
[ "${PLAT_N:-0}" -gt 0 ] && [ "$PLAT_ORPHAN" -eq 0 ] \
  && ok "生产映射: 平台敏感 windows 集 ${PLAT_N} 条，且 ⊆ 全量清单（孤儿 ${PLAT_ORPHAN}）" \
  || no "平台敏感集异常（${PLAT_N:-0} 条，孤儿 ${PLAT_ORPHAN}）"
"$PYBIN" -c "import json,sys;d=json.load(open(sys.argv[1],encoding='utf-8'));r=d['platform_sensitive'].get('windows_reasons',{});w=set(d['platform_sensitive']['windows']);sys.exit(0 if w and w<=set(r) else 1)" "$MAP" >/dev/null 2>&1 \
  && ok "生产映射: 平台敏感逐条理由（windows_reasons）齐备" || no "windows_reasons 未覆盖 windows 全项"

# ── D1061-A3 分片：完整性不变式 + 参数校验 + 过滤正确性 ──
# 不变式 = 每条 catalog 条目**恰好**属于一个分片 ∪ 各分片并集 == catalog（零缺口/零重复/零孤儿）
#   —— 这是防「分片后某套件永不被跑」的唯一物理保障。
SHLIST=$(selprodq --list)
printf '%s\n' "$SHLIST" | grep -q '  SHARDKEY' || true
SH_CAT=$(printf '%s\n' "$SHLIST" | awk -F' :: ' '/DOMAIN /{print $2}' | sort -u)
SH_UNION=$(printf '%s\n' "$SHLIST" | awk -F' :: ' '/ SHARD [0-9]+ ::/{print $2}' | sort)
SH_UNIQ=$(printf '%s\n' "$SH_UNION" | sort -u)
SH_DUP_N=$(printf '%s\n' "$SH_UNION" | uniq -d | grep -c . || true)
SH_GAP=$(comm -23 <(printf '%s\n' "$SH_CAT") <(printf '%s\n' "$SH_UNIQ"))
SH_ORPH=$(comm -13 <(printf '%s\n' "$SH_CAT") <(printf '%s\n' "$SH_UNIQ"))
[ -z "$SH_GAP" ] && [ -z "$SH_ORPH" ] && [ "${SH_DUP_N:-0}" -eq 0 ] \
  && ok "分片完整性不变式: 每条 catalog 条目恰好属一个分片（catalog=$(cnt "$SH_CAT") 分片并集=$(cnt "$SH_UNIQ") 重复=${SH_DUP_N:-0}）" \
  || no "分片不变式破：缺口=[$(printf '%s' "$SH_GAP" | tr '\n' ' ')] 孤儿=[$(printf '%s' "$SH_ORPH" | tr '\n' ' ')] 重复=${SH_DUP_N:-0}"

SHTOT=$(printf '%s\n' "$SHLIST" | awk '/ SHARDKEY /{print $3}' | head -1)
[ "${SHTOT:-0}" -ge 2 ] && ok "分片数声明可读: shards.count=${SHTOT}" || no "shards.count 缺失或 <2（${SHTOT:-none}）"

SHP1=$(selprodq --list | awk -F' :: ' '/ SHARD 1 ::/{print $2}' | sort -u)
# 用**真实映射可命中的路径**（docs/** → doc-system 域）；不可用触发 __FULL__ 的路径（那会输出全量）
printf 'docs/synova/coordination/probe.md\n' > "$CHG/real-doc.txt"
SEL1=$(selprodq --shard 1/4 --changed-files "$CHG/real-doc.txt" | sort -u)
SH_OK=1; while IFS= read -r s; do [ -z "$s" ] && continue; printf '%s\n' "$SHP1" | grep -qxF "$s" || SH_OK=0; done <<< "$SEL1"
[ "$SH_OK" -eq 1 ] && ok "分片过滤: --shard 1/4 输出 ⊆ 分片 1 分配表（$(cnt "$SEL1") 条）" || no "--shard 1/4 输出含非分片 1 条目"

bash "$SEL" --repo "$SB" --map "$SB/map.json" --shard 9/4 --changed-files "$CHG/l3.txt" >/dev/null 2>&1
[ $? -eq 2 ] && ok "分片参数校验: --shard 9/4 越界 → exit 2" || no "--shard 9/4 应 exit 2"
bash "$SEL" --repo "$SB" --map "$SB/map.json" --shard abc --changed-files "$CHG/l3.txt" >/dev/null 2>&1
[ $? -eq 2 ] && ok "分片参数校验: --shard abc 非数字 → exit 2" || no "--shard abc 应 exit 2"
bash "$SEL" --repo "$SB" --map "$SB/map.json" --shard 1 --changed-files "$CHG/l3.txt" >/dev/null 2>&1
[ $? -eq 2 ] && ok "分片参数校验: --shard 1（缺 /n）→ exit 2" || no "--shard 1 应 exit 2"

# ══════════ 变异体（改坏即红；只在 /tmp 副本上改，真文件零残留）══════════
echo ""
echo "── 变异体（判别力自证）──"
MUT1="$TMPD/mut1.sh"; cp "$SEL" "$MUT1"
"$PYBIN" - "$MUT1" <<'PY'
import pathlib, sys
p = pathlib.Path(sys.argv[1]); t = p.read_text(encoding="utf-8")
assert "FORCE_FULL=0\n" in t, "MUT1 anchor missing"
p.write_text(t.replace("FORCE_FULL=0\n", "FORCE_FULL=1  # MUTATION-1: 恒返回全量\n", 1), encoding="utf-8")
PY
if cmp -s "$SEL" "$MUT1"; then no "变异体①锚点未命中（脚本结构已变，夹具须同步）"; else
  M1OUT=$(bash "$MUT1" --repo "$SB" --map "$SB/map.json" --degraded-log "$TMPD/mut1.log" --changed-files "$CHG/l3.txt" 2>/dev/null)  # swallow-ok: 变异体只取 stdout，判定由紧随断言承担
  M1N=$(cnt "$M1OUT")
  [ "${M1N:-0}" -eq 3 ] && ok "变异体①被检出: 恒返回全量 → 正常路径输出 3 条 ≠ 期望 1 条（正常断言必红）" \
    || no "变异体①未被检出（输出 ${M1N:-0} 条）—— 正常路径断言无判别力"
fi

MUT2="$TMPD/mut2.sh"; cp "$SEL" "$MUT2"
"$PYBIN" - "$MUT2" <<'PY'
import pathlib, sys
p = pathlib.Path(sys.argv[1]); t = p.read_text(encoding="utf-8")
old = 'if [ "$SEL_N" -eq 0 ]; then\n  degraded D4 '
assert old in t, "MUT2 anchor missing"
i = t.index(old)
j = t.index("\nfi\n", i) + len("\nfi\n")
p.write_text(t[:i] + ": # MUTATION-2: D4 守卫被删 → 0 选中静默通过\n" + t[j:], encoding="utf-8")
PY
if cmp -s "$SEL" "$MUT2"; then no "变异体②锚点未命中（脚本结构已变，夹具须同步）"; else
  M2OUT=$(bash "$MUT2" --repo "$SB" --map "$SB/map.json" --degraded-log "$TMPD/mut2.log" --changed-files "$CHG/empty-domain.txt" 2>/dev/null); M2RC=$?  # swallow-ok: 同上
  M2N=$(cnt "$M2OUT")
  [ "$M2RC" -eq 0 ] && [ "${M2N:-0}" -eq 0 ] && ok "变异体②被检出: 删 D4 守卫 → 0 选中静默 exit 0（边界断言必红）" \
    || no "变异体②未被检出（rc=$M2RC 输出 ${M2N:-0} 条）—— 边界断言无判别力"
fi

echo ""
echo "结果: $PASS 通过, $FAIL 失败"
[ "$FAIL" -eq 0 ] && exit 0 || exit 1
