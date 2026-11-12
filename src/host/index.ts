/**
 * 服务端插件入口。DSH 按默认导出加载：inject 里列出的服务就绪后才调用 apply。
 * 这里只做组装，不写业务逻辑：业务逻辑放 core，对接外部系统放 adapters。
 *
 * 目前是空插件，只用来走通构建和加载。
 */
const plugin = {
  inject: [] as string[],
  apply(): void {
    // 空插件：还没有任何功能。
  },
}

export default plugin
