# V7 + V8 交付证据（task-4）

> 卡：task-4 ·「V7+V8 · 测试执行面归零（include 差集 + 归因棘轮）」
> 分支：`docs/V7V8-test-execution-surface` ｜ 基线：`origin/main = 74eb6c44c`
> 本目录是**唯一交付证据目录**。
> 🔴 偏离声明：task-4 正文写的证据路径是 `docs/synova/coordination/evidence/v7v8/**`，
> 该路径被 `.gitignore:81 evidence/` 忽略（`git check-ignore -v` 实测命中）⇒ 无法 git 跟踪。
> 经 Lead 通告改到本目录（`docs/synova/product-lines/evidence/` 是 `.gitignore:84` 的豁免路径，实测可跟踪）。
> **不是本卡自行扩大范围**。

---

## 坐标系

```
总闸: 不适用
承重件: 不适用
批次: 第2批-V组
命名空间: 不适用
执行态: 已交付（待终审）
验证级别: L2-真跑通（V8 计数/红绿）｜ L1-静态可达（V8 的 .test.sh 清单提取）｜ 未验（CI 侧真实 check-run）
阻塞源: 无阻塞（CI 改动需治理线 A 槽，本卡只出提案）
```

---

## 一句话结论

| 面 | 补前 | 补后 | 说明 |
|---|---|---|---|
| **V8** include **模式**差集 | 37 个 `.test.ts` 不匹配任何 include | **0**（include 覆盖 656/656） | 本卡已修 |
| **V8** include **执行**差集 | 656 − 599 = **57** 个文件无 runner | 656 − 636 = **20** 个文件无 runner | 本卡已把 37 个从"永不执行"变为"执行" |
| **V8** 剩余 20 个 | — | 17 个是 CI-only `exclude`（需裁）+ 3 个"在 include 但收集 0 条" | **需裁 / 另卡** |
| **V8** `.test.sh` | 131 个，CI 只跑 60 | 未改（`.test.sh` 无 runner 属 CI 面） | **只出处置清单 + 请裁** |
| **V7** 归因棘轮判据 | 5/8 必备语义成立（违反 S1/S3/S7） | 8/8（对补丁副本实测） | 判据已建 + 补丁已提出，**CI 未改** |

---

## 交付物清单

| 文件 | 内容 | 级别 |
|---|---|---|
| `v8-inventory.md` | 三集合实测 + 枚举 + 补前/补后原始输出 | L2 |
| `v8-disposal-list.md` | 逐条处置（补 runner / 待裁 / 待删）+ 请裁项 | L2 + L1 |
| `v7-attribution-ratchet.md` | V7 判据（探针）设计与两段原始输出 | L2 |
| `ci-patch-proposal.md` | 需改 `.github/**` 的逐行 diff + 理由（转交治理线） | L1（提案，未生效） |
| `raw/` | 全部原始输出与集合清单（禁手写数字） | — |
| `../../../../tests/ci/attribution-ratchet-probe.sh` | V7 判据本体 | L2 |

---

## 复跑命令（全部自足，逐条可跑）

> 环境：node v24.19.0；worktree `.synova-wt-tests`（`node_modules` 为符号链接，指向仓内既有安装）。
> 🔴 `npm ci` 在 main 上结构性必红（`vitest@5.0.2` vs `@vitest/coverage-v8@4.1.8` ERESOLVE，修它的 #1159 未合）
> ⇒ 本卡**未改** `package.json` / `package-lock.json`（属治理线 W1）。

