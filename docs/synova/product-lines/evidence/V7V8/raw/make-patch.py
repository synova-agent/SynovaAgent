import io, sys, re
src = open('.github/workflows/ci.yml', encoding='utf-8').read()
lines = src.split('\n')
# 定位启停锚（1-indexed 打印口径见下方校验）
start = None; end = None
for i, ln in enumerate(lines):
    if ln.strip() == '# 去除 ANSI 颜色码后提取失败文件列表':
        start = i
    if start is not None and ln == '          exit 1' and i > start:
        end = i; break
assert start is not None and end is not None, (start, end)
print(f"# anchor: start_line={start+1} end_line={end+1}  replaced {end-start+1} lines", file=sys.stderr)

NEW = '''          # 去除 ANSI 颜色码后提取失败文件列表
          CLEAN_OUTPUT=$(echo "$OUTPUT" | sed 's/\\x1b\\[[0-9;]*[a-zA-Z]//g')
          # 🔴 V7（#1032）修复①: 失败清单取**全路径**。
          #   旧式 `grep -oP 'tests/\\S+\\.test\\.ts'` 有两条静默降级：
          #     ① 路径不含 "tests/" 子串的失败（extensions/**、scripts/**…）整条被丢掉；
          #     ② `packages/x/tests/**` 只匹配到 "tests/" 之后的部分 ⇒ **前缀被截断** ⇒ 错归因。
          #   新式按 FAIL 行整取首段非空白字段，不预设路径形状。
          FAILED_TESTS=$(echo "$CLEAN_OUTPUT" | grep -E '^[[:space:]]*FAIL[[:space:]]+' \\
            | sed -E 's/^[[:space:]]*FAIL[[:space:]]+//; s/[[:space:]].*$//' | sort -u || true)
          if [ -n "$FAILED_TESTS" ]; then
            TODAY=$(date -u +%F)
            LEDGER="scripts/control-tower/vitest-red-exempt.txt"
            NEW_FAILURES=""; EXEMPT_FAILURES=""
            while IFS= read -r tf; do
              [ -z "$tf" ] && continue
              SOURCE_FILE=$(echo "$tf" | sed 's|^tests/|src/|; s|\\.test\\.ts$|.ts|' || true)
              if [ -n "$CHANGED" ] && { echo "$CHANGED" | grep -qF "$SOURCE_FILE" 2>/dev/null || echo "$CHANGED" | grep -qF "$tf" 2>/dev/null; }; then
                NEW_FAILURES="${NEW_FAILURES}${tf} (本 PR 引进)\\n"; continue
              fi
              # 🔴 V7 修复②: 归因外失败**不再无条件放行** —— 只允许"台账登记 + 未过期"。
              #   台账行格式: <测试路径> | owner=<名> | expires=YYYY-MM-DD
              #   棘轮只减不增（M-03）: 过期即红；放行条目须修掉或显式延期，不得续期式常驻。
              EXPIRES=$(awk -F'|' -v f="$tf" '
                /^[[:space:]]*#/ {next}
                { p=$1; gsub(/^[[:space:]]+|[[:space:]]+$/,"",p);
                  if (p != f) next;
                  for (i=2;i<=NF;i++){ k=$i; gsub(/^[[:space:]]+|[[:space:]]+$/,"",k);
                    if (k ~ /^expires=/){ sub(/^expires=/,"",k); gsub(/[[:space:]]/,"",k); print k } } }' "$LEDGER" 2>/dev/null | tail -1)
              if [ -n "$EXPIRES" ] && [ "$EXPIRES" \\> "$TODAY" ]; then
                EXEMPT_FAILURES="${EXEMPT_FAILURES}${tf} (登记至 ${EXPIRES})\\n"
              else
                NEW_FAILURES="${NEW_FAILURES}${tf} (归因外未登记/已过期)\\n"
              fi
            done <<< "$FAILED_TESTS"
            if [ -n "$EXEMPT_FAILURES" ]; then
              echo "::warning::Vitest 台账内存量红放行（未过期；铁律 11 可见）: $(echo -e "$EXEMPT_FAILURES" | tr '\\n' ' ')"
              echo "PREEXISTING_RED_FILES:"
              echo -e "$EXEMPT_FAILURES"
              echo "→ 这些是真红，已登记 vitest-red-exempt.txt（须烧掉；到期即转红）"
            fi
            if [ -n "$NEW_FAILURES" ]; then
              echo "::error::Vitest 阻断（本 PR 引进，或归因外未登记/已过期）:"
              echo -e "$NEW_FAILURES"
              exit 1
            fi
            exit 0
          fi
          exit 1'''

lines[start:end+1] = NEW.split('\n')
open('/tmp/v7v8/ci-patched.yml', 'w', encoding='utf-8').write('\n'.join(lines))
print("# wrote /tmp/v7v8/ci-patched.yml", file=sys.stderr)
