# COMPARE.md — IntentStore 收放字段级双向比对面清单

> PR① 验收依据。先落盘再动代码。对照旧实现逐字段保证值/行为零变化。
> 旧 = `ui.intents` + `ui.intentProvenance` + `state.ts` 收放 / `persistence.ts` 解析。
> 新 = `IntentStore`（`Map<id, IntentRow>`）+ 同名薄函数委托。

## 1. 类型映射

| 旧 | 新 | 说明 |
|---|---|---|
| `ui.intents: Record<string, LayerIntent>` | `IntentStore` 行内 `intent: LayerIntent` | 值轴。键集相同 |
| `ui.intentProvenance: Record<string, LayerOverride[]>` | 行内 `provenance: Set<LayerOverride>` | 来源轴。数组 ↔ Set（插入序） |
| `PersistedLayerState` | 不变 | 磁盘形状，序列化格式零变化 |
| `LayerOverride` / `LayerIntent` / `INTENT` / `LIVE` | 不变 | 词汇表不动 |

`IntentRow = { intent: LayerIntent; provenance: Set<LayerOverride> }`
行存在条件 = intent 有键 **或** provenance 非空（与旧 `ui.intents` 行存在条件一致）。

## 2. 值键 ↔ 来源键

| LayerOverride (来源) | LayerIntent / PersistedLayerState (值) | LIVE 规则 | dropRow 保留？ |
|---|---|---|---|
| `visible` | `visible` | `typeof === "boolean"` | 否（style） |
| `fillColor` | `fillColor` | `typeof === "string"` | 否 |
| `fillOpacity` | `fillOpacity` | `typeof === "number"` | 否 |
| `borderColor` | `borderColor` | `typeof === "string"` | 否 |
| `borderWeight` | `borderWeight` | `typeof === "number"` | 否 |
| `opacity` | `opacity` | `typeof === "number"` | 否 |
| `zoomRange` | `zoomRange` | `Array.isArray` | 否 |
| —（无来源） | `name` | `typeof === "string"` | **是**（骑手，manager 单独清） |
| —（无来源） | `annotation` | `value != null` | **是**（骑手，annotation destroy 清） |

## 3. `toPersisted` ↔ 旧 `buildLayerStates`（写侧，逐字段）

输入：live annotation map（`ui.m.annotation.configEntries()`）+ store 内行。

| 字段 | 旧 buildLayerStates | 新 toPersisted | 等价条件 |
|---|---|---|---|
| 入选 id 集合 | `keys(intentProvenance) ∪ keys(annotations) ∪ keys(intents)` | `store.ids() ∪ keys(annotations)` | `store.ids()` = 旧行键并集 |
| 跳过条件 | `declared.length===0 && !annotation` | 同 | — |
| `overrides` | `provenance[id].filter(hasLiveValue)`，保持原数组序 | `[...provenance].filter(hasLive)`，Set 插入序 | 数组 push 序 == Set 插入序 |
| 各 override 值键 | `getIntent` 且 `LIVE(value)` 才写入 | `store.get` 且 `LIVE` 才写入 | 键名与值一一对应 |
| 值不 live 时 | 值不写；但 override 仍在 declared 里（先 filter 过） | 同 | 先 filter 再写 |
| `annotation` | `annotations[id]`（live manager，不是 intents 种子） | 由调用方传入 live map，同键写入 | **不读 store 的 intent.annotation** |
| 无 entry | 不出现在结果 | 不出现 | — |

**双向断言**：对同一输入状态，`toPersisted(liveAnn)` 与 `buildLayerStates` 产物 `toEqual`（含 `overrides` 数组序）。

## 4. `loadFromPersisted` ↔ 旧 `loadPersistedState` 意图半边（读侧，逐字段）

输入：`PersistedRecord` 已 parse 后的 `renamedNames` / `annotations` / `layers`（即 `parseLayerState` 产物）。

| 步骤 | 旧 loadPersistedState | 新 loadFromPersisted | 等价条件 |
|---|---|---|---|
| 清空 | `ui.intents = {}; ui.intentProvenance = {}` | `store.clearAll()` | — |
| 改名 | `setIntent(id, NAME, renamedNames[id])` | `store.set(id, "name", …)`（不进 provenance） | NAME 非 override |
| legacy annotation | `setIntent(id, ANNOTATION, annotations[id])` | `store.set(id, "annotation", …)`（不进 provenance） | 后写覆盖 |
| layers.annotation | `entry.annotation` 有则覆盖上一步 | 同（后写覆盖） | 新键 WINS |
| layers.overrides → provenance | `ui.intentProvenance[id] = [...entry.overrides]` | `store.seedProvenance(id, entry.overrides)` | 数组 → Set 插入序 |
| layers 值 | 遍历 overrides，`LIVE(value)` 才 `setIntent` | 同；`set` 对 override 键**不**再 mark（来源已 seed） | 防止半截写误 mark |
| 无 entry 的 id | 不建行 | 不建行 | — |

**注意**：`set` 的「写值即 mark」只对**用户动作**路径；`loadFromPersisted` 走 seed 语义——先 seed provenance，再写值，或 `set` 提供 `mark: false` 内部路径。外部 `set` 一律 mark（禁止半截写）。

