// 生成 K4-b3-crosswalk-238.txt（用 fs 写文件，避开 PowerShell/Bash 的输出重定向编码问题）
// 用法: node docs/synova/product-lines/evidence/K4-b3-crosswalk-238.record.mjs
import { execFileSync } from 'child_process';
import { writeFileSync } from 'fs';

const SCRIPT = 'docs/synova/product-lines/evidence/K4-b3-crosswalk-238.mjs';
let body;
try {
  body = execFileSync('node', [SCRIPT], { encoding: 'utf-8', cwd: process.cwd() });
} catch (e) {
  body = `⚠ 运行失败（显式降级，不静默）\n${e.stdout ?? ''}\n${e.stderr ?? ''}\n`;
}

const header = `# K4 批 3 · #238 编号权威表 可映射性底稿（实测记录）

- 日期：2026-10-12｜base：\`ba1b22a8b5\`
- 生成方式（可复算）：\`node ${SCRIPT}\`
- 记录生成方式：\`node docs/synova/product-lines/evidence/K4-b3-crosswalk-238.record.mjs\`
- 口径：见脚本头「口径声明」；归一化 = 小写 + 只留 [a-z0-9]
- 编码：UTF-8 **无 BOM**（用 fs.writeFileSync 直写，不经 Out-File/Set-Content —— 见 A1：Windows 自造 BOM 属测量污染）

\`\`\`text
`;

const footer = `\`\`\`

## 本件测不出什么（B2 强制声明）

1. 只测「编号/命名可否按名字对应」，**测不出**语义等价是否成立（需裁定，非计算）。
2. **测不出**该边在图上是否真被使用（消费面属 #239 接线门禁）。
3. **测不出** \`packages/ontology/**\` 第二套词表的对齐情况（本件只看 \`extensions/ontology/\`）。
4. \`_patch_d66.cjs\` 的解析依赖源码书写形态；形态一变即降级，降级时**不静默**。

*本件为事实底稿，不是权威表。*
`;

writeFileSync('docs/synova/product-lines/evidence/K4-b3-crosswalk-238.txt', header + body + footer, 'utf-8');
console.log('written: docs/synova/product-lines/evidence/K4-b3-crosswalk-238.txt');
