---
状态: implemented
日期: 2026-10-11
决策: `.gitea/workflows/local-gates.yml` 的「依赖」步把缓存判据从「装过没有」（`[ -d "$WS/node_modules/vitest" ]`）改为 **`package-lock.json` 内容哈希指纹** —— 指纹变了才 `npm ci`；并**明确禁止**用「删 CI 工作区 node_modules」让它变绿。
理由: ① 原判据与 lock **无关** ⇒ **依赖变更在 CI 不生效**（安全修复也一样）。实测：CI 工作区 `node_modules/react` 停在 19.3.0（mtime Oct 10 16:48），而 #337 的 lock 已是 18.3.1，日志打印「依赖已存在」⇒ 该 PR 的 CI **从未跑过 `npm ci`**，其红是"旧树"所致而非分支内容所致；4 个 PR（#338/#335/#340/#341）全部命中 ⇒ **依赖类 PR 的 CI 信号恒为噪声**。② 以 lock 哈希作**内容寻址**的缓存键是生态通行做法（`actions/setup-node` 的 `cache-dependency-path` 同理）。③ 创始人 2026-10-11 明令：**不许删 node_modules 让它变绿** —— 那会把「条件式安装」这个结构缺陷从视野里抹掉一次，下一次依赖变更再撞同一面墙。
---

# 决策 Note — CI 依赖安装步改 lock 哈希指纹（裁决①）

> 任务: #344 ｜ 分支 `fix/344-ci-deps-fingerprint` ｜ 卡面 `.claude/task-briefs/2026-10-11-344-ci-deps-fingerprint.md`
> 来源：创始人 2026-10-11「第 1 步 · CI 安装步（锁死所有依赖卡，最高优先）」，机制 = **裁决①**（原文逐字给出）

## 一、改了什么（一行判据 → 内容寻址）

```yaml
# 旧（只看装过没有，与 lock 无关）
if [ -d "$WS/node_modules/vitest" ]; then echo "依赖已存在"; else … npm ci …; fi

# 新（lock 内容哈希作缓存指纹）
CUR_HASH="$(shasum -a 256 "$WS/package-lock.json" | awk '{print $1}')"
PREV_HASH="$(cat "$WS/.deps-lock-hash" 2>/dev/null || true)"
# node_modules 缺 vitest / 哈希算不出 / 哈希变了 ⇒ npm ci 并回写指纹；相同才跳过
```

**边界（有意）**：只改「**何时**装」，不改「**装什么**」（仍是 `npm ci`，严格按 lock 装）。

## 二、判据（可复跑，含反例）

`bash tests/control-tower/ci-deps-step-sim.test.sh` ⇒ **`RESULT: 11 PASS / 0 FAIL`**

| 场景 | 期望 | 实测 |
|---|---|---|
| 甲 指纹一致 | 跳过且**不装** | ✅ 打印`跳过 npm ci`；node_modules 仍 1 项 |
| 乙 指纹变了 | 真装 | ✅ `lock 已变更 ⇒ 重装` ＋ 回写指纹；node_modules 1 → 832 |
| 丙 指纹文件缺失 | 重装（fail-closed） | ✅ 不拿「无记录」当「未变」 |
| 丁 哨兵 | 不许靠删 node_modules 变绿 | ✅ |
| **反例** 正文换回旧判据 | **必红且逐条点名** | ✅ `VIOLATION failures=3`，甲/乙/丙 各点名 |
| 边界 抽不出该步 | exit **2** | ✅ fail-closed |

## 三、本卡自己踩的四处假反例（**同一病根**，记此防复踩）

判据与观测面脱钩 —— 与「注释即可满足 = 假绿」同型：

1. 拿 `npm ci --silent` 的输出当判据 ⇒ **`--silent` 永不打印 `added N packages`** ⇒ 恒 FAIL。
   ⇒ 改判**与输出无关的副作用**（指纹文件被更新 ＋ node_modules 体量）。
2. 沙箱 `package.json` 用**桩 JSON** ⇒ 与真 lock 不匹配 ⇒ npm 走空转（`up to date, audited 1 package`）
   ⇒ "重装"与"什么都没装"不可区分。⇒ 必须用真 `package.json`。
3. BSD `sed -i.bak '0,/re/s//…/'` 改 lock ⇒ **本机静默不生效**（不支持的地址形式）。
4. 「唯一安装点」判据我改了三次才做成可判的：`grep -c "npm ci"` ⇒ 6（含注释/echo 文本）；
   加 `[^#]` ⇒ 3（对**缩进注释**无效）；最终口径排除整行注释与 `echo` 行 ⇒ **恰 1 行**。
   ⇒ 教训：**判据要针对"真调用形态"下刀，不要对"字符串出现过"下刀。**

## 四、未做（不夹带）

`.gitea/workflows/local-gates.yml` 仍用**裸 `npm ci --silent`**；`.github/workflows/ci.yml` 走
`scripts/control-tower/install-deps.sh`（`npm ci --ignore-scripts` ＋ 白名单放行）
⇒ **两套工作流安装策略不一致**。属**安装策略变更**，须另裁，本卡不夹带。
已核**无撞车**：`tests/control-tower/install-deps.test.sh` 的「不得再有裸 npm ci」断言只查 `.github/**`，
**不查 `.gitea/`**（实测 `.gitea` 在该夹具中零命中）。

## 五、不修的另一件

CI 增量步 `vitest --changed origin/local-main` 会给「**空绿**」（连续 33 个 job 输出
`No test files found, exiting with code 0`）—— 属创始人分步计划的**第 2 步**，本 Note 不覆盖。
