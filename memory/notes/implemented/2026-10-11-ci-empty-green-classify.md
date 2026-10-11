---
状态: implemented
日期: 2026-10-11
决策: CI 第③步「空绿」必须**分类**（纯文档=合法跳过须显式标注／有代码改动=异常必 non-zero）；门禁复现器必须内置**判别力自检**（桩未被执行 ⇒ exit 2）
理由: 该步恒绿使「绿灯」失去信息量（实测连续 33 个 job 全为 `No test files found, exiting with code 0`）；且复现器自身出现「幻影可跑性」——桩从未被执行却报 6 场景全 PASS，属零判别力判据的最高危形态
---

# Note: CI 空绿分类判据 + 复现器判别力自检（K12 第 5 批 · #345）

## 背景与触发

CI 第 ③ 步（`.gitea/workflows/local-gates.yml`）用 `vitest run --changed "$CHANGED_BASE"`。
`vitest` 在**变更集无测试命中**时打印 `No test files found, exiting with code 0` ⇒ **该步恒绿**：
本机日志实测**连续 33 个 job** 全是这一行 ⇒ 该步不提供任何信息。

依据：**创始人裁决②** ＋ **CTO 裁定 004④**：「空绿区分两种 —— 纯文档 PR ⇒ 合法（但须显式标注）；
有代码改动却空绿 ⇒ 异常」。

## 决策（两条）

1. **第 ③ 步必须分类**（不是"一律变红"，也不是"一律绿"）：
   ```
   变更集空            ⇒ 合法跳过（绿 + 显式标注「无对象可测」）
   变更集非空且全非代码面 ⇒ 合法跳过·纯文档（绿 + 显式标注）
   变更集含代码面/测试面  且 vitest 报 No test files found ⇒ 🔴 异常 ⇒ exit 1（列出具体文件）
   vitest 真失败（非空绿） ⇒ 照旧 exit 1
   ```
   代码面判定面（`^(src|tests|scripts|packages|extensions|expert|knowledge|theory)/|^\.(gitea|github)/`）。

2. **门禁复现器必须内置判别力自检**（纪律④「反例必红本身要被验」的机器化）：
   场景执行后若**未见桩的哨兵字样**（或出现真 npx/vitest 痕迹）⇒ 该场景结论**作废** ⇒ **exit 2**。
   理由：复现器若跑的不是被测对象，它给出的"PASS"是**假绿**，比没有复现器更糟。

## 🔴 本批实证（最高危形态：幻影可跑性）

复现器 `scripts/control-tower/ci-emptygreen-sim.sh` 的前两版，**vitest 桩从未被执行过**，
而 6 个场景中有 4 个报「PASS」：

```
· 根因①：step 正文自带 `PATH="/Users/wane/.nvm/…/bin:$PATH"` —— **前置**覆盖了复现器放 PATH 首的桩
  ⇒ 解析到**真 npx**（实测 `npm error code EPERM`；真 vitest 在 node_modules 上跑假 .test.ts ⇒ ReferenceError）
· 根因②：甲/乙 之所以仍「PASS」—— 真 vitest 恰好也打印 `No test files found`
  ⇒ 与桩**同效** ⇒ 两版不可区分 ⇒ 零判别力（**这是最隐蔽的一层**）
· 正解：真 npx 的解析优先级 = `$PWD/node_modules/.bin` **先于** PATH
  （实测：桩放 PATH 尾 ⇒ 真 npx 接管；桩放 `node_modules/.bin` ⇒ 桩命中）
  ⇒ 桩位必须与**真 CI 的解析路径一致**
· 根因③：heredoc 未加引号 ⇒ 安装期展开 `$0` ⇒ 桩恒取默认模式（丁/戊 恒空绿）
· 根因④：`clean -qfdx` 清掉 node_modules ⇒ 桩须**每场景重建**
```

**一般化教训（可迁移）**：桩/替身类复现器，必须**同时**满足两条，缺一即假绿 ——
① 替身真被执行（要哨兵断言，不能靠"结果看起来对"）；② 替身的取值真被消费（要区分"同效"与"生效"）。

## 落点

- `.gitea/workflows/local-gates.yml` 第 ③ 步正文（仅此步；①②①b 步不动）
- `scripts/control-tower/ci-emptygreen-sim.sh`：逐字抽出该步正文 + 沙箱真 git 仓控变更集 +
  vitest 桩（**放 `$REPO/node_modules/.bin/`**）控空绿 + 6 场景 + 判别力自检 ⇒ exit 0/1/2
- `tests/control-tower/ci-emptygreen-sim.test.sh`：配对测试（10 项），含**副本改坏即红**
  （经 `SYNO_EG_WF` 指向副本，真工作流零写入 ⇒ 型 D 防误伤）

## 顺带根治（有最小复现）

`$VAR` 紧跟多字节字符且 `set -u` 时，bash 把该字符的**字节吞进变量名**
⇒ 误报 `WF_BEFORE<乱码>: unbound variable` 并**指向错行**（白查一轮）。
隔离复现：`echo "x！$WF_BEFORE ⇢ $WF_AFTER"` ⇒ 报错。
修法：一律 `${VAR}` **显式定界** + 补空格（本仓同型 4 处已清零）。

## 边界与已知缺口

- **不改**判据面：`scripts/pre-commit-check.sh` 的 13 组、`check-board-truth.ts`、`check-architecture.sh` 均未动。
- 🔴 **已知缺口（报 CTO 裁，本 PR 未修）**：第 ③ 步**基线 ref 不存在**时 `git diff` rc=128 ⇒ `|| true`
  ⇒ `N_FILES=0` ⇒ 走「合法跳过」**绿**（**fail-open**，已取证）。本机 CI 必有 `origin/local-main`，
  触发面窄；但该模式与裁定 004「看不见 ≠ 没问题」相冲。
- 复现器内写死本机路径 `/Users/wane/.ci-work/SynovaAgent`（仅用于沙箱替换）⇒ 换机不可用（非本卡范围）。
