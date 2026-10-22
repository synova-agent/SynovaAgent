---
name: claim-verifier
description: 核实审计/测试/dev doc 声明 + 声称完成的物理证明。拿到任何"X 失败/Y 不工作/已完成"声明时使用。历史：D316 codex dev doc"实测"2 处不实 + 1 遗漏；D315 声称提交实未提交。
---

# claim-verifier — 声明核实 + 完成证明

## 使用时机
① 收到 dev doc / 审计报告 / 测试报告声称"X 失败 / Y 不工作 / 6/7 稳定失败"时——**不要照单全收，逐项独立实测**。
② 自己或他人声称"已完成 / 已交付 / 已推送"时——**必须物理证明，grep 说话**。

## 场景 1: 核实外部声明（防被审计骗）

1. **环境差异检查**（最高频误诊源）：
   - 声明者的运行环境 ≠ 我的环境。D316 案例：codex 声称"WinError 2 复现 + 6/7 稳定失败"，实测 Git Bash 会话 7/7 全过——bash 会话把 `Git\usr\bin` 前置进 PATH，而注册表 PATH 只含 `Git\cmd`
   - 区分两者：`reg query "HKCU\Environment" //v Path`（系统持久 PATH）vs `echo $PATH`（会话 PATH）
   - 结论必须写"环境依赖失败"（换环境即通过）还是"恒失败"
2. **确定性复现**：构造声明描述的环境，用绝对路径调用工具：
   ```bash
   env PATH="/c/Windows/system32:/c/Windows" $(command -v python3) scripts/.../tool.py ...
   ```
   复现不出来 = 声明在其环境下成立但在本环境不可复现 → 报告差异，不假装复现
3. **自己跑测试**：不信"稳定失败 N 次"的描述。实测输出为准。D316: 声称 6/7，实测 7/7
4. **grep 全仓库验证"无其他"类声明**：声称"无其他 X"必须自己 grep。D316: 声称"grep 无其他硬编码 [bash,"，实测 attach.py:92 同款
5. **区分缺陷与测试缺陷**：测试通过与否取决于运行环境 = 环境依赖测试（测试缺陷）→ 修复方式是加确定性断言（受限 PATH 构造 red→green），不是"让测试通过"

## 场景 2: 声称完成（防假交付）

逐项物理证明，缺一不可：

1. **grep 零引用**（铁律 47）：`grep -r "旧路径/旧符号" src/ --include="*.ts" --include="*.tsx" | grep -v "\.test\."` 零结果
2. **git status 无悬空修改**：D315 教训——38 个 UTF-8 文件"声称批量交付"从未提交（`git status --short` 还有 ` M` 就要追查）
3. **测试真跑过**：看输出和断言数，不凭记忆。`bash tests/.../*.test.sh` 的输出里"结果: N 通过, 0 失败"
4. **写集验证**：`bash scripts/workflow/check-dev-doc-write-set.sh`（dev doc 写集 vs 实际改动，漂移 0）
5. **审计基线**：`python3 scripts/audit/audit-check.py --full` 与基线一致（D316: 439 FAIL 不变）
6. **推送落库**：`git log origin/feat/prompt-architecture..HEAD` 为空
7. **独立 clone 交付声明**（V5.2.0 起）：交付声明必须写明在 `.sessions/<sid>/repo` clone 内完成；物理核验 = 交付分支存在于 GitHub origin + 主工作区无未提交代码改动（主工作区 = Codex 专用，出现 src/tests/scripts 改动即为违规信号）。"在主工作区直接改代码交付"的声称直接判不实

## 核实产出格式

结论必须三选一 + 证据：
- **属实**：复现命令 + 输出
- **不实**：反例证据（实测输出差异）
- **环境依赖**：哪个环境成立、哪个不成立，区分依据

不实的声明要**明说**（commit message / 报告里标注），不能为了"通过审计"而顺着不实声明修复。

## 历史案例索引
- D316: dev doc"6/7 稳定失败"不实（实测 7/7）；"grep 无其他"不实（attach.py:92）
- D315: UTF-8 批量"完成"但 38 文件未提交
- D286: 声称"只动 packages/, 零共享"实为 15 个 src/ 文件（写集漂移）
