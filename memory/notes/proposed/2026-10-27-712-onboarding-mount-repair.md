# #712 返修批：#1056 R-A「阻断」项 —— ⑤ 确认语义 ＋ ① 磁盘零断言

## 现状（改前实测）

`tests/extensions/onboarding-mount.test.ts`（`ct/p3m7-pr5`，HEAD `760c88ab0`）两处把缺陷固化成判据：

1. **⑤ `body.rootDir` 用例**（`dryRun:false`，**不带** `superAdminConfirmed`）期望 `200` ＋ 落盘 3 件
   ⇒ 一旦 #1067 把确认门装到入口，合并态**必红**（`expected 409 to be 200`）；
   若为消红而弱化门 ⇒ 把 C1 缺陷（未确认 ⇒ 写盘）写进判据（R-A 活2 §3）。
2. **① `apply` 未确认用例**只断 `409` ＋ `code`，注释自述「此处不设断言」（写于 #1067 之前的过期口径）
   ⇒ **门序回归在全套测试里不可见**：反向突变（门判定移回 flow 之后）实测 **6/6 假绿**（R-A 活2 §4）。

改前基线（本 session 原始输出，Node v22.23.2）：

```
node node_modules/.bin/vitest run tests/extensions/onboarding-mount.test.ts
 Test Files  1 passed (1)
      Tests  6 passed (6)          EXIT=0
```

同一跑日志内 `service:"onboarding/config-pack-generator" … "dryRun":false,"written":3`
⇒ **"6 绿" 与 "未确认路径实写 3 件" 同时成立** —— 假绿形态成立，非推测。

## 决定（4 处，均在唯一仓库文件内；判据零放宽）

| # | 落点 | 改动 |
|---|---|---|
| ① | ⑤ 用例请求体 | 加 `superAdminConfirmed: true`（⑤ 判据目的是 **rootDir 隔离**，不是确认语义） |
| ② | ① 用例 409＋code 之后 | 补 `expect(walkFiles(root)).toEqual([]);`（磁盘零断言；`walkFiles` helper 文件内已有） |
| ③ | `issueToken()` nonce 行 | 加注释「唯一性 nonce，不参与断言期望值（Q-6 时间语义不适用）」 |
| ④ | ① 内联注释 ＋ 文件头「已知限制 ⑤」 | 过期口径同步 ⇒ 说明「本磁盘零断言**依赖 #1067 的门序修复**」 |

- **只加断言与注释**，不改任何既有期望值／不改被测对象（`src/**` 一行未动）。
- 第 ④ 项**多同步了文件头一处**（原写「本文件只断 409 + code」）：补断言后该陈述即为假，
  不同步＝留假陈述（与 ① 同型的过期口径），故一并改为「以磁盘零断言钉住门序」。

## 依据

- R-A 回执「活2 #1067 · 确认门」§3（⑤ 与裁 425-C1 语义冲突，修法＝一行）与 §4（门序回归不可见，
  最小红例＝① 加 `expect(walkFiles(root)).toEqual([])`）。
- 裁 425-C1：未确认 ⇒ **不落盘**（确认门在 `runOnboardingFlow` 之前）。
- 本 session 实测（命令＋原始输出＋退出码＋merge sha 全量贴 PR #1056 正文 a–d）：
  单支 **1 failed / 5 passed**（`#1067` 不在该支 ⇒ 预期红，非回归）；
  合并态（`ct/p3m7-c1-gate` merge sha 见 PR 正文）**6 passed / EXIT=0**；
  合并态突变 `const input = requested`（复刻 C1 缺陷）⇒ ① 红
  （`AssertionError: expected [ …(3) ] to deeply equal []`，列出实写 3 件）⇒ 复原后转绿。

## 生效时点

- 合并序列：#1056 须与 #1067 **成对**合入（先合 #1056 ⇒ 单支 CI 红；先合 #1067 ⇒ #1056 CI 红 ——
  两个方向都是「成对」的证据）。
- 单支 `ct/p3m7-pr5` 上 ① 的磁盘零断言**恒红**（该支无确认门）⇒ 评审／验收一律以**合并态**为准，
  并以本文件与 PR 正文显式声明，禁止为转绿而弱化断言。

## 已知限制

- 磁盘零断言覆盖 `process.cwd()` 落盘根（临时根）**仅本进程路径**；其它入口（如外部进程）落盘面不在本断言内。
- 本断言钉「未确认路径零落盘」；**未**覆盖「确认与否对 `deploy` 步状态的影响」以外的门序旁路（如中间件层再收紧）。
