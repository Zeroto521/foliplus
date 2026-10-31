# Description

<!-- What this PR changes and why. -->

## Gate

- [ ] `make check` 全绿（本地可复现的门：typecheck / 改动文件 prettier+eslint+ruff / 全仓 listener-guard + toolchain-guard / 改动文件相关 vitest+pytest / changelog_check + mojibake_check + dead_barrel_export）
- [ ] PR CI 全绿（全量 JS/Python 测试、docs 构建、bundle 尺寸门、browser 测试 —— 这些由 CI 负责，本地不跑）

## 本地不可复现的门（只靠 PR CI）

- py3.11 / py3.15 版本矩阵
- codecov 平台计算（patch / project）
- GitHub runner CPU 饥饿型 flake
