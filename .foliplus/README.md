# .foliplus/ — DSH Windows 沙箱下的 Vitest 运行指南

**适用场景**：在本项目（foliplus）的 DSH Windows 沙箱会话里跑 `npm test` / `vitest`。
**范围**：仅限 Windows + DSH 沙箱环境；macOS / Linux / 正常开发机不需要这套 workaround，也不需要本目录。
**版本归属**：环境特有，**不提交**版本库。每次 `npm install` 重建 `node_modules` 后，只需补一道命令（见下方"日常用法"）。

---

## 一句话根因

当前 DSH Windows 沙箱会把 `child_process.spawn` 全局拦成 `EPERM`。
Vitest 8 / Vite 8 在启动时和并发调度时**都要 spawn 子进程**，于是必然崩溃。

---

## 你会看到的三种症状（按出现顺序）

### 症状一：`npm install` 直接失败，node_modules 被清空

```
npm error Error: spawn EPERM
npm error syscall spawn
npm warn cleanup Failed to remove some directories
npm warn cleanup [ ... ]
```

**原因**：`esbuild` / `vite` / `rolldown` 这些原生包的 `postinstall` 脚本要 spawn 子进程，被沙箱拦；npm 一报错就把整棵 node_modules 扫掉。

**还附带一个陷阱**：失败那次会留下残骸——`@rolldown/binding-win32-x64-msvc` 里的 `.node` 文件头是 `7F 45 4C 46`（Linux ELF），不是 Windows PE（应为 `4D 5A`）。下次装完即使成功，rolldown 也会报 `not a valid Win32 application` → 走 WASI 回退 → `@rolldown/binding-wasm32-wasi` optional dependency 又没装进来 → Vitest 启动报 `Cannot find native binding`。

### 症状二：`npx vitest` 启动时 `spawn EPERM`

```
[plugin externalize-deps]
Error: spawn EPERM
    at optimizeSafeRealPathSync (vite/dist/node/chunks/node.js:...)
```

**原因**：Vite 8 在加载 `vitest.config.mjs` 时会 `exec("net use")` 探测网络驱动器、再拼真实路径。这个 exec 内部走 spawn，被沙箱拦。

### 症状三：worker "never initialized" / "Timeout waiting for worker to respond"

```
[vitest-pool]: Failed to start forks worker for test files ...
Caused by: Error: [vitest-pool-runner]: Timeout waiting for worker to respond
```

**原因**：vitest 默认用 **forks 池**，给每个测试文件 spawn 一个独立 Node 子进程。同样 EPERM。worker 永远起不来，主线程等超时。

---

## 完整修法

### 1) 装依赖时跳过 postinstall 脚本

```
npm install --ignore-scripts
```

必须带 `--ignore-scripts`。这样原生包的 postinstall 不跑，node_modules 就完整装完，不会被 npm 清理掉。

### 2) 打补丁，让 vitest 启动 + 所有 worker 都带上 spawn 绕过

```
node .foliplus/patch-vitest.mjs
```

做的事只有一件：在 `node_modules/vitest/vitest.mjs` 入口文件顶部前缀一行：

```js
import '../../.foliplus/vite-spawn-patch.mjs'
```

为什么放入口而不是用 `NODE_OPTIONS --require`：vitest 的 worker 进程/线程各自 bootstrap，`NODE_OPTIONS` 只有主进程继承，worker 里拿不到；把 import 放进 vitest.mjs，主进程和**每个 worker** 都会经过这里、都会带上 shim。

`vite-spawn-patch.mjs` 的行为：拦截 `child_process` 的 `spawn` / `exec` / `execFile` / `spawnSync` / `execSync` / `execFileSync`，把 vite 探测用的 `net use`、`cmd /c` 伪造成空输出；其余委托真实实现，沙箱拦住的降级为无害的"假子进程"（返回空的 stdout/stderr 并立即 emit `close`/`exit`）。单元测试本身是纯进程内的，不需要任何真实子进程，所以这套伪装配够。

### 3) 用 threads 池跑测试（不 spawn）

```
npx vitest run --coverage --pool=threads
```

`--pool=threads` 用 `worker_threads`（主进程内的线程），不 spawn 子进程。即使没补丁，threads 池也不会触发症状三。补丁是防症状二（vite 加载 config 时的 exec），两者一起用才稳。

---

## 日常用法（三行）

```
npm install --ignore-scripts
node .foliplus/patch-vitest.mjs
npx vitest run --coverage --pool=threads
```

跑通后的正常结果：

```
Test Files  75 passed (75)
Tests       1045 passed (1045)
Duration    ~90s
```

（`--coverage` 会额外生成 `coverage/` 和 `test-report.junit.xml`。）

---

## 目录结构

```
.foliplus/
├── vite-spawn-patch.mjs   # 真正的 shim（拦截 child_process，伪装 benign 命令）
├── patch-vitest.mjs       # 一键脚本：把 shim import 前缀到 node_modules/vitest/vitest.mjs
└── README.md              # 本文件
```

两个 `.mjs` 文件**不提交**版本库。`node_modules/vitest/vitest.mjs` 里的 1 行 import 也不用提交（`.gitignore` 已排除 `node_modules`）——每次重装后跑 `patch-vitest.mjs` 会用正确路径重写回来。

---

## 排错速查

| 现象 | 原因 | 处理 |
|---|---|---|
| `npm install` 报 `spawn EPERM` 并清空 node_modules | 没加 `--ignore-scripts` | 加参数重装 |
| `@rolldown/binding-wasm32-wasi` not found / native binding not a valid Win32 | 上次失败安装留下的 ELF 残骸 | `npm install --ignore-scripts` 重来即可覆盖 |
| `@vitest/utils` ERR_MODULE_NOT_FOUND（偶发） | 直接 import 正常，多半是并发/缓存抖动 | 重跑一次 |
| `spawn EPERM` at `optimizeSafeRealPathSync` | 没打补丁 | `node .foliplus/patch-vitest.mjs` |
| worker `never initialized` / `Timeout waiting for worker` | 用了 forks 池（默认），或补丁没进 worker | 加 `--pool=threads`；确认 patch 脚本已跑 |
| 补丁跑完 `node_modules/vitest/vitest.mjs` 没那行 import | patch 脚本路径变了（比如改过目录名） | 检查 `.foliplus/patch-vitest.mjs` 里 3 处硬编码是否一致 |

---

## 3 个遗留的业务断言失败（与沙箱无关）

截至最后跑通，`test/js/MeasureControl/ui.test.ts` 有 3 个失败：

```
FAIL attachDistanceUI > binds click handlers on the polyline and nodes
TypeError: delMarker.on is not a function         (ui.ts:188)

FAIL attachDistanceUI > creates a delete icon per node
TypeError: delMarker.on is not a function         (ui.ts:188)

FAIL attachPolygonUI > binds handlers and returns a map-click cleanup
TypeError: centroidDel.on is not a function       (ui.ts:405)
```

被测代码里 `delMarker` / `centroidDel` 拿到的是普通对象，没有 Leaflet 的 `.on()` 方法。这是业务测试/代码层的事，**不是环境问题**，需要单独查是 mock 缺对象还是 `ui.ts` 真 bug。
