# 决策 Note — FIX-008：测试输出隔离（founder-truth 生成物不再写 tracked 路径）

- 状态: proposed（待独立复核后 git mv 到 implemented/）
- 日期: 2026-09-26
- 卡: 台账 FIX-008（M8 家族「测试副作用碰 tracked 文件」**第 3 例**，复现确立）｜分支 `fix/fix008-test-isolation`（非栈式，base = `origin/main` @ `ef299746`）
- 决策: 生成器输出目录加 **env 注入缝** `SYNO_FOUNDER_OUT_DIR`（缺省 = 现状 `REPO/docs/synova`，**生产行为不变**）；测试全部生成调用改走 `mktemp -d` 隔离目录；闭环判据 = 「跑完仓库脏度不增加 + 两个生成物 porcelain 为空」。

## 依据（可核）

- 复现原始输出：修前跑一次 `tests/control-tower/founder-truth.test.sh` →
  `git status --porcelain` = ` M docs/synova/founder-alerts.md` + ` M docs/synova/founder-console.html`（diff 17+/9-）。
- 写点：`scripts/control-tower/founder-truth.py:32-33`（`HTML_OUT`/`ALERT_OUT` 硬编码 `REPO/docs/synova/`）+ 写入 `write_alert()` / `--html` 分支。
- 触发：`tests/control-tower/founder-truth.test.sh:75`（`python3 "$GEN" --offline --html`）。
- 影响：跑测试即污染工作区 → 切分支/提交被拦（同族前两例：product-lines refresh、founder-console）。

## 关键设计决定

1. **加缝不改径**：`SYNO_FOUNDER_OUT_DIR` 缺省 = 现路径 ⇒ 生产（cron 拾取告警文件、`--html` 落 `docs/synova/`）行为零变化；测试用隔离目录。
2. **判据用增量语义**：绝对量「porcelain 为空」在**干净树**上成立；在他人未提交改动存在的树上，须判「**本测试不增加脏度**」——两者等价于同一判别力（基线干净 ⇒ 不增加 ⇔ 为空），但后者不会把别人的脏算到本测试头上。
3. **判别性靠沙箱反例**：同一 `gen_paths_dirty()` 实现在**沙箱 git 仓**里对「故意改 tracked 生成物」必须报红（`前=0 → 后=1`）——不在真仓库制造脏树。
4. **不碰既存红**：该夹具在 main 上另有 3 条失败断言（`正常: 输出结构异常` / `判定: 缺红绿灯标记` / `北星对齐…`），实测为**夹具自身 EPIPE 缺陷**（`set -uo pipefail` 下 `echo "$OUT" | grep -q` → `echo` 写破管 → 管道状态非 0，**与内容是否存在无关**；落盘后直连 grep 全部命中：创始人控制台=1/小结=1/诚信账本=1/北星对齐=1/CI 最近一次=1/红绿灯=371/诚信%=32），失败集合还随调度抖动。按 lead 口径**不改其断言**，另立卡。

## 参考系

第一性原理（测试的可观测副作用必须私有）＋ Anthropic 工程基线（判据可判别 + 变异体改坏即红）＋ 仓内先例（控制塔既有 `SYNO_*` env 注入缝模式；M8 家族台账）→ 结论：env 缝 + 隔离目录 + 增量判据 + 沙箱反例。

## 夹具（改坏即红，可复跑）

```
bash tests/control-tower/founder-truth.test.sh
  [⒜] 仓库脏度: 跑测试前=2 跑测试后=2；生成物 porcelain 行数: 前=0 后=0
  ✅ FIX-008⒜ 隔离: 生成物 git status 为空（绝对判据）
  ✅ FIX-008⒜ 隔离: 本测试未增加仓库脏度
  ✅ FIX-008⒜ 隔离: HTML 实落在隔离目录
  [⒝] 沙箱脏树: 改动前 porcelain 行数=0 → 故意改 tracked 后=1
  ✅ FIX-008⒝ 反例: 同一判据在脏树报红（判别性成立，非恒真）
```

## blast radius

- 调用方：`founder-truth.py` 仅被该测试直接调用（`grep -rn "founder-truth"` 无 CI workflow 引用）；生产使用 = cron + `--html`，缺省路径不变 ⇒ 影响面 = 测试夹具本身。
- 未提交生成物改动；实验污染已 `git checkout --` 还原。
