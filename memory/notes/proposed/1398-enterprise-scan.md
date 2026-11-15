# 决策: #1398 中性首次企业扫描纵向薄片

状态: proposed
日期: 2026-11-15

## 现状

固定 base 的旧 CSV、文档路由和②写入缺少来源版本、自然键幂等及证据／实例状态分离；`standardKey` 会覆盖当前 props，`FileGuard` 对边界外只读默认放行，均不能直接承接首次扫描。最终 DEV DOC 与 Mandate 已将实现限定为合成资料、⓪证据接入和②结构映射。

## 决定

在唯一 `extensions/ontology` loader／validator 中新增交付样例类型；以 `(graph,type,businessKey)` 关联既有图身份；用 version 6 新表保存扫描、来源、证据版本、断言、授权、报告及关联。L2 只依赖端口，Bootstrap 用同一 Database 和 graphStore 装配 L4 store 与 L2 service。独立默认拒绝路径授权、可见证据先过滤、同步事务及提交前文件身份复检作为硬边界。冲突并列、缺失为 null，人的说明只证明陈述发生。

## 依据

- Gitea #1398 评论 12428 最终 DEV DOC，SHA-256 `b54cdd6a71447d059d04e5b4026ff6037402e0e794cbb44ba17dbbd98864d840`。
- 评论 12430 `synova-1b-transitional-v1` 的固定 base、分支、写集和验收。
- 固定 base 的实际代码调用链与测试；历史资产四类审计见 `docs/synova/coordination/编码指令-1398-1b-enterprise-scan-20261114.md`。

## 生效时点

本 Note 随 #1398 PR 留痕；PR review 与合并后才成为 main 行为。本批只声明合成资料开发验收，不声称真实客户验收、瓶颈识别或①③④⑤⑥能力完成。
