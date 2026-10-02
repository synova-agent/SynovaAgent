---
name: sentinel-lifecycle
description: 哨兵全生命周期判据与检查（synova-sentinel 能力面负责人专属）——哨兵四问（加/接/生效/删干净）+ manifest.computes[] 一致性检查 + _extinct 归档规约。判据源＝院方 04-契约演进与机器可判性.md:122-131（插件四问）+ 03-产品研究/产品定义/插件契约-经营视图.md:38（七条契约 ⑥ 干净卸载）。凡遇「加哨兵 / 接哨兵 / 改哨兵 / 退役哨兵」任一时点加载。
---

# sentinel-lifecycle — 哨兵全生命周期（能力面负责人用）

## 0. 术语消歧（先读，防串线）

| token | 含义 | 判据源 |
|---|---|---|
| **插件四问** | ① 加了吗 ② 接上了吗 ③ 生效了吗 ④ 删干净了吗 | 院方 `04-技术研究/专题研究/CTO委托-基座治理/04-契约演进与机器可判性.md:122-131` |
| **包四问** C-1~C-4 | 知道干什么 / 知道不碰什么 / 知道什么算完成 / 工具集对 | 院方 `05-组织协作工作流/空对话测试清单.md:19-26`（**验收"预设包本身"，与哨兵无关**） |

🔴 二者互不相干，**勿混用**。本技能把【插件四问】落到哨兵面，称**哨兵四问**。

---

## 1. 哨兵面的物理事实（as_of 2026-10-02｜每条附复跑命令）

| 事实 | 值 | 复跑 |
|---|---|---|
| 活跃哨兵 | **45** | `ls -d extensions/sentinels/*/ \| grep -v _extinct \| wc -l` |
| 顶层索引 | 1 | `extensions/sentinels/manifest.json`（`type: sentinel`，`sentinels.<领域[]>` 分组登记） |
| 退役哨兵 | **12** | `ls extensions/sentinels/_extinct/ \| wc -l` |
| `manifest.computes[]` ≠ 磁盘 | **12/45** | §2 脚本（口径见 §2，错一步就误报） |

> 🔴 卡面若给 `N/M` 而你没现场复现，**不得引用**（CTO 判据纪律 ③）。上面每个数字都必须由你当场重跑确认。

---

## 2. 问② 接上了吗 — `manifest.computes[]` 一致性检查

### 2.1 口径（这一步错了整节作废）

磁盘侧**同时存在两种命名**；manifest 侧同一 slug 也可能带 `compute-` 前缀。归一化规则：

| 侧 | 形态 | 归一 |
|---|---|---|
| manifest `computes[]` | `<slug>` 或 `compute-<slug>` | 去前导 `compute-` |
| 磁盘 `computes/` | `<slug>.ts` 或 `compute-<slug>.ts` | 去 `.ts`，再去前导 `compute-` |

**三次实测（2026-10-02，同一份盘）**：

| 口径 | 结果 |
|---|---|
| 不做归一化（要求 manifest 恰为 `<slug>`） | 误报 **43/45** |
| 只认 `computes/compute-<slug>.ts` | 误报 **27/45** |
| **两侧都归一** | **真值 12/45** |

⚠️ 这条正是本技能存在的主要理由：不写清归一化，检查器就是误报机。

### 2.2 判据脚本（真源，直接可跑；改哨兵面前后各跑一次，两个数都贴）

```bash
python3 - <<'PY'
import json, os, glob
root = 'extensions/sentinels'
def disk_slugs(cdir):
    out = set()
    if not os.path.isdir(cdir): return out
    for f in os.listdir(cdir):
        if not f.endswith('.ts'): continue
        if f.endswith(('.test.ts', '.spec.ts', '.d.ts')): continue
        s = f[:-3]
        if s.startswith('compute-'): s = s[len('compute-'):]
        out.add(s)
    return out
bad = []
mfs = sorted(glob.glob(f'{root}/*/manifest.json'))
for mf in mfs:
    d = os.path.dirname(mf); sid = os.path.basename(d)
    m = json.load(open(mf))
    declared = set((x[len('compute-'):] if x.startswith('compute-') else x)
                   for x in (m.get('computes') or []))
    onfile = disk_slugs(os.path.join(d, 'computes'))
    if declared != onfile:
        bad.append((sid, sorted(declared - onfile), sorted(onfile - declared)))
print(f'active={len(mfs)} mismatch={len(bad)}/{len(mfs)}')
for sid, miss, orph in bad:
    print(f'  {sid}: declared-not-on-disk={miss} disk-not-declared={orph}')
PY
```

