# 实施任务清单

> 由 spec.md 生成
> 任务总数: 1
> 核心原则: 在现有展示排序上增加数值倍率排序，保持后端最低倍率切换语义不变。

## 依赖关系总览

Task 1（前端排序与回归测试）

## 变更影响概览

### 文件变更清单

| 文件 | 操作 | 涉及任务 | 说明 |
|------|------|---------|------|
| `chrome-popup-admin/popup.js` | 修改 | Task 1 | 激活置顶后按倍率升序、索引稳定兜底 |
| `test/chrome-popup-admin.test.js` | 修改 | Task 1 | 更新并补充排序行为断言 |

### 受影响接口

| 接口 | 变更类型 | 调用方 | 涉及任务 |
|------|------|------|------|
| `getVisibleConfigs()` | 内部排序行为变更 | `renderCards()` | Task 1 |
| `selectApiModeAutoSwitchTarget()` | 无行为变更，回归验证 | API 模式自动切换 | Task 1 |

### 构建系统变更

- 无。

## 风险与假设

| # | 描述 | 影响任务 | 假设/处理 |
|---|------|---------|----------|
| 1 | 真实倍率只存在于运行态快照，服务重启或同步失败时可能回落到本地倍率 | Task 1 | 统一读取快照 `item.rate`，同步成功时自然使用真实倍率，失败时使用本地倍率 |
| 2 | 混合展示 Token 与 API Key 时不应让 Token 参与倍率比较 | Task 1 | 无有效倍率的配置排在后面并按原始 index 稳定排序 |

## 任务列表

### 任务 1: [x] API 配置按倍率排序并补充回归测试
- 文件: `chrome-popup-admin/popup.js`（修改）, `test/chrome-popup-admin.test.js`（修改）
- 依赖: 无
- spec 映射: spec 章节 3.1、3.2、4.1、4.2、5.1
- 说明: 修改 `getVisibleConfigs()`，保持激活配置置顶；其余配置按有效数值倍率升序，倍率缺失或相同则按原始 index 稳定排序。补充前端排序断言，并验证现有后端最低可用倍率自动切换测试。
- context:
  - `chrome-popup-admin/popup.js:getVisibleConfigs()` — 管理弹窗列表过滤与排序入口
  - `chrome-popup-admin/popup.js:renderCards()` — 消费排序后的可见配置并渲染卡片
  - `openai.js:selectApiModeAutoSwitchTarget()` — 后端自动切换最低可用倍率配置
  - `test/chrome-popup-admin.test.js` — 前端行为静态回归测试
  - `test/openai-admin-refresh.test.js` — 后端最低倍率切换测试
- 验收标准:
  - [x] `node --test test/chrome-popup-admin.test.js test/openai-admin-refresh.test.js` 通过
  - [x] 排序比较顺序包含激活优先、有效倍率数值升序、缺失倍率兜底和 index 稳定排序
  - [x] 现有 `selectApiModeAutoSwitchTarget` 最低可用倍率测试通过
  - [x] 不修改 `openai.json` 持久化顺序和后端配置数组顺序
  - [x] Code Review PASS
  - [x] 测试通过
- 子任务:
  - [x] 1.1: 修改前端列表排序比较器
  - [x] 1.2: 更新前端排序回归测试
  - [x] 1.3: 执行目标测试并记录结果

## Spec 覆盖映射

| Spec 章节 | 任务 | 说明 |
|-----------|------|------|
| 3.1 功能性需求 | Task 1 | 覆盖激活置顶、倍率升序、缺失倍率兜底和自动切换回归 |
| 3.2 非功能性需求 | Task 1 | 覆盖展示层变更边界与测试要求 |
| 4.1-4.2 设计方案 | Task 1 | 实现排序键顺序和数值比较 |
| 5.1 测试计划 | Task 1 | 执行前端与后端相关测试 |
