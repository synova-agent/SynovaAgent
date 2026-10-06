# D1169 — D1：`DOCS-REGISTRY.yaml` 修到可被真解析器 load（proposed）

- **日期**: 2026-10-06 ｜ **线**: 治理线（govl）｜ **分支**: `fix/govl-d1-registry-yaml` ｜ **卡号**: D1169
- **状态**: proposed（已实现 + 实测；**按 CTO 2026-10-06 裁决③ 搁置不推进** —— D 组排最后）
- **任务**: D1169

## 决策

1. **CTO 的 D1 只点名了 `:118`，实测有第二处**（记 S-05：引用他人数字前必复核，含 CTO 的）：
   - `:118` `note: "…（E:\ClawOrg-BOX …）"` —— 双引号标量里 `\C` 是**非法转义**（`found unknown escape character`）。
   - `:285` / `:291` —— 两个条目用 **4 空格**缩进，同文件其余 **57** 个条目用 2 空格 ⇒ 解析到 `:277` 报
     `did not find expected key while parsing a block mapping`。
     **注意归因**：`:283-284` 的注释（插在序列中间）本身**合法**；真实病灶是**缩进不一致**。
     不能把"注释插在中间"当病因（那会导致下次有人只删注释而没修缩进 ⇒ 病还在）。
2. **只改缩进与转义**：逐一核 diff —— 无任何 `id` / `path` / `status` 语义值被改动。
3. **🔴 更正我自己第 2 轮的一处错判**：当时把 `tests/control-tower/verify-doc.test.sh` 的失败判为
   「本地环境相关（工作树有未提交改动）」。本轮定位真因 = `scripts/ci/verify-doc.sh` 的 `$DOC_ARG（`
   —— `$VAR` 紧跟**全角左括号 U+FF08**，**bash 3.2** 会把该字符的尾字节并进变量名 ⇒ `DOC_ARG\uFFFD: unbound variable`。
   **不是环境相关，是真 bug**，且**同族在册**：`scripts/control-tower/scan-fullwidth-vars.sh` 报
   「mac 域：7 文件已清 / 违规 **8 处** / **6 文件** → 待新卡」。本卡**只靶向修 1 处**
   （让那个夹具在 bash 3.2 下不再假红），**不冒领全族**。

## 关键证据（三要素齐）

| 证据 | 数值 | 命令 | 时刻 | 口径 |
|---|---|---|---|---|
| 修前 YAML | `Psych::SyntaxError: found unknown escape character … at line 118` | `ruby -ryaml -e 'YAML.load_file(…) '` | 2026-10-06T16:4xZ | 工作树 |
| 修 `:118` 后 | `Psych::SyntaxError: did not find expected key … at line 277` | 同上 | 同上 | **暴露第二处** |
| 修两处后 | **YAML OK**，`top keys: ["documents"]` | 同上 | 同上 | 工作树 |
| 登记门禁 | exit 0（检查 0 个文档 / 0 个未登记） | `bash scripts/doc-system/doc-registry-gate.sh` | 同上 | 同上 |
| 门禁夹具 | 18 通过 / 0 失败 | `bash tests/doc-system/doc-registry-gate.test.sh` | 同上 | 同上 |
| `verify-doc` 夹具 | **5 通过/3 失败 → 7 通过/1 失败** | `bash tests/control-tower/verify-doc.test.sh` | 同上 | 同上 |

## 未做 / 残留（V-09，如实列）

- **`verify-doc.test.sh` 残留 1 失败**：`降级: exit 1 但缺拒绝语义输出`。
  已排除 `grep -P`（该脚本用的是 `grep -oE`，且本机 `grep -P` 不支持已实测）。
  **CI 侧该夹具是绿的**（它在 `Control Tower Gate Tests (ubuntu-latest)` 的密封清单内，该 job 长期 SUCCESS）
  ⇒ 判为 **bash 版本相关（3.2 vs 5.x）**，**未定位到具体行** —— **不写成"已核"**。
- **全族 8 处/6 文件**未动（归 CTO 已记的「待新卡」，号由 CTO 发）。
- 未跑 `js-yaml`（CTO 判据原文点名 js-yaml）：本机该包不可用，改用 **ruby/psych**（同为合规 YAML 1.1 解析器）
  ⇒ **口径差异如实标注**；CI 侧可用 `npx js-yaml` 复核。


---

## 复核整改（D1183，2026-10-06）—— 复核定位于**:135**，且抓到**根因是扫描器盲区**

### 复核的结论（#1186 = 有条件通过）
- YAML 主判据**逐条证实**：main `Psych::SyntaxError … line 118` → 本支 `OK docs=59`；`git diff -w` 证明忽略空白后**只剩 `\C`→`\\C` 一行**，**无任何 id/path/status 语义值改动** ✓
- main 缩进分布 `57×2 / 2×4 / 共 59` ✓
- 🔴 **但「verify-doc bash3.2 可移植」未达成**，且复核把残留**定位到了 `:135`**（我上一轮写「未定位到具体行」）。

### 🔴 根因是**扫描器盲区**（这条比 :135 本身更值钱）
`scripts/control-tower/scan-fullwidth-vars.sh` 的 `FULLWIDTH_ALT='（|）|：|，|。|；|、'` **不含 `「」`**
⇒ 对**仍含 `$FIRST」`** 的文件，扫描器报 **「0 处违规 / exit 0」**
⇒ **「扫描器绿 = 修完了」是假绿** —— 这正是同一族缺陷能在 `:135` 存活至今的原因。
（复核另注：该行注释自称"6 字符类"而实际列了 7 个，**口径本身也不自洽**。）

### 本轮修
1. `scripts/ci/verify-doc.sh:135` —— `$FIRST」` → `${FIRST}」`（**同一族的第二实例，这次在可执行代码里**）
2. `scripts/control-tower/scan-fullwidth-vars.sh` —— 字符类补全 CJK 成对标点：`「」『』《》【】""''`

### 判据（**修前 4/4 → 本轮修后 8/0**）
```
bash tests/control-tower/verify-doc.test.sh    ⇒ 结果: 8 通过, 0 失败
```
🔴 复核实测修前是 **4 通过 / 4 失败**（我上一轮写「5/3」—— **我的数字不复现**，如实更正为复核的 4/4）。