### 2.3 🔴 改坏即红夹具（只跑一次拿"通过"不算过）

⚠️ **「挑哪个哨兵改坏」决定夹具真假。** 基线里**已经不一致的 12 个哨兵**，对它删声明**不会让总数变化**——它本来就在 `bad` 名单里。
**实测（2026-10-02）**：

| 选的哨兵 | 基线 | 改坏后 | 判定 |
|---|---|---|---|
| `cash-runway`（基线已在 bad 名单） | 12/45 | **12/45 不变** | ❌ **夹具假过** |
| `agent-deployment-maturity`（基线一致） | 12/45 | **13/45** 且该 id 进 bad | ✅ 夹具有效 |

⇒ **必须先算出「当前一致」的哨兵再挑**（45−12＝33 个候选），不许凭感觉点一个。

```bash
# ⓪ 挑一个【当前一致】的哨兵（--target 自动挑；--bad 打印 bad 名单）
cat > /tmp/sentinel-check.py <<'PY'
import json, os, glob, sys
root="extensions/sentinels"
def disk_slugs(cdir):
    out=set()
    if not os.path.isdir(cdir): return out
    for f in os.listdir(cdir):
        if not f.endswith(".ts") or f.endswith((".test.ts",".spec.ts",".d.ts")): continue
        s=f[:-3]
        if s.startswith("compute-"): s=s[len("compute-"):]
        out.add(s)
    return out
bad=[]; mfs=sorted(glob.glob(f"{root}/*/manifest.json"))
for mf in mfs:
    d=os.path.dirname(mf); sid=os.path.basename(d)
    m=json.load(open(mf))
    dec=set((x[len("compute-"):] if x.startswith("compute-") else x) for x in (m.get("computes") or []))
    on=disk_slugs(os.path.join(d,"computes"))
    if dec!=on: bad.append(sid)
print(f"active={len(mfs)} mismatch={len(bad)}/{len(mfs)}")
if "--bad" in sys.argv: print("bad:", " ".join(bad))
if "--target" in sys.argv:
    allids=[os.path.basename(os.path.dirname(p)) for p in mfs]
    good=[s for s in allids if s not in bad]
    print("TARGET="+(good[0] if good else ""))
PY

# ① 基线（应 = 12/45）
python3 /tmp/sentinel-check.py
T=$(python3 /tmp/sentinel-check.py --target | sed -n 's/^TARGET=//p')   # 当前一致的哨兵

# ② 改坏：只删【这一个】的 manifest.computes[] 最后一项
# ③ 必红：重跑 → 该 id 必须进 bad，总数必须 = 13/45
# ④ 恢复：git restore "extensions/sentinels/$T/manifest.json" → 必须回到 12/45
```

四步全部留原始输出；**只跑①拿到"通过"不算过**。

### 2.4 三类失败与处置

| 类 | 现象（12/45 中的实例） | 处置 |
|---|---|---|
| **空挂** | manifest 声明了、磁盘没有：`competitive-moat` 8 项、`capital-health`（另一口径）、`key-person-risk:bus-factor`、`path-dependency:detect-path-dependency`、`revenue-health:customer-concentration` | 补文件，或从 `computes[]` 删除 —— **选哪个先读 `aggregate.ts` 是否引用**，不许二选一凭猜 |
| **孤儿** | 磁盘有文件、manifest 未声明：`capital-health:cash-conversion-cycle/debt-structure/wacc`、`cash-runway:constraint-impact/replenish-rate`、`margin-health:incentive-bind/metric-bind-divergence`、`org-repairability:problem-action-cycle`、`software-health:integration-health`、`unit-economics` 5 项、`financing-constraint:cash-runway` | 登记进 `computes[]`，或删文件（禁留死代码，铁律 37） |
| **前缀噪声** | `competitive-position:competitive-intensity/hhi-index/lifecycle-stage` 等 | 归一化后仍不一致 ⇒ **是真不一致**，按上两类之一处理；不要靠"再加一层正则"抹平 |