## 5. `PARSE_OVERRIDE` ↔ store 读入（磁盘 → 内存）

`parseLayerState` 留在 `persistence.ts` 不动。等价链：

```
raw → parseLayerState → PersistedLayerState → loadFromPersisted → IntentRow
raw → parseLayerState → 旧 loadPersistedState → ui.intents + ui.intentProvenance
```

| PARSE_OVERRIDE 键 | 校验 | 规范化 | 无值/非法 | 落入 |
|---|---|---|---|---|
| `visible` | `typeof boolean` | 原值 | `null` → 丢 marker | `intent.visible` + provenance |
| `fillColor` | hex `#rgb`/`#rrggbb` | `normalizeHexColor` | 丢 | `intent.fillColor` + provenance |
| `fillOpacity` | `[0,1]` finite | 原值 | 丢 | `intent.fillOpacity` + provenance |
| `borderColor` | hex | `normalizeHexColor` | 丢 | `intent.borderColor` + provenance |
| `borderWeight` | `[MIN,MAX]` finite | 原值 | 丢 | `intent.borderWeight` + provenance |
| `opacity` | `[0,1]` finite | 原值 | 丢 | `intent.opacity` + provenance |
| `zoomRange` | `[min,max]` finite, min≤max | 原值 | 丢 | `intent.zoomRange` + provenance |
| `annotation`（非 override） | object | color 规范化 | `null` 不写 | `intent.annotation`，无 provenance |

**双向断言**：`loadFromPersisted(parseLayerState(raw))` 后 store 状态 与 旧 parse+load 后 `ui.intents`/`ui.intentProvenance` 一致（见 §3/§4 dump 面）。

## 6. overrides 数组 ↔ Set 往返

| 方向 | 规则 |
|---|---|
| 数组 → Set | `[...arr]` 去重保插入序；`parseLayerState` 已按 `OVERRIDE_VALUES` 过滤，序 = 原 overrides 数组中合法项的相对序 |
| Set → 数组 | `[...set]` = 插入序 = 原数组序（mark 推入序；load seed 序） |
| 空 | `[]` ↔ 空 Set；旧侧 `delete intentProvenance[id]` ↔ 新侧 provenance 仍空且 intent 无键时删行 |
| 往返 | `toOverridesArray(toSet(arr))` deep-equal `arr`（去重后） |

单独断言（不与值混写）。

## 7. 函数薄委托映射（同名，spy 面零改动）

| 旧函数 | 新实现 | 调用方 |
|---|---|---|
| `loadPersistedState(ui)` | foldedGroups 照旧 + `store.loadFromPersisted(...)` | lifecycle |
| `buildLayerStates(ui)` | `store.toPersisted(liveAnnotations)` | saveState |
| `markOverride(ui,id,ov)` | `store.mark(id,ov)`（无 live 值则 warn 并拒绝） | fill/border/opacity/zoom/setVisible |
| `unmarkOverride(ui,id,ov)` | `store.unmark(id,ov)` | reset 路径 |
| `dropPersistedLayerState(ui,id)` | `store.dropRow(id)`（丢 style 值+provenance，保 name/annotation） | manager.deleteLayer |
| `saveState` / `saveNamesState` / `saveFoldState` / `setVisible` / `applyUserState` | 逻辑不变，读面改走 store | 同左 |
| `setIntent` / `getIntent` / `clearIntent` / `dropIntent` / `hasIntentValue` / `seedIntentMap` | 薄委托 `store.*` | 各 style/visibility 等 |

`LayerUI` 上的 delegate 方法（`dropPersistedLayerState` 等）签名与存在性不变。

## 8. 内聚约束（禁止半截写）

| 操作 | 值 | 来源 |
|---|---|---|
| `store.set(id, overrideKey, v)`（用户动作） | 写 | **同时 mark** |
| `store.clear(id, overrideKey)` | 删 | **同时 unmark** |
| `store.set(id, "name"\|"annotation", v)` | 写 | 不 mark |
| `loadFromPersisted` 内部写值 | 写 | 不额外 mark（来源已 seed） |
| `store.mark` / `store.unmark` | 不动值 | 单独动来源（薄委托用；mark 无 live 值拒绝） |

## 9. 行为不变量（回归锚点）

1. 序列化格式不变：`PersistedRecord` / `PersistedLayerState` 字段与语义不变；localStorage 兼容。
2. 值缺省 = 未选：无 provenance 的维度读取回落 author 默认。
3. `overrides` 只含用户真正设置且值 live 的维度；值丢则 marker 丢。
4. `dropRow` 不碰 name/annotation 骑手。
5. annotation 写侧用 live manager 配置，不是 intent 种子。
6. mark 无 live 值 → warn + 拒绝（`markOverride` 日志文案不变）。
7. 6k 基准不回退；fill/border/styleBag 覆盖 100% 不回退。

## 10. 测试面改动范围（非 spy）

- **零改动**：`vi.spyOn` 于上述导出函数；调用方 `setIntent+markOverride` 等成对写法。
- **需改**：直接读写 `ui.intents` / `ui.intentProvenance` 的 fixture 与用例 → `ui.intentStore`（seed/dump/isUserSet）。
- **序列化兼容新断言**：§3 双向、§4 双向、§6 往返。