```bash
export PATH="$HOME/.nvm/versions/node/v24.19.0/bin:$PATH"
cd /Users/wane/SynovaAgent/.synova-wt-tests

# ── V8: 三集合并枚举 ──────────────────────────────────────────────
# A. 全集
git ls-tree -r --name-only origin/main | grep -E '\.test\.(ts|tsx)$' | sort > /tmp/A.txt && wc -l < /tmp/A.txt
# B. include 匹配集（补后 4 条模式）
{ git ls-tree -r --name-only origin/main | grep -E '^tests/.*\.test\.ts$'
  git ls-tree -r --name-only origin/main | grep -E '^packages/[^/]+/tests/.*\.test\.ts$'
  git ls-tree -r --name-only origin/main | grep -E '^extensions/.*\.test\.ts$'; } | sort -u > /tmp/B.txt && wc -l < /tmp/B.txt
# C. CI 实跑集（vitest 真实收集；CI=1 ⇒ CI-only exclude 生效）
CI=1 node ./node_modules/vitest/vitest.mjs list --reporter=default 2>/dev/null \
  | grep -oE '^[^ ]+\.test\.ts' | sort -u > /tmp/C.txt && wc -l < /tmp/C.txt
# 差集
comm -23 /tmp/A.txt /tmp/C.txt | wc -l

# ── V8: 补前/补后全量实跑（汇总计数）───────────────────────────────
CI=1 NO_COLOR=1 node ./node_modules/vitest/vitest.mjs run --reporter=default 2>&1 \
  | grep -E '^ *Test Files|^ *Tests|^ *Errors|^ *Duration'
# ⚠️ 本机全量跑**打印汇总后进程不退出**（实测 ≥180s，须外部强杀）⇒ exit code 拿不到（见 §未验）

# ── V8: .test.sh 家族 ─────────────────────────────────────────────
git ls-tree -r --name-only origin/main | grep -E '\.test\.sh$' | sort | wc -l          # 131
python3 -c "import re;s=open('.github/workflows/ci.yml',encoding='utf-8').read();l=re.findall(r'for t in \\\\\\\n(.*?); do',s,re.S);print(len([x for x in l[0].replace(chr(92),'').split(chr(10)) if x.strip()]))"  # 59

# ── V7: 归因棘轮判据（两段，见 v7-attribution-ratchet.md）───────────
bash tests/ci/attribution-ratchet-probe.sh --verbose                 # 现存 ci.yml  → exit 1（5/8）
bash tests/ci/attribution-ratchet-probe.sh --ci-yml docs/synova/product-lines/evidence/V7V8/raw/ci-patched.yml --verbose  # 补丁副本 → exit 0（8/8）
```

---

## 🔴 未验 / 例外（主动列，判例 V-09）

1. **CI 侧真实 check-run 未验**：本会话不取 GitHub Actions 运行结果（无网络取证步骤）。
   V7 的"补丁生效 ⇒ CI 必红"只在**本地等价判据**上证明（逐字提取 ci.yml 的 step 正文 + 受控输入），
   **真 CI 断言 = 未验**。补丁需治理线落地后另跑一次真 CI 才能收口。
2. **全量 run 的 exit code 拿不到**：本机 vitest 打印汇总后不退出（实测 post-summary 仍存活 ≥180s，
   两次复现；S5 亦独立记录 >4min）⇒ 所有全量红绿判据以**汇总计数**为准，非 exit code。
   小集合（16/21 文件）能干净退出并给出 exit code（见 `raw/v8-groupA-B-run.txt`）。
3. **`.test.sh` 的"CI 实跑集"是静态提取**（从 `ci.yml` 的 `for t in` 清单 + 显式 `bash tests/...` 提取），
   **不是**CI 运行实测 ⇒ 标 **L1-静态可达**，不是 L2。
4. **`extensions/sentinels/_extinct/**` 的 12→3 个测试**：其中 3 个属已退役哨兵的死代码测试。
   本卡**未删**（删除 = 覆盖缩减，须裁）。
5. **`packages/test-kit/**` 的归属**：该包自带 `vitest.config.ts` + 自带 lock，`ci.yml` 有专属 job。
   本卡按卡面指示并入**根 include**（不改 `.github/**` 条件下的唯一可行路径）；
   "改为扩 test-kit 专属 job 范围"是另一条路，已列入 `ci-patch-proposal.md` 备选。
