# DSH 0.2.x 第三方插件开发最佳实践（宿主半 + Web 客户端半）

> 面向对象：为 DSH 写插件的外部作者，产物是一个 npm 包，同时含 **Node 宿主半**与 **Web 客户端半**。
> 调研日期：2026-11-13。
> 版本基线：上游 `master` 为 `0.2.2-rc.2`（根包 `@deepseek-ai/dsh-root` 版本，见 [package.json](https://github.com/deepseek-ai/deepseek-harness/blob/master/package.json)）；本机安装的精确版本是 `0.2.2-rc.1`（`~/.dsh/profiles/node_modules/@deepseek-ai/dsh@0.2.2-rc.1/package.json`）。
> 引用约定：`【官方要求】`＝文档或源码明确规定；`【默认行为】`＝未配置时实际发生；`【本仓库】`＝当前仓库现状；`【推断】`＝由一手事实推导、无直接条文。

---

## 结论摘要

1. **一个包、两个入口。** 宿主入口是普通 Cordis 插件（`apply`/`inject`）；客户端入口由 `package.json` 的 `dsh.client`（必须含 `platform: "web"`）与 `exports["./client"]` 共同宣告，缺 `./client` 导出时宿主扫描直接抛错。来源：[packages/util/package-manifest/src/types.ts](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/util/package-manifest/src/types.ts)、[packages/client/modules/src/client/manifest.ts](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/modules/src/client/manifest.ts)。
2. **`dsh.bundle.patch` 与 `dsh.client` 是两种清单，回答两个问题。** 前者是"安装后往 profile 里插什么组合层"，后者是"浏览器半怎么被扫描、加载、排进启动图"。来源：[docs/user/develop/basic/publish.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.zh.md)。
3. **客户端 bundle 不是可 `import` 的 ESM。** 它是"执行即注册 factory"的 CJS 外壳：`window.__ModuleLoader__.load({ id, factory: (require) => { … return module.exports } })`；模块副作用（含 CSS 注入）都必须在 factory 闭包里，物化时才运行。来源：[packages/client/tsdown.client.ts](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/tsdown.client.ts)、[packages/client/modules/README.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/modules/README.zh.md)。
4. **React 必须外部化。** `PLATFORM_MODULES` 把 `react`、`react/jsx-runtime`、`react-dom`、`react-dom/client` 等冻结成模块表单例；bundle 只能通过 factory 拿到的同步 `require('react')` 取得同一实例，私自打包会得到第二份 React。来源：[packages/client/web/src/platform.ts](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/web/src/platform.ts)、[packages/client/AGENTS.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/AGENTS.md)。
5. **`dsh.client.external` 不是功能插件共享依赖的通道。** 基线外部化对所有动态 bundle 隐式生效；非基线 `external` 只允许基础设施、传输或生成装配声明，功能插件之间只能用 `import type` + Cordis service + slots。来源：[packages/client/AGENTS.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/AGENTS.md)、[docs/subsystems/web-client.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/web-client.zh.md)。
6. **宿主半的降级写法是"不 inject，`ctx.get` 探测"。** `inject` 是硬依赖（缺失即 PENDING）；可选能力应当跳过 `inject`，用 `ctx.get(name)` 读、失败记日志并降级。来源：[docs/cordis-tutorial/03-services.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cordis-tutorial/03-services.zh.md)、[docs/cordis-api/context.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cordis-api/context.zh.md)。
7. **开发循环的全部义务是"原地重写 `lib/client.js`"。** 客户端 HMR 自己按 `mtime/ctime/size` 轮询 bundle 并发 `rebuilt` 帧；`dev-web` 明确说明重载信令不归构建脚本管。来源：[scripts/dev-web.ts](https://github.com/deepseek-ai/deepseek-harness/blob/master/scripts/dev-web.ts)、[packages/client/hmr/README.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/hmr/README.zh.md)。
8. **重载是整块替换，React 状态必丢，失败不回滚。** 官方把"无 react-refresh 级状态保留"写成有意设计；旧的 fiber 卸载后导入/激活失败不会恢复旧 bundle。来源：[packages/client/hmr/README.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/hmr/README.zh.md)。
9. **source map：官方构建会生成，ModuleLoader 不读，宿主只按需读 sibling `.map`。** combo map 端点首次被请求时才读 `<clientPath>.map` 并校验 Source Map v3；缺失则合成 identity map。仅 map 变化不会触发重载。来源：[docs/subsystems/client-modules.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/client-modules.zh.md)、`~/.dsh/profiles/node_modules/@deepseek-ai/dsh-client-modules@0.2.2-rc.1/lib/index.js`。
10. **兼容性以 `engines.dsh` 为准，且 DSH 公共 API 自述 pre-stable。** 有 `engines.dsh` 时 installer/profile 只看它，缺失才回退 `@deepseek-ai/dsh*` peer；官方仓库同时声明 "Public APIs are pre-stable"。来源：[docs/upgrade-guide/v0.2.1-alpha.3/plugin-engines-dsh/guide.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/upgrade-guide/v0.2.1-alpha.3/plugin-engines-dsh/guide.zh.md)、[AGENTS.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/AGENTS.md)。

---

## 1. 插件形态与清单

### 1.1 双半结构

一个第三方插件包最多承担两种角色，`package.json` 的 `dsh` 键同时描述它们：

| 字段                         | 归属             | 作用                                                                                              |
| ---------------------------- | ---------------- | ------------------------------------------------------------------------------------------------- |
| `dsh.bundle.patch`           | 组合包（bundle） | 一个 patch 文件路径，或有序路径列表，相对包根；launcher 按顺序把它们作为同一个层应用              |
| `dsh.bundle.platforms`       | 组合包           | 允许的 Node Host 平台名列表；省略＝全平台                                                         |
| `dsh.bundle.listedByDefault` | 组合包           | 是否在 GUI 列表默认展示；省略＝true                                                               |
| `dsh.client.platform`        | 客户端半         | 平台标识；Web 消费方选 `web`                                                                      |
| `dsh.client.inject`          | 客户端半         | **仅信息性**的包名依赖边（preflight 展示、HMR 差分）；不排序 Cordis 激活，只约束 factory 到达顺序 |
| `dsh.client.immediately`     | 客户端半         | 第一阶段预取标记；省略＝进入共享 application 批次                                                 |
| `dsh.client.external`        | 客户端半         | 基线之外的精确模块表请求；省略＝只要基线                                                          |

【官方要求】字段语义以上表为准。来源：[packages/util/package-manifest/src/types.ts](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/util/package-manifest/src/types.ts)、[packages/client/AGENTS.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/AGENTS.md)（"dsh.client manifest semantics"）。

【官方要求】`dsh.client` 声明必须伴随 `exports["./client"]`；扫描时缺失会抛错。`exports["./client"]` 允许字符串形式，或带字符串 `default` 的一层条件对象。来源：[packages/client/modules/src/index.ts](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/modules/src/index.ts)（`clientExportOf`，`src/index.ts:204`），本机证据：`~/.dsh/profiles/node_modules/@deepseek-ai/dsh-client-modules@0.2.2-rc.1/lib/index.js`（`exports["./client"] must be a string or an object with a string default`）。

【官方要求】`files` 必须覆盖每一个相对运行时导入与产出的资源，"已发布载荷是封闭的"，仓库内用 publint 校验精确发布视图。来源：[packages/client/AGENTS.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/AGENTS.md)（"Dependency declaration" 第 7 条）。

【官方要求】Node 版本下限：DSH 要求 Node.js 24.9 或更高。来源：[docs/upgrade-guide/v0.2.1-rc.2/node-24/guide.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/upgrade-guide/v0.2.1-rc.2/node-24/guide.zh.md)；本机 `@deepseek-ai/dsh@0.2.2-rc.1` 的 `engines.node` 为 `>=24.9.0`（`~/.dsh/profiles/node_modules/@deepseek-ai/dsh@0.2.2-rc.1/package.json`）。

【本仓库】`package.json` 已具备双半声明：`dsh.bundle.patch: "./cordis.patch.yml"`、`dsh.client: { platform: "web", immediately: true, inject: [] }`、`exports` 含 `.`/`./client`/`./cordis.patch.yml`/`./package.json`、`files: ["lib","skills","cordis.patch.yml"]`、`engines: { node: ">=24.15.0", dsh: ">=0.2.0-rc.2" }`。来源：`package.json`。

【本仓库】与官方清单的三处偏差：

1. `immediately: true`——官方只允许"第一阶段预取的基础设施行"使用它（`packages/client/AGENTS.md`，new-plugin checklist 第 3 条）。本包是业务面板，应该省略该字段，进入 application 批次。
2. `dsh.client.inject: []`——信息性边为空。它不影响正确性（激活顺序由 Cordis service 决定），但插件管理页与 HMR 差分拿不到包依赖信息。
3. 宿主入口 `export default plugin`（`src/host/index.ts` 末尾），而官方教程与测试规范都以具名 `apply`/`inject` 为准；`default` 能工作是因为 Loader 的 `unwrapExports` 会解包（见 1.3）。来源：`src/host/index.ts`、`docs/testing.md`。

### 1.2 `cordis.patch.yml` 的角色

【官方要求】`cordis.patch.yml` 是"一个附带配置层的 npm 包"的层内容；它不是 profile，也不是运行时注入。patch 是 patch 条目数组，插件行按**包名**（而不是相对源码路径）引用，这样 Node 的模块解析才能找到已安装代码。层顺序：各组合包 patch（按 `dsh.profile.bundles` 顺序）→ profile 自己的 patch → home 级 patch → 每个 `--patch` overlay；后应用的层按行胜出，且 patch **替换目标行的整个 `config` 值，不做深合并**。来源：[docs/user/develop/basic/publish.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.zh.md)。

【官方要求】空文件或只含注释的 patch 会让启动失败；要禁用该层请写 `[]`。patch 指定的条目不存在时只向 stderr 报警告。来源：[packages/boot/app-boot/README.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/boot/app-boot/README.zh.md)（profile 一节第 65 行附近）。

【默认行为】`dsh plugin --profile <name> add <pkg>` 把包追加进 profile 的 `dsh.profile.bundles`；`remove` 同时移除依赖与对应层。没有 `dsh.bundle` 的包仍可安装，但只作为普通依赖，`dsh plugin` 报警告且不激活任何层。来源：[docs/user/develop/basic/publish.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.zh.md)。

【本仓库】`cordis.patch.yml` 只有一条 `insert`，行 `id` 与 `name` 都是包名，`config: {}`；注释说明安装/卸载时由 `dsh plugin` 自动装配/移除。这与官方语义一致：该文件是"包贡献的层"，不是 profile。来源：`cordis.patch.yml`。

### 1.3 宿主入口如何被加载

【官方要求】宿主行 `name: '<package>'` 由 Cordis Loader 解析为包模块；Loader 的 `unwrapExports` 规则是：先取 `exports.default ?? exports`，若结果无 `__esModule` 就原样返回，否则再取 `default ?? exports`。因此具名导出与 `default` 导出都能挂载，但**文档化的形态是具名 `name`/`inject`/`apply`**。来源：`~/.dsh/profiles/node_modules/@deepseek-ai/cordis-plugin-loader@1.1.0/lib/index.js`（`unwrapExports`，第 812–817 行）、[docs/user/develop/basic/index.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/index.zh.md)。

【官方要求】插件可以是函数（导出 `apply`）、对象（`{ name, inject, apply }`）或 `Service` 子类；只有对象/类形态要求 `apply` 方法。来源：[docs/cordis-tutorial/02-lifecycle-and-effects.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cordis-tutorial/02-lifecycle-and-effects.zh.md)。

### 1.4 客户端入口如何被加载

【官方要求】宿主半（`ctx.clientModules`）只扫描**当前激活的 Loader entry**：每个声明了 `dsh.client` 的包变成一条 `WebBootEntry`，其 bundle 路径由 `exports["./client"]` 解析，"最近归属的 package manifest 提供浏览器模块 id"。图以 `window.__DSH_BOOT__` 注入页面，浏览器在 parser 预加载脚本执行前安装 `window.__ModuleLoader__` facade。来源：[docs/subsystems/client-modules.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/client-modules.zh.md)。

【默认行为】`/plugins/??<pkg-a>/client.js,<pkg-b>/client.js&rev=<rev>` 提供 combo 脚本；单资源请求用同一形式（HMR 路径）；`/plugins/<pkg>/assets/<path>` 提供包资源；脚本首次 `GET` 时只拼接一次，并以 `sourceMappingURL` 结尾；未知/被修改的资源列表、缺 revision 返回 404，方法不支持返回 405。来源：[docs/subsystems/client-modules.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/client-modules.zh.md)。

【本仓库】`scripts/build.ts` 自己拼出与官方 preset 等价的 `__ModuleLoader__.load` 外壳；`id` 是硬编码常量 `PLUGIN_ID`，与 `package.json.name`、`src/client/index.tsx` 的 `PLUGIN_NAME` 是三处独立字面量。这构成重命名时的静默失配风险：客户端注册 id 与包名不一致时，图里那条 row 永远不会物化。来源：`scripts/build.ts`、`src/client/index.tsx`。

---

## 2. 宿主插件

### 2.1 形态与依赖

【官方要求】`inject` 列出的服务未就绪时插件保持 PENDING；服务在运行期消失时插件会被卸载，恢复后重新加载。加载顺序由服务依赖决定，不由 YAML 行顺序决定。来源：[docs/cordis-tutorial/03-services.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cordis-tutorial/03-services.zh.md)。

【官方要求】`inject` 是硬依赖。若能力缺失时插件仍可运行，就**不要** inject，改用 `ctx.get(name)` 在使用处探测；`ctx.get(name, strict = true)` 只返回提供方 fiber 当前处于活动状态的实现，未提供时返回 `undefined`。来源：[docs/cordis-tutorial/03-services.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cordis-tutorial/03-services.zh.md)、[docs/cordis-api/context.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cordis-api/context.zh.md)（`ctx.get`）。

【官方要求】`ctx.inject(deps, callback)` 是 `ctx.plugin({ inject, apply: callback })` 的简写：需要的服务就绪时运行 callback，任一服务变化时卸载并重跑。它适合"面板先挂、能力后到"的分段注册。来源：`~/.dsh/profiles/node_modules/@deepseek-ai/cordis@4.1.0/lib/types/registry.d.ts`（`inject(deps, callback)` 的 JSDoc）。

### 2.2 清理：`ctx.effect`

【官方要求】通过 Cordis API 建立的注册本身就是 effect（`ctx.on`、`ctx.plugin`、各注册表返回的 disposer 都会自动撤销）；只有 Cordis 不管理的资源（定时器、连接、watcher）才需要 `ctx.effect(fn)` 并返回 disposer。disposer 按注册逆序启动，但多个**异步** disposer 会并发运行；需要顺序时把它们放进同一个 disposer 里依次 await。多份注册要原子回滚时，effect 可以返回 generator，逐个 yield disposer。来源：[docs/cordis-tutorial/02-lifecycle-and-effects.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cordis-tutorial/02-lifecycle-and-effects.zh.md)、`~/.dsh/profiles/node_modules/@deepseek-ai/cordis@4.1.0/lib/types/fiber.d.ts`（`effect(execute, label?) → Disposable<Promise<void>>`，label 用于诊断树）。

【官方要求】每个注册都应有对应 disposer；teardown 有顺序要求时把相关工作放进同一个 effect。来源：[docs/cordis-primer.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cordis-primer.zh.md)（"实践规则"）。

### 2.3 日志

【官方要求】用 `ctx.logger(name)` 取得具名 logger；`LoggerType` 只有 `error`/`warn`/`info`/`debug` 四档，参数按 printf 占位符格式化（`%s`、`%d`、`%o` 等）。来源：`~/.dsh/profiles/node_modules/@deepseek-ai/cordis@4.1.0/lib/types/logger.d.ts`、`vendor/cordis` 同源实现 [vendor/cordis/src/logger.ts](https://github.com/deepseek-ai/deepseek-harness/blob/master/vendor/cordis/src/logger.ts)。

【本仓库】宿主半正确使用 `ctx.logger(PLUGIN_NAME)` 并以 `logger.warn`/`logger.error` 报告降级；**客户端半**却用 `console.warn`（`src/client/index.tsx`）。客户端插件同样拿得到 `ctx.logger`（官方 `dsh-client-hmr` 的浏览器半就用 `ctx.logger.error/warn`，见 `~/.dsh/profiles/node_modules/@deepseek-ai/dsh-client-hmr@0.2.2-rc.1/lib/client.js`）。

### 2.4 失败与降级

【官方要求】`apply` 抛错 → fiber FAILED。启动器 `installFailLoud` 会为未处理 rejection/异常写带标签诊断，并在固定超时后退出；"启用但失败的插件会产生带标签的警告"，而 required entry 失败会拆卸整个应用并非零退出。来源：[packages/boot/app-boot/README.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/boot/app-boot/README.zh.md)（`installFailLoud` 段）。

【官方要求】配置错误要"响亮"：用 Schemastery 在加载时校验并填默认值，不要导出普通对象当 `Config`；凡是不同部署可能取不同值的参数都应是配置字段，而不是硬编码常量。来源：[docs/user/develop/basic/config.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/config.zh.md)。

【本仓库】`src/host/index.ts` 的写法与官方"可选依赖"建议一致：`inject: ['subprocess','timer']` 是硬依赖；`connection` 缺失时只 `logger.warn` 并跳过 RPC；`scope.get(...)` 逐个做存在性检查，`connection.fetch.register` 抛错时 `logger.error` 后 return，不把异常抛穿到 `apply`。来源：`src/host/index.ts`。

【本仓库】一个可改进点：`scope.effect(() => () => { void dispose() }, …)` 把异步 disposer 的失败吞掉了（`void`）。官方要求 effect 返回的异步 disposer 可被 await（`effect(execute: () => Effect)` 返回 `AsyncDisposable<Promise<void>>`），建议返回 `() => dispose()` 让 Cordis 等待并暴露失败。来源：`src/host/index.ts`、`~/.dsh/profiles/node_modules/@deepseek-ai/cordis@4.1.0/lib/types/fiber.d.ts`。

---

## 3. 客户端插件

### 3.1 ModuleLoader 外壳

【官方要求】官方共享 preset 产出的浏览器 bundle 具有固定外壳，三个片段缺一不可：

```js
// banner
window.__ModuleLoader__.load({
  id: '<package>',
  factory: (require) => {
    // intro
    var module = { exports: {} }
    var exports = module.exports
    // footer
    return module.exports
  },
})
```

来源：[packages/client/tsdown.client.ts](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/tsdown.client.ts)（`banner`/`intro`/`footer`）。

【默认行为】官方 bundle 的 `exports` 上还有 `Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" })`。这是**打包器 CJS interop 的产物**（rolldown 对 ESM 源的 CJS 输出），不是 DSH 要求的握手：本机 `@deepseek-ai/dsh-client-modules@0.2.2-rc.1`/`dsh-client-hmr@0.2.2-rc.1` 的 `lib/client.js` 第 6 行都有它，但 0.2.2-rc.1 的宿主代码里没有任何 `Symbol.toStringTag` 读取点；Loader 真正依赖的是 `default`/`__esModule`（见 1.3）。来源：`~/.dsh/profiles/node_modules/@deepseek-ai/dsh-client-hmr@0.2.2-rc.1/lib/client.js`、`~/.dsh/profiles/node_modules/@deepseek-ai/cordis-plugin-loader@1.1.0/lib/index.js`。

【推断】因此 `Symbol.toStringTag = 'Module'` 应"照官方产物带上以保持一致"，但**不要**把语义押在它上面；`scripts/build.ts` 里"宿主据此把它当成 ES 模块命名空间对待"的注释与 0.2.2-rc.1 的实际读取点不符。

【官方要求】CJS 外壳意味着：`require` 是同步的，解析顺序是"平台 seed 表 → 已物化记录 → 图 row → 已注册 factory"，全部落空即抛错；factory 形式的 CJS 无法提供部分导出，所以 require 环会直接抛错。来源：`~/.dsh/profiles/node_modules/@deepseek-ai/dsh-client-modules@0.2.2-rc.1/lib/client.js`（`makeRequire`、`materialize`）。

### 3.2 具名 `inject` / `apply`

【官方要求】客户端插件就是普通 Cordis 插件：模块导出 `name`、`inject`、`apply`。HMR 自己也是这么写的（`exports.name/inject/apply`，`inject = ["modules"]`）。来源：`~/.dsh/profiles/node_modules/@deepseek-ai/dsh-client-hmr@0.2.2-rc.1/lib/client.js`、[packages/client/AGENTS.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/AGENTS.md)（"Export discipline"）。

【官方要求】UI 插件包 `/client` 入口是公共浏览器 API，不是便利 barrel：除 Cordis 加载所需的 `apply`/`inject`（以及存在时的 `Config`）与类型外，不应导出实现组件、纯 helper、常量或 store 句柄。来源：[packages/client/AGENTS.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/AGENTS.md)（"Export discipline" 第 1 条）。

### 3.3 externals 与模块图

【官方要求】基线（`PLATFORM_MODULES`）对每个动态 bundle 隐式生效，不要在 `dsh.client.external` 里重复；`external` 只允许"基础设施、传输或生成装配"声明包专属的非基线请求；第三方实现库若不在基线内，默认被打进 bundle（"沉默即私有副本"）；`import type` 会被擦除，不产生请求；一个请求只有两个提供方——该包的动态 row，或 `PLATFORM_MODULES` 的精确静态键。来源：[packages/client/AGENTS.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/AGENTS.md)（"Shared modules and the module graph" 1–4 条）。

【官方要求】React 必须在基线里、bundle 必须外部化它，原因不是体积而是**身份**：`PLATFORM_MODULES` 被"播种、打包外部化、Vite 别名"三处共用，"使它们的模块身份不会漂移"；shell 的 slots/renderer 用这份 React 渲染整棵树。若 bundle 内联自己的 React，hooks/context 会分属两个 React 实例。来源：[packages/client/web/src/platform.ts](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/web/src/platform.ts)、[packages/client/tsdown.client.ts](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/tsdown.client.ts)（`INLINE_SAFE` 注释："no Symbol/instanceof/singleton state"）。后半句为【推断】。

【官方要求】组合阶段会拒绝畸形请求、缺失提供方、自请求与同步请求环；`verify-client-packages` 同样校验冗余/缺失请求。来源：[packages/client/modules/README.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/modules/README.zh.md)、[packages/client/AGENTS.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/AGENTS.md)。

【本仓库】`scripts/build.ts` 的客户端构建 `external: ['react']`，与基线一致；没有 `dsh.client.external`，因为运行期只需要 React 与宿主注入的服务。`src/client/index.tsx` 对 DSH 只做类型级/结构化接口（自己声明 `SlotsLike` 等），不 import 任何官方客户端运行时值——这是最保守、也最不依赖私有路径的姿态。

### 3.4 Slots 扩展点

【官方要求】扩展他人 UI 的两种声明形式：父级拥有的位置用 `ctx.slots.register({ name, children?, store?, inject? }, Component)`；可复用组件/装配用 `ctx.slots.registerFactory()`。`children` 同时是声明与授权：渲染未声明的 slot，或声明他人已拥有的 child，都会在插件激活时失败。来源：[packages/client/AGENTS.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/AGENTS.md)（Slot and props discipline 1–2 条）、[docs/subsystems/slots.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/slots.zh.md)。

【官方要求】向其他包的 slot 贡献内容必须用 `ctx.slots.inject(key, callback)`：callback 在每段声明生命周期内运行，owner 折叠时其 effect 移除，owner 重新挂载时重跑；裸 `slots.register` 到未声明 slot 是错误。来源：[docs/subsystems/slots.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/slots.zh.md)（"声明与生命周期"）、[packages/client/AGENTS.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/AGENTS.md)（checklist 第 4 条）。

【官方要求】组件 props 是五份派生 share：`PropsRuntime`、`PropsRenderSlots`、`PropsRenderFactories`、`PropsStore` 与 inject face；hook 只能由框架生成；inject 返回纯数据与回调，裸 observable 只能放保留的 `hooks` 隔间；组件**绝不**接收 Cordis `ctx`。来源：[packages/client/AGENTS.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/AGENTS.md)、[docs/defensive-patterns/client-components.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/defensive-patterns/client-components.zh.md)。

【官方要求】注册进 slot 的值必须是模块作用域的稳定 function component；在渲染期创建组件函数会让 React 视为新类型并重挂载子树（展开态、焦点、滚动位置丢失）。来源：[docs/defensive-patterns/client-components.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/defensive-patterns/client-components.zh.md)。

【官方要求】跨包只能 `import type` 声明；运行时行为走注入的 Cordis service，UI 组合走 slots；功能插件不得运行时导入/转发另一个功能插件的值，也不得为此声明 `dsh.client.external`。来源：[docs/subsystems/web-client.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/web-client.zh.md)（"包边界"）、[docs/subsystems/slots.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/slots.zh.md)（"扩展规则"）。

【默认行为】本仓库所用两个扩展点在 0.2.2-rc.1 中都存在：`ctx.sidebarRightTabs.register(definition)` 与 `sidebar.right.pane.tab` keyed slot；官方文档给出的写法正是 `inject = ['sidebarRightTabs','slots']` + `ctx.effect(...)` 包裹注册。来源：[docs/subsystems/sidebar-right.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/sidebar-right.zh.md)（"Tab 类型注册"示例）、本机 `~/.dsh/profiles/node_modules/@deepseek-ai/dsh-client-ui-sidebar@0.2.2-rc.1/` 等包内 `sidebar.right.pane.tab` 字符串。

【本仓库】`src/client/index.tsx` 用 `export const inject = []` + `ctx.inject(['slots','sidebarRightTabs'], …)` + `scope.get` 探测 + `slots.inject(...)` 注册两个 keyed slot，生命周期整体挂在 `scope.effect` 下。与官方示例的差异是"把硬依赖降级为晚绑定"，换来面板在服务缺失时仍可加载；`createTaskTab` 在 `apply` 期创建组件闭包，对同一 plugin 生命周期是稳定身份，不构成渲染期重建。

### 3.5 CSS 与资源

【官方要求】官方 preset 把样式编译进 factory 闭包：物化时创建 `<style data-plugin="<pkg>" data-plugin-css="<pkg>/<file>">` 并插入 `head`；模块系统在物化前后做样式归属记账（`claimStyles`），条目清理时按 `data-plugin` 回收。来源：[packages/client/tsdown.client.ts](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/tsdown.client.ts)（`styleInjectionModule`）、`~/.dsh/profiles/node_modules/@deepseek-ai/dsh-client-modules@0.2.2-rc.1/lib/client.js`（`claimStyles`/`removeOwnedStyles`）。

【官方要求】图片资源放在 `src/client/assets/`，包在 `exports` 声明 `"./assets/*": "./lib/assets/*"`、在 `files` 含 `lib/assets`；构建会把内容 revision（SHA-1 前 12 位）插到扩展名前，并把 import / CSS `url()` 编译成 `require.asset("plugins/<pkg>/assets/<path>")`；支持 `.svg/.png/.webp/.jpg/.jpeg`，其他扩展名走资源路由会 404。来源：[packages/client/AGENTS.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/AGENTS.md)（第 9 条）、[packages/client/modules/README.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/modules/README.zh.md)（"包资源"）。

【本仓库】没有 `.css`/图片产物：样式是 `CSSProperties` 常量并引用 `--dsw-*` 主题变量（`src/client/task-panel-styles.ts`）。这条路径绕开了"样式注入 + 归属回收"，但也就放弃了 CSS Modules 的类名哈希与 `url()` 资源重写；对只用一个面板的插件是可接受的取舍。若将来引入 `.css`，必须自己实现 data-plugin 标记，否则清理归属会落到来物化的那个插件头上。

---

## 4. 构建与开发循环

### 4.1 官方 `dev:web`

【官方要求】`dev:web` 的职责被限定为"构建一次、起三个 watcher、再起 `dsh web`"：`pnpm run build:artifacts`（`--skip-build` 跳过）→ `tsc -b tsconfig.client.json --watch`（产出 `lib/types`，也是 tsdown 的入口来源）→ tsdown workspace watch（打包 `lib/index.js` 与 `lib/client.js`）→ `vite build --watch`（重写 `apps/web/dist`）→ `dsh web`（`--no-serve` 跳过）。脚本头注释明确："Reload signaling is not this script's business — the host webserver stat-polls the bundles it serves and broadcasts `rebuilt` frames itself, so any process that rewrites `lib/client.js` files triggers reloads." 来源：[scripts/dev-web.ts](https://github.com/deepseek-ai/deepseek-harness/blob/master/scripts/dev-web.ts)。

【官方要求】`dev:web` 与 `build`/`build:artifacts` **不得并行**（写同一批 `lib/` 与 `apps/web/dist/`）；任一 stage 自行退出即停掉整条循环并以 1 退出；`--poll[=ms]` 同时打开 tsc 的 fixed polling 与 tsdown 的 `usePolling`（默认 500ms）。来源：[scripts/dev-web.ts](https://github.com/deepseek-ai/deepseek-harness/blob/master/scripts/dev-web.ts)。

【默认行为】watch 集合按声明发现：`packages/*/*` 中 `dsh.client.platform === 'web'` 的包 + 所有 `tsdown.config.ts` 引用 `tsdown.client.ts` 且未声明 `dsh.client` 的"静态链接库"；启动时扫一次，watch 期间新增包需重启脚本。来源：[scripts/dev-web.ts](https://github.com/deepseek-ai/deepseek-harness/blob/master/scripts/dev-web.ts)（`discoverPluginDirs`/`discoverLibraryDirs`）。

【官方要求】`dev:web` 的 tsdown watch 会等每个包首轮构建完成后再起 Vite，避免读到上一轮 `lib` 产物。来源：[scripts/dev-web.ts](https://github.com/deepseek-ai/deepseek-harness/blob/master/scripts/dev-web.ts)（`watchClientPlugins`）。

【默认行为】Web 的 Host 从源码跑，但浏览器加载的是构建产物；`start:web` 只服务上一次构建产物。来源：[docs/development.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/development.zh.md)（"应用命令"）。

### 4.2 共享 tsdown preset

【官方要求】每个 UI 插件包的 `tsdown.config.ts` 长这样：

```ts
import { clientBundle } from '../tsdown.client.ts'
export default clientBundle(import.meta.dirname, ['lib/types/index.js'])
```

`clientBundle` 按 `DSH_BUILD_FACE` 选面：host 面只产 Node 半（`lib/types` → `lib/index.js`），client 面产 Node 半 + 浏览器半（入口 `lib/types/client/index.js` → `lib/client.js`）。tsdown 只消费前置 `tsc` 发射到 `lib/types` 的 JavaScript——"lib entries are that emit, not src"。来源：[packages/client/modules/tsdown.config.ts](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/modules/tsdown.config.ts)、[packages/client/tsdown.client.ts](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/tsdown.client.ts)、[docs/development.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/development.zh.md)。

【官方要求】preset 的浏览器产物契约：CJS 格式（`window.__ModuleLoader__` 外壳）、`sourcemap: true` 且 `sourcemapExcludeSources: false`、`sourcemapPathTransform` 把源码映射成镜像仓库目录的浏览器 URL、package-local `import()` 编译成 `require.async("./client.<name>.js")`、写完所有 chunk 后把入口 `lib/client.js` 的 mtime 抬到 `max(now, mtime+1)`（`writeBundle`）——这样"仅 chunk 重建也会推进包 revision"。来源：[packages/client/tsdown.client.ts](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/tsdown.client.ts)（`clientConfig` 的 `outputOptions`、`asyncChunkRequirePlugin`、`writeBundle`）。

【官方要求】**该 preset 不是发布物。** 根包 `@deepseek-ai/dsh-root` 是 `private: true` 且没有 `exports`；`tsdown.client.ts` 只是仓库里的一个 `.ts` 文件，没有对应 npm 包。第三方无法 `import` 它，必须自建等价外壳。来源：[package.json](https://github.com/deepseek-ai/deepseek-harness/blob/master/package.json)、[packages/client/tsdown.client.ts](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/tsdown.client.ts) 所在路径。

【本仓库】`scripts/build.ts` 用 esbuild 复刻外壳与外部化：宿主 `platform: node / format: esm / packages: 'external'`；客户端 `format: cjs / platform: browser / external: ['react']`，产物用模板字符串包进 `__ModuleLoader__.load`，最后 `writeFile('lib/client.js')`。它没有实现：source map、chunk 拆分（`require.async`）、CSS 注入、asset 路由重写、写后 mtime 抬升。对单文件面板而言前两项缺失只影响调试体验，后两项与当前"无 CSS/无资源"的实现一致。

### 4.3 watch 重建、原地写入与 `change` 事件

【官方要求】客户端图的重建语义由 `ctx.clientModules` 定义：`rebuilt(id)` 从**文件系统元数据**（mtime/ctime/size）派生 revision，只有 revision 变化才读新字节、重组合图并发通知；`artifactBaseline(id)` 在条目启动时快照 bundle stat，供 HMR 安装 watch 时比较，"使启动组合与 watch 安装之间的写入不会消失"。来源：[docs/subsystems/client-modules.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/client-modules.zh.md)（`ctx.clientModules` API 段）、`~/.dsh/profiles/node_modules/@deepseek-ai/dsh-client-modules@0.2.2-rc.1/lib/index.js`。

【官方要求】HMR 的 Node 半就是按这个契约做：解析 `client-hmr` 的 `Config`（`pollIntervalMs`，整数、最小 1、默认 **500**），对每条图 row 的 `artifactBaseline` 建 watch，`setInterval(pollWatches, pollIntervalMs)` 且 `timer.unref()`；stat 变化时调用 `ctx.clientModules.rebuilt(id)`，ENOENT 时标 dirty 等下轮重试，其他异常只 `logger.warn`。来源：`~/.dsh/profiles/node_modules/@deepseek-ai/dsh-client-hmr@0.2.2-rc.1/lib/index.js`、[docs/config-catalog.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/config-catalog.zh.md#deepseek-aidsh-client-hmr)。

【默认行为】传输是 `/plugins/events` SSE，帧只有两种：`{ type:'graph', graph }` 与 `{ type:'rebuilt', id, rev }`；每个新连接先收到**当前完整图**，之后图变化广播 `graph`，单包重建广播 `rebuilt`。来源：`~/.dsh/profiles/node_modules/@deepseek-ai/dsh-client-hmr@0.2.2-rc.1/lib/types/events.d.ts`、同包 `lib/index.js`（`connect`/`publishGraph`/`onRebuilt`）。

【0.2.2-rc.1 证据：宿主侧只认 `change`】宿主 `dsh-hmr` 的模块 watcher 以 `watch(root, { ...this.config, cwd, ignored, ignoreInitial: true })` 创建，随后**只**订阅一个事件：

```ts
this.watcher.on('change', (path) => {
  changed.add(path)
  dispatch()
})
```

源码见 tag `dsh-v0.2.2-rc.1` 的 [packages/boot/hmr/src/index.ts:482](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.1/packages/boot/hmr/src/index.ts#L482)（[watcher 创建在同一文件 429–434 行](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.1/packages/boot/hmr/src/index.ts#L429-L434)），没有 `add`/`unlink` 订阅。`change` 只在"同一路径内容被重写"时产生；`unlink`+`add` 是另外的事件。因此**"删掉 `lib/` 再重建"的构建方式不会让宿主 HMR 看到任何变化**——dev 必须原地覆写 `lib/index.js`。这是 0.2.2-rc.1 的实现事实，不是文档承诺；引用时不要用 master 链接替代。

补充一个边界：chokidar 默认 `atomic: true`，会把同一路径 100ms 内的 unlink+add 合并成 `change`（`~/.dsh/profiles/node_modules/chokidar/index.js`，5.0.0，`_emit` 的 `opts.atomic` 分支）。这条合并属于依赖库行为、受平台与时序影响，**不是 DSH 契约**；跨目录、跨时长的"先删后建"不能指望它。

【默认行为】浏览器半按 release 门控：只有当前 Host 的 release 等于页面启动时的 release，才应用 `graph` 与 `rebuilt`；否则 `reload()` 直接 resolve 空操作，页面只提示、不更新。`graph` 走 `entries.sync`，`rebuilt` 走 `entries.reload(id, rev)`（同一串行队列）。来源：`~/.dsh/profiles/node_modules/@deepseek-ai/dsh-client-modules@0.2.2-rc.1/lib/client.js`（`reload`/`sync` 的 `this.release.matches` 判断）、[packages/client/modules/README.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/modules/README.zh.md)（"Host release 变化"）。

【官方要求】一次重载的动作序列：使旧模块失效 → 在旧 fiber 仍服务时预取单资源脚本 → 删除注册表 runtime → 等旧 fiber 清理 → 清除 fiber 引用并移除自身样式 → 物化新导出 → `entry.refresh()` 重新挂载。依赖被重载插件的插件通过 Cordis 的 activation epoch 级联重载，HMR 侧不维护簿记。来源：[packages/client/hmr/README.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/hmr/README.zh.md)（"浏览器侧替换"）。

### 4.4 整块重载语义与失败策略

【官方要求】重载是粗粒度的：全新 fiber + 全新组件，"被重载插件内的 React 状态会丢失，而数据层（连接 fiber、运行时 fiber、Session 对象）不受影响"；react-refresh 级状态保留与"重新执行 bundle"冲突，因此**有意排除**。来源：[packages/client/hmr/README.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/hmr/README.zh.md)（"已知限制与延期工作"）。

【官方要求】失败策略分两段：下载失败时正在运行的插件保持活动；旧 fiber 卸载后，导入或激活失败**不会**恢复先前 bundle，失败显示为当前页面的同步错误，"设置 → 插件 → 插件列表"可对最新图重试（即使 revision 未变），后续重建也会重试受影响插件；无关且已成功运行的插件保持活动。来源：[packages/client/hmr/README.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/hmr/README.zh.md)（"失败策略"）。

【默认行为】客户端模块系统对未变化 bundle 保留已加载插件与 revision；manifest 只在包的 Loader entry 启动/重启时读取，"仅编辑 `package.json` 要到下一次条目重启或 Host 重启时才生效"；包资源路由每次都读盘，但因 Node 的包配置缓存，"原地修改 `./assets/*` 导出要等 boot HMR 让该包缓存失效或 Host 重启"。来源：[packages/client/modules/README.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/modules/README.zh.md)（"已知限制"）。

【官方要求】宿主侧是另一套策略：`dsh-hmr` 在模块替换失败时"清理已部分激活的替换实例，并恢复原来的模块和插件实现"——与客户端 HMR 的"不回滚"相反。来源：[packages/boot/hmr/README.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/boot/hmr/README.zh.md)（实现细节）。

### 4.5 source map 的一手事实

| 问题                           | 一手答案                                                                                                                                                                            | 来源                                                                                                                                                                   |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 官方是否生成客户端 map？       | 是。preset `sourcemap: true`，`sourcemapExcludeSources: false`，并把源码路径改写成浏览器 URL                                                                                        | [packages/client/tsdown.client.ts](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/tsdown.client.ts)                                       |
| ModuleLoader 是否读 map？      | 否。启动、index 渲染、脚本 `GET`/`HEAD` 都不读 map                                                                                                                                  | [docs/subsystems/client-modules.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/client-modules.zh.md)                               |
| 谁读？何时？                   | 宿主在**首次** combo-map `GET` 时读 `<clientPath>.map`、校验 Source Map v3、组合 Indexed Source Map v3 并缓存 body                                                                  | 同上；`~/.dsh/profiles/node_modules/@deepseek-ai/dsh-client-modules@0.2.2-rc.1/lib/index.js`（`readSourceMap`、`buildComboScript`）                                    |
| 没有 map 会怎样？              | 该 section 合成 identity map，`sourcesContent` 是捕获的 bundle 文本，source 名取打包后的 `sourceURL` 或插件路由                                                                     | 同上（`identitySectionMap`）；[docs/subsystems/client-modules.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/client-modules.zh.md) |
| 约定是什么？                   | map 必须是 bundle 的 sibling（`<clientPath>.map`）；畸形 map 会让该端点抛错（`is not a regular Source Map v3 object`）                                                              | `~/.dsh/profiles/node_modules/@deepseek-ai/dsh-client-modules@0.2.2-rc.1/lib/index.js`                                                                                 |
| 改 map 会触发重载吗？          | 不会。仅 source map 变化不触发重载；新 combo-map URL 只在 bundle revision 变化后出现，且每份 map body 由其首次 `GET` 固定                                                           | [docs/subsystems/client-modules.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/client-modules.zh.md)                               |
| 0.2.2-rc.1 的发布包带 map 吗？ | 不带：`dsh-client-hmr@0.2.2-rc.1` 的 `files` 无 `*.js.map`，`lib/` 里也没有 map；但 `lib/client.js` 末尾仍写 `//# sourceMappingURL=client.js.map`，所以线上走的是 identity 合成路径 | `~/.dsh/profiles/node_modules/@deepseek-ai/dsh-client-hmr@0.2.2-rc.1/package.json`、同包 `lib/client.js`                                                               |
| 上游 master 呢？               | `0.2.2-rc.2` 的 `packages/client/hmr/package.json` 已把 `lib/**/*.js.map`、`lib/types/**/*.d.ts.map`、`src` 加进 `files`                                                            | [packages/client/hmr/package.json](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/hmr/package.json)                                       |

【推断】给第三方插件的结论：想让 DevTools 显示自己的源码，就产出一个合法的 sibling `lib/client.js.map`，并确保它和 bundle 一起发布（`files` 覆盖）；不要指望 ModuleLoader 或 HMR 帮你读它，也不要指望改 map 会刷新页面。

---

## 5. 测试与质量门禁

### 5.1 官方测试约定

【官方要求】`docs/testing.md` 的六条硬规则，与第三方插件直接相关的有四条：

1. **真实现优先于 mock**：只 mock 昂贵或非确定的边界（LLM、网络、时钟），下游保持真实现；手写替身只证明"桥在搬字节"，不证明"出货行为如断言"。来源：[docs/testing.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/testing.md)（"Prefer the real implementation over a mock"）。
2. **验证世界，不验证自述**：e2e 断言要外部重跑命令或重读文件；未被改动的文件必须字节一致。来源：同上（"Verify the world, not the self-report"）。
3. **测试真实入口路径**：产品可见插件需要一次非单元的真实组合测试——用 Loader + app/process 启动测试专用 `cordis.yml`，只 mock 外部服务；"A guard only guards if the regression fails it"，对无 `inject` 的插件还要断言 `expect('default' in mod).toBe(false)` 加 `unwrapExports` 往返。来源：同上（"Test the real entry path"）。这条恰好解释了本仓库 `export default plugin` 的风险：默认导出会被 `unwrapExports` 静默接受，普通 smoke 测不出来。
4. **测试解析只在源码面**：vitest 通过 `tsconfig.base.json` 的 `paths` 解析工作区 import 到 `src`，绝不走包 `exports` 到构建后的 `lib`（否则会加载第二份模块单例）；只有显式声明要测构建产物时才走 `lib`。来源：同上（"Test resolution: source plane only"）。

【官方要求】覆盖率门禁是 `packages/*/*/src` 的**逐文件 100%**；未覆盖的行往往是该死代码，"行覆盖是必要不充分"。来源：同上（"Tiers"）。

【官方要求】官方 development 文档把"跑通"定义为 `pnpm run typecheck` 成功；日常按改动面选最小检查集，钩子故意不跑测试/快照/构建。来源：[docs/development.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/development.zh.md)。

【官方要求】客户端包的测试规则：jsdom 用每文件首行 `// @vitest-environment jsdom` pragma（共享配置保持 node 环境）；组件测试喂真实 props 或受驱动的 fixture runtime，断言用户可见行为，不断言类名、hook 内部或渲染次数；数据层语义归 runtime/host 套件。来源：[packages/client/AGENTS.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/AGENTS.md)（"Testing and coverage"）。

### 5.2 本仓库做法与官方的一致性

| 本仓库做法                                                                              | 证据                                                                                                                                      | 与官方关系                                                                                                                                                   |
| --------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `core` 纯函数 + `adapters` 契约套件 + `host` 只组装；依赖方向由 dependency-cruiser 强制 | `.dependency-cruiser.json`、`src/adapters/contract.test-suite.ts`                                                                         | **一致**：官方也是"数据层语义归下层、UI 只做表现"的分层（`packages/client/AGENTS.md` 的 "Layering red lines"），且同样用机器门禁表达架构规则而不是写在文档里 |
| 只 mock 边界：`CommandRunner`、`WorkspaceFiles`、`FetchLike`、`SnapshotService`         | `src/host/backend-resolver.ts`（`files?` 注入）、`src/host/rpc-http.test.ts`（fake service）、`src/client/rpc.test.ts`（recording fetch） | **一致**：对应"只 mock 昂贵/非确定边界"                                                                                                                      |
| 纯函数测试（`core/remote`、`core/classify`、`core/markdown`）不碰 ctx、不碰 Node 内置   | `src/core/*.test.ts`、`.dependency-cruiser.json` 的 `core-is-pure`                                                                        | **一致**：对应"数据层可独立测试"                                                                                                                             |
| `vitest` 分 node/jsdom 两个 project，测试与源码同目录                                   | `vitest.config.ts`                                                                                                                        | **一致**：官方客户端包同样 jsdom pragma + 行为断言                                                                                                           |
| 覆盖率只对 `src/core/**` 设 80% 门槛                                                    | `vitest.config.ts`                                                                                                                        | **不一致**：官方是逐文件 100%；本条属于本仓库的阶段性取舍                                                                                                    |
| 没有 Loader 真实入口 smoke、没有构建产物 smoke                                          | 无对应测试文件                                                                                                                            | **不一致**：官方明确要求"产品可见插件需要非单元真实组合测试"与"测试真实入口路径"                                                                             |
| 宿主入口 `export default plugin`                                                        | `src/host/index.ts`                                                                                                                       | **不一致**：官方教程用具名导出，`docs/testing.md` 把"default 取代具名导出"列为需要专门断言防回归的故障类                                                     |

【推断】最值得补的两项：一条 `cordis.yml` + Loader 的宿主 smoke（证明 `inject`/`apply` 在真实加载路径上成立），以及一条构建产物 smoke（用 `node` 跑 `lib/index.js`，断言导出的形状与 `Symbol.toStringTag` 无关）。客户端半目前只测纯函数与 jsdom 组件，没有验证"外壳能被 `__ModuleLoader__` 接受"——这正是 HMR 整块重载最容易静默失败的环节。

---

## 6. 版本兼容与升级

### 6.1 `engines.dsh` 的现行规则

【官方要求】清单声明了 `engines.dsh` 时，**只由该范围决定**，忽略 `peerDependencies`；只有缺少 `engines.dsh` 时才逐个校验 `@deepseek-ai/dsh` 与 `@deepseek-ai/dsh-*` peer。`workspace:` 只在 peer 中有效，出现在 `engines.dsh` 中视为不兼容；空范围/非法范围视为不兼容；`engines` 不是对象或 `engines.dsh` 不是字符串时清单视为格式错误。来源：[docs/upgrade-guide/v0.2.1-alpha.3/plugin-engines-dsh/guide.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/upgrade-guide/v0.2.1-alpha.3/plugin-engines-dsh/guide.zh.md)、[packages/boot/app-boot/README.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/boot/app-boot/README.zh.md)（profile 一节）。

【默认行为】0.2.2-rc.1 的实现用 `semver.satisfies(runtimeVersion, range, { includePrerelease: true })`，运行时版本取自 **app-boot 包自己的 `package.json.version`**（与 CLI 发布版本同号）；peer 回退里 `workspace:^`/`workspace:~`/`workspace:*` 会被替换成运行时版本再比较。来源：`~/.dsh/profiles/node_modules/@deepseek-ai/dsh-app-boot@0.2.2-rc.1/lib/index.js`（`satisfies`/`unmetRequirements`/`getDshRuntimeVersion`）。

【文档与源码冲突】`@deepseek-ai/dsh-package-manifest` 的 README 在"已知限制"里写"当前安装器和加载器不强制检查 `dsh.manifestVersion` 或 `engines.dsh`"，但同一版本的 app-boot 在 profile 导入插件前就会比较并在不满足时拒绝、把行降级为 `disabled: true`。按"源码优先"原则，应以 app-boot 行为为准；manifest 包只提供类型。来源：[packages/util/package-manifest/README.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/util/package-manifest/README.zh.md)、`~/.dsh/profiles/node_modules/@deepseek-ai/dsh-app-boot@0.2.2-rc.1/lib/index.js`。

【本仓库】`engines.dsh: ">=0.2.0-rc.2"`，在 `includePrerelease: true` 下匹配本机 `0.2.2-rc.1`；`engines.node: ">=24.15.0"` 高于 DSH 自身的 `>=24.9.0`，不会挡安装。来源：`package.json`、`~/.dsh/profiles/node_modules/@deepseek-ai/dsh@0.2.2-rc.1/package.json`。

### 6.2 与第三方插件相关的迁移

| 版本           | 变更                                                                                                                                                                              | 对第三方作者的动作                                                                                                                                                                                                                                                                                                                                                       |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| v0.2.0-rc.2    | **子路径插件显示清单**：不再读导出的 `<子路径>/package.json`；标题/描述改由 `<子路径>/locale/*.json` 的 `meta.title`/`meta.description` 提供，图片改由导出的 `<子路径>/icon` 提供 | 若你的包导出多个子路径插件：迁移 locale meta 与 icon，删除 `./<sub>/package.json` 导出。来源：[guide.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/upgrade-guide/v0.2.0-rc.2/subpath-plugin-display-manifest/guide.zh.md)                                                                                                                      |
| v0.2.1-alpha.1 | **`dsh plugin` 选项位置**：只在被转发的 pnpm 参数之前读 `--profile`，并提供自己的 `--help`                                                                                        | 脚本里把 `--profile` 移到最前；`add <pkg> --profile x` 会失败。来源：[guide.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/upgrade-guide/v0.2.1-alpha.1/plugin-option-placement/guide.zh.md)                                                                                                                                                    |
| v0.2.1-alpha.2 | **安装已安装包**：HMR 启用时，spec 指向已安装包会在跑 pnpm 前以 `already-installed` 失败；更新需先 `removeBundle` 再 `installBundle`                                              | 你的升级/自更新流程要先移除；对 `ManagementError['code']` 的穷尽 switch 要加 `already-installed`。来源：[guide.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/upgrade-guide/v0.2.1-alpha.2/plugin-install-over-installed/guide.zh.md)                                                                                                           |
| v0.2.1-alpha.3 | **`engines.dsh` 优先**；拒绝记录 `peers` 改名 `requirements`                                                                                                                      | 让 `engines.dsh` 覆盖你支持的全部 DSH 版本；删掉 `workspace:`；改读 `requirements`。来源：[guide.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/upgrade-guide/v0.2.1-alpha.3/plugin-engines-dsh/guide.zh.md)                                                                                                                                    |
| v0.2.2-alpha.2 | **Loader 条目树**：`EntryTree.write()` 移除，改 `commit(change)`；`applyEntryPatches` 总是返回克隆；Include 用 journal 持久化运行时变更                                           | 只写 patch 的插件不受影响；自定义 `EntryTree`/patch 工具的作者要迁移。注意：patch 插入行的运行时修改写在父 patch 里，profile 根 Include 的父级是内存 Loader，因此"行自行释放写入 `disabled: true`"重启后不保留。来源：[guide.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/upgrade-guide/v0.2.2-alpha.2/cordis-loader-entry-trees/guide.zh.md) |
| v0.2.2-rc.1    | **包导出清理**：`file-reference-local`、`llm-pi-ai`、`lsp-stdio` 的根入口移除内部辅助值导出                                                                                       | 不要从插件根入口 import 实现类/协议 helper；改用注入的服务。来源：[guide.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/upgrade-guide/v0.2.2-rc.1/package-export-cleanup/guide.zh.md)                                                                                                                                                           |
| v0.2.2-rc.1    | **`BundleInfo.updatable` → `BundleInfo.update`**；新增 `unexpected-package` 错误码                                                                                                | 插件管理相关代码改读 `update`；穷尽 switch 补错误码。来源：[guide.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/upgrade-guide/v0.2.2-rc.1/plugin-update-method/guide.zh.md)                                                                                                                                                                    |

### 6.3 不要依赖私有路径与内部 API

【官方要求】DSH 公共 API 明确是 **pre-stable**："Public APIs are pre-stable; update every consumer."；外部可感知的破坏性变更必须立刻记录进 upgrade guide。来源：[AGENTS.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/AGENTS.md)。

【官方要求】跨包只允许 `import type`；功能插件不得运行时导入/转发另一个功能插件的值，也不得添加 `dsh.client.external` 来绕过；共享运行时值只能来自职责收窄、无功能生命周期的静态 owner（`client/store`、`ui-primitives`、browser-safe util 包）。来源：[docs/subsystems/web-client.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/web-client.zh.md)（"包边界"）。

【官方要求】同一包内的测试可以直接相对导入内部模块；不得为了测试通过而扩大公共 API。来源：[packages/client/AGENTS.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/AGENTS.md)（"Export discipline" 第 2 条）。

【推断】`./src/*` 导出（`dsh-client-modules`、`dsh-client-web` 等都有）只是仓库内测试与源码启动的便利，官方 README 不把它描述为稳定面；第三方依赖它等同于依赖私有路径。稳定的读法是各包的 README/"cordis-surface" 生成的 service 签名，或直接注入 service。

### 6.4 本机 `0.2.2-rc.1` 与上游 `master`（`0.2.2-rc.2`）的漂移

| 项                   | 本机 `0.2.2-rc.1`                                                                                     | 上游 `master`（`0.2.2-rc.2`）                                  | 影响                                                                          |
| -------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| 版本号               | `dsh`/`dsh-base`/`dsh-app-boot`/`dsh-client-modules`/`dsh-client-hmr`/`dsh-web-app` 全部 `0.2.2-rc.1` | 根包与各包 `0.2.2-rc.2`                                        | 引用文档时以 master 为准，行为断言以本机 rc.1 为准                            |
| 客户端 map 发布      | `files` 不含 `*.js.map`，`lib/` 无 map（suffix 仍指向 map）                                           | `files` 含 `lib/**/*.js.map`、`lib/types/**/*.d.ts.map`、`src` | rc.1 上所有客户端 stack 都是 identity map；rc.2 起可看到官方 authored sources |
| `Symbol.toStringTag` | 两个客户端 bundle 均带，宿主无读取点                                                                  | 同（preset 未变）                                              | 结论不随版本变化                                                              |
| HMR release 门控     | 已实现（`release.matches`）                                                                           | 同                                                             | 页面跨 Host 重启需刷新，rc.1 已如此                                           |
| `dsh` engines        | `node >=24.9.0`                                                                                       | 同                                                             | 第三方 `engines.node` 不要低于 24.9                                           |

来源：本机各包 `package.json`；[packages/client/hmr/package.json](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/hmr/package.json)；`~/.dsh/profiles/node_modules/@deepseek-ai/dsh-client-modules@0.2.2-rc.1/lib/client.js`。

---

## 7. 对 issue #19 的启示

> 本节只把上面的结论映射到 `pnpm dev` 的设计取舍，不重开产品范围。目标形态：watch 宿主+客户端构建、原地覆盖产物、客户端 source map、打印 desktop profile 的 `hmr`/`client-hmr` 配置片段；接受整块 bundle 重载与 React 状态丢失；生产构建不变。

### 7.1 应当保留

1. **esbuild 双产物 + 手写 `__ModuleLoader__` 外壳**。它已经等价复刻了官方 preset 的关键契约（banner/intro/footer、CJS、`external: ['react']`），且不引入 tsdown/rolldown 依赖。来源：`scripts/build.ts`、[packages/client/tsdown.client.ts](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/tsdown.client.ts)。
2. **`dsh.bundle.patch` + `cordis.patch.yml` 的安装方式**。dev 循环不该改写 profile 或 patch；安装层由 `dsh plugin` 维护。来源：`cordis.patch.yml`、[docs/user/develop/basic/publish.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.zh.md)。
3. **客户端零 DSH 运行时依赖**。当前客户端只 import React 与自身模块，`dsh.client.external` 为空，天然满足"基线之外不请求"的规则。来源：`src/client/index.tsx`、`scripts/build.ts`。

### 7.2 应当调整

1. **dev 模式不要 `rm -rf lib`。** 现有 `build` 先删目录再写两个产物。客户端侧，这会让 `rebuilt()` 看到 ENOENT（标 dirty 重试）、浏览器请求 404，并可能触发一次"空 bundle"物化。宿主侧更直接：0.2.2-rc.1 的模块 watcher 只订阅 `change`（见 §4.3 的 tag 证据），"删目录再建"产生的是 unlink/add，宿主 HMR 完全看不到。改为逐文件覆盖（宿主原地写，客户端可原子替换，见第 4 条）。来源：`scripts/build.ts`、`~/.dsh/profiles/node_modules/@deepseek-ai/dsh-client-hmr@0.2.2-rc.1/lib/index.js`（ENOENT → dirty）、[packages/boot/hmr/src/index.ts:482（tag `dsh-v0.2.2-rc.1`）](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.1/packages/boot/hmr/src/index.ts#L482)。
2. **客户端产物路径必须固定为 `exports["./client"]` 指向的文件（当前 `lib/client.js`）。** 图的 `clientPath` 来自包导出解析，不是硬编码；换成带 hash 的新文件名不会被发现，除非 Loader entry 重启（那时读 manifest）。来源：[packages/client/modules/src/index.ts](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/modules/src/index.ts)（`clientPath`）、[packages/client/modules/README.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/modules/README.zh.md)（manifest 只在 entry 启动/重启时读）。
3. **客户端 source map 是 dev 模式的实现要求，不是"打开开关"就完事。** 官方 preset 直接产出 map；本仓库的 esbuild 构建把"外壳 + CJS 产物"拼在一起，必须自己修正外壳偏移，否则 DevTools 定位整体错行：
   - esbuild `sourcemap: 'external'` 产出的 map 只描述它自己输出的那段 CJS（`var module = { exports: {} } …`），而最终 `lib/client.js` 前面还有 5 行外壳（`window.__ModuleLoader__.load({`、`id: …`、`factory: (require) => {`、`var module = { exports: {} }`、`var exports = module.exports`），客户端代码从第 6 行第 0 列开始。
   - Source Map 的 `mappings` 是**按生成行分号分隔**的（第 N 段对应第 N 条生成行），所以把每条映射整体下移 5 行，等价于在 `mappings` 前补 5 个 `;`；首列未变，不需要重算 VLQ。依据：[ECMA-426 §9.2 Mappings structure、§9.2.1 Mappings grammar](https://tc39.es/ecma426/#sec-mappings)。
   - 写 map 前要**剥掉** esbuild 追加在 CJS 末尾的 `//# sourceMappingURL=client.js.map`（否则它落在外壳中间），改在外壳最后一行追加一次；`sources` 保持 esbuild 默认（map 与 bundle 同目录）。不要用 `sourcemap: 'inline'`：宿主 combo 脚本会在拼接结果末尾再追加自己的 `sourceMappingURL`，两份声明叠加没有意义。【推断】
   - 顺序与路径：同一次 rebuild 内先写 `lib/client.js`、再写 `lib/client.js.map`；map 必须是 **sibling `<clientPath>.map`**，宿主 `readSourceMap` 直接读这个路径，畸形 map 会让 combo-map 端点抛错（`is not a regular Source Map v3 object`），缺失则退化成 identity map。
   - 期望管理：**仅 map 变化不会触发重载**，已缓存的 map body 也不会刷新；改完 map 要等一次 bundle 变更或刷新页面才看得到。

   来源：[packages/client/tsdown.client.ts](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/tsdown.client.ts)、`~/.dsh/profiles/node_modules/@deepseek-ai/dsh-client-modules@0.2.2-rc.1/lib/index.js`（`readSourceMap`/`buildComboScript`）、[docs/subsystems/client-modules.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/client-modules.zh.md)（"仅 source map 变化不会触发重载"）。

4. **客户端产物用"临时文件 + rename"原子替换，宿主产物必须原地覆写。** 客户端 HMR 是 stat 轮询：rename 后的新文件 mtime/ctime/size 照样变化，且不会读到半写内容。官方 preset 只在 `writeBundle` 里抬 mtime，并不保证写入原子性；半写文件被 stat 到会推进 revision，而客户端 HMR **不回滚**，只能等下一次重建。宿主侧相反：只监听 `change`，原子替换能否被 chokidar 的 `atomic` 窗口合并成 `change` 取决于平台与时序，不能作为契约，所以宿主产物应原地覆写（见 §4.3）。【推断】rename 对客户端可消除半写窗口。来源：`~/.dsh/profiles/node_modules/@deepseek-ai/dsh-client-hmr@0.2.2-rc.1/lib/index.js`、[packages/client/hmr/README.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/hmr/README.zh.md)（失败策略）、[packages/boot/hmr/src/index.ts:482（tag `dsh-v0.2.2-rc.1`）](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.1/packages/boot/hmr/src/index.ts#L482)。
5. **构建失败时保持旧产物不动。** 下载失败时旧插件仍活动；一旦旧 fiber 被卸载后的导入失败就不恢复。dev 构建失败若把半成品写进去，会把页面推进失败态。来源：[packages/client/hmr/README.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/hmr/README.zh.md)。
6. **`immediately: true` 应当删除。** 它是"第一阶段预取的基础设施行"专用；业务面板应走 application 批次。来源：[packages/client/AGENTS.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/AGENTS.md)（checklist 第 3 条）。
7. **把 `PLUGIN_ID` 收敛到一处（读 `package.json.name`）。** 现在 `scripts/build.ts`、`src/client/index.tsx`、`package.json` 三处字面量；客户端注册 id 与包名不一致时该 row 永不物化。来源：`scripts/build.ts`、`src/client/index.tsx`。
8. **宿主半的 watch 只负责重建，不承诺热重载。** `dsh-hmr` 在 base 里是 `root: []`（只监听 profile manifest 与两份用户 patch）；**要监听构建产物**，需在 profile patch 里把 `hmr` 行的 `root` 指向该产物目录（`root` 是模块监听目录，默认 `["."]`），并且只能原地覆写 `lib/index.js`——见 §4.3 的 `change` 证据。对 linked 安装的包，原地改写 `lib/index.js` 也会在"下一次 profile 重组合（HMR 启用时）"生效，无需 root——但重组合需要触发（profile/patch 变化或插件管理操作）。来源：`~/.dsh/profiles/node_modules/@deepseek-ai/dsh-base@0.2.2-rc.1/cordis.patch.yml`、[packages/boot/hmr/README.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/boot/hmr/README.zh.md)（"使用本包"）、[packages/boot/hmr/src/index.ts:482（tag `dsh-v0.2.2-rc.1`）](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.2.2-rc.1/packages/boot/hmr/src/index.ts#L482)。
9. **打印配置片段而不写 profile。** desktop profile 的 bundles 是 base + web-app + 若干实验 bundle（本机 `~/.dsh/profiles/desktop/package.json`），其中 base 提供 `hmr` 行、web-app 提供 `client-hmr` 行（`~/.dsh/profiles/node_modules/@deepseek-ai/dsh-web-app@0.2.2-rc.1/cordis.patch.yml`）。片段应落在用户的 `~/.dsh/profiles/desktop/cordis.patch.yml`（当前为空），并提醒"patch 替换整个 config，不做深合并"：

```yaml
# 宿主侧：让 dsh-hmr 监听本插件的构建产物，改动后重载宿主插件
- id: hmr
  name: '@deepseek-ai/dsh-hmr'
  disabled: false
  config:
    root: ['<插件包目录>/lib'] # 监听构建产物；root 默认 ["."]
# 客户端侧：bundle stat 轮询间隔
# 字段默认值是 500ms；100ms 是本 dev 模式为了让重建更快被看到的取值
- id: client-hmr
  name: '@deepseek-ai/dsh-client-hmr'
  config:
    pollIntervalMs: 100
```

依据：[packages/boot/hmr/README.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/boot/hmr/README.zh.md)（配置表：`root` 默认 `["."]`、`debounce` 100、`ignored`；profile patch 示例）、[docs/config-catalog.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/config-catalog.zh.md#deepseek-aidsh-client-hmr)（`pollIntervalMs` 默认 500、schema `min(1)`）、[docs/user/develop/basic/publish.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.zh.md)（patch 换整份 config）。10. **在 dev 输出里明确"整块重载"的预期管理。** React 状态会丢，数据层（连接/Session）保留；官方把这一点写成有意设计。来源：[packages/client/hmr/README.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/hmr/README.zh.md)。11. **dev 与 `pnpm build` 互斥。** 官方 `dev:web` 明说不得与 `build`/`build:artifacts` 并行；本仓库对应的是"watch 进程与 `pnpm build` 不要同时跑"，可用 pid/lock 或文档约束。来源：[scripts/dev-web.ts](https://github.com/deepseek-ai/deepseek-harness/blob/master/scripts/dev-web.ts)。

### 7.3 风险清单

1. **Host 重启后页面不接收更新。** 图与 `rebuilt` 帧按 release 门控；`dsh web` 在 dev 里重启后，页面仍跑旧 release，必须刷新才恢复 HMR。来源：`~/.dsh/profiles/node_modules/@deepseek-ai/dsh-client-modules@0.2.2-rc.1/lib/client.js`（`release.matches`）、[packages/client/modules/README.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/modules/README.zh.md)。
2. **事件流一次性失效。** Host 在注册 `/plugins/events` 路由前返回非 200，浏览器会永久关闭该流，刷新前既不更新插件也检测不到 release 变化。dev 脚本应保证"先起 Host，再打开页面"。来源：[packages/client/modules/README.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/modules/README.zh.md)（"已知限制"）。
3. **改 `package.json` 不生效。** 仅改 `dsh.client` 或 `exports` 需要条目重启/Host 重启；改 `./assets/*` 导出还要等包配置缓存失效。dev 脚本检测到 manifest 变化时应打印"需重启/重装"，而不是默默重建。来源：[packages/client/modules/README.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/modules/README.zh.md)。
4. **只改 map 不重载，且 map body 按首次 `GET` 固定。** 调 source map 时要等一次 bundle 变更（或刷新页面）才看到新映射。来源：[docs/subsystems/client-modules.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/client-modules.zh.md)。
5. **元数据即 revision。** mtime/ctime/size 三者都不变的重写不会被发现；`--preserve-mtime` 类工具或某些网络文件系统会踩中。官方明确这是"文件系统代际而非内容相等"。来源：[packages/client/modules/README.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/modules/README.zh.md)（"基于元数据的 revision"）。
6. **样式归属。** 若 dev 构建引入 CSS 注入，必须带 `data-plugin`/`data-plugin-css`；未标记的 `<style>` 会被"物化中的插件"认领，清理时可能误删或漏删。当前内联样式方案无此风险。来源：`~/.dsh/profiles/node_modules/@deepseek-ai/dsh-client-modules@0.2.2-rc.1/lib/client.js`（`claimStyles`）。
7. **Node 版本。** dev 脚本与插件产物都应以 Node ≥24.9 为目标；本仓库声明 24.15，等于把地板再抬高一层，需在 README 写明。来源：[docs/upgrade-guide/v0.2.1-rc.2/node-24/guide.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/upgrade-guide/v0.2.1-rc.2/node-24/guide.zh.md)、`package.json`。
8. **不要把 `Symbol.toStringTag` 当契约。** 保持官方外壳形态即可；若未来某个 DSH 版本改变 interop 判据（目前只读 `default`/`__esModule`），依赖它承载语义的代码会先坏。来源：`~/.dsh/profiles/node_modules/@deepseek-ai/cordis-plugin-loader@1.1.0/lib/index.js`。【推断】风险等级中等偏低。

### 7.4 不建议做的事

- 不要在 dev 流程里调用 `dsh plugin add/remove` 或改写 profile 的 `dsh.profile.bundles`：安装操作有自己的写锁与兼容性检查，且与 HMR 队列刻意分离。来源：[packages/boot/hmr/README.zh.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/boot/hmr/README.zh.md)（"包安装在该队列之外执行"）。
- 不要为了让面板"更快出现"而保留 `immediately: true`：它改变的是启动阶段的预取批次，不是加载速度开关。来源：[packages/client/AGENTS.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/AGENTS.md)。
- 不要在客户端半引入 `dsh.client.external` 来共享你自己的模块：官方明确它是基础设施通道，功能插件之间应走 service/slots。来源：[packages/client/AGENTS.md](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/AGENTS.md)（"external is not a feature-plugin dependency mechanism"）。