⚠️ `computes/` 之外还有 `aggregate.ts`（哨兵入口，manifest 的 `entryPoint`/`exportKey` 必须真实存在）。

---

## 3. 问① / 问③ / 问④

### 3.1 问① 加了吗（插件进组装）

- `extensions/sentinels/<id>/` 必须同时有 `manifest.json` + `aggregate.ts`。
- `manifest.json` 必填键（45/45 实测齐备）：`$schema name version type displayName description schedule expert priority layer computeKind computes thresholds aggregation context entryPoint exportKey auxiliaryExperts`。
- **顶层索引必须登记**：`extensions/sentinels/manifest.json` 的 `sentinels.<领域[]>` 里要有该 id —— 漏登记 = 加载器看不见，**目录在场 ≠ 出现**。
- `entryPoint`（`./aggregate.ts`）与 `exportKey` 必须与文件里的真实导出逐字一致。

### 3.2 问③ 生效了吗（真被生产代码调用）

🔴 **"单测绿" ≠ "生效"**（判据源同 §0，:113-120）。
判据＝**探针证据文件非空**：起一次真实路径（`Sentinel.check()`），断言 `manifest.computes[]` 每一支**确实被调用**（证据文件里出现对应 hook 行）。
反例（必红）：实现存在、单测通过、生产从未调用 → 证据文件为空。
❌ 禁用 grep 型静态判据当验收（"有调用方" ≠ "被执行"）。

### 3.3 问④ 删干净了吗（契约 ⑥ 干净卸载）

出处：院方 `03-产品研究/产品定义/插件契约-经营视图.md:38`（七条契约 ⑥「干净卸载：移除后无残留」）。

**退役规约 = `_extinct/` 归档，不是 `rm`**（保历史，K3 可回溯）：

1. `git mv extensions/sentinels/<id> extensions/sentinels/_extinct/<id>`
2. 从顶层 `manifest.json` 的 `sentinels.<领域[]>` **移除**该 id
3. 全局残留检索必须零结果：
   ```bash
   grep -rn "<id>" src/ extensions/ --include=*.ts | grep -v '/_extinct/'
   ```
4. 退役留痕（参照 D922 可逆留痕机制，`install-dsh-preset.sh` 的注释即退役块是活样板）：
   ```bash
   grep -rn "^#.*<id>|" scripts/control-tower/*.sh
   ```
5. **反证（证据文件不再增长 + 活跃清单自曝消失）**：
   ```bash
   before=$(stat -f%z <evidence.jsonl>); <跑一次真实路径>; \
   test "$(stat -f%z <evidence.jsonl>)" -eq "$before" && echo CLEAN-OK
   ```

🔴 **五条一起过才算"删干净"**。只做第 1 步 = 未完成（顶层索引仍会加载它）。

---

## 4. 边界（synova-sentinel 不改什么）

- `src/sentinel/**`（loader / runner / registry 契约面）= **只读协作**；任何改动必须过产品线负责人（`synova-product-lead`），你只出提案 + 证据。
- 不动既有预设包的 prefix；不碰 `scripts/audit/**`；不写审计标准；不改 `ci.yml` / `scripts/**`。
- 禁 `--no-verify` / `git stash` / `force push`；走 PR，禁直推 main。
- 同类错误第二次 = 防线系统性失效 → 立即升产品线负责人 + CTO。

---

## 5. 自检（每次动哨兵面后必答，逐条带原始输出）

1. §2 脚本输出是多少？**改动前 / 改动后两个数都贴**。
2. 新 export 谁调用？`grep -rn "<新函数名>" src/` 的命中（铁律 0-2 WIRE CHECK；零结果 = 未完成）。
3. `manifest.computes[]` 与磁盘一致？（§2 脚本原始输出）
4. 有孤儿文件 / 死代码吗？（铁律 37：删除旧文件 + grep 零引用）
5. 改坏即红验过吗？（删一项 → 报红 → 恢复 → 回绿，四步都留输出）
