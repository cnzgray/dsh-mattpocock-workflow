/**
 * GitLab 工作项层级的批量补齐。REST issue 接口本身不返回父子字段，
 * 列表或增量拿到票号后按每批最多 100 个 iid 发一次 GraphQL；
 * 查询失败只让本次快照降级为「无父子能力」，不拖垮整个列表。
 */
import { isRecord } from '../../core/json.ts'
import type { CommandRunner } from '../../core/ticket.ts'
import { TrackerError } from '../../core/tracker-error.ts'
import { callGlab } from './shared.ts'

/** GraphQL 的 `first` 上限，也是每批 iid 的上限。 */
const HIERARCHY_BATCH = 100

/**
 * 从一次工作项层级响应里读出父级引用。
 *
 * - 父级是 Issue 或 Task 时存 `#iid`；
 * - 父级是 Epic 时存 `&iid`，作为列表外父级引用；
 * - 其它工作项类型、无父级或字段不完整的节点忽略，不伪造父行。
 * @param output - `glab api graphql` 的标准输出。
 * @returns 工单 iid → 父级引用；没有父级的票不出现在结果里。
 * @throws {TrackerError} 响应带 GraphQL 错误、结构不对或编号不合法。
 */
export function parseWorkItemHierarchy(output: string): ReadonlyMap<number, string> {
  const payload = parseJson(output)
  if (!isRecord(payload)) throw invalid('工作项层级响应不是对象')

  const errors: unknown = payload.errors
  if (Array.isArray(errors) && errors.length > 0) {
    const first: unknown = errors[0]
    const message =
      isRecord(first) && typeof first.message === 'string' ? first.message : '未知 GraphQL 错误'
    throw invalid(`工作项层级查询失败：${message}`)
  }

  const data = payload.data
  if (!isRecord(data)) throw invalid('工作项层级响应缺少 data')
  const project = data.project
  if (!isRecord(project)) throw invalid('工作项层级响应缺少 project')
  const workItems = project.workItems
  if (!isRecord(workItems)) throw invalid('工作项层级响应缺少 project.workItems')
  const nodes = workItems.nodes
  if (!Array.isArray(nodes)) throw invalid('工作项层级响应的 nodes 不是数组')

  const parents = new Map<number, string>()
  for (const node of nodes) {
    if (!isRecord(node)) throw invalid('工作项层级节点不是对象')

    const iid = readIid(node.iid)
    const parent = readParent(node.widgets)
    if (parent !== undefined) parents.set(iid, parent)
  }
  return parents
}

/**
 * 按票号分批读取父级引用。任何一批失败都抛错，由调用方把本次快照
 * 整体降级为无父子能力；不发布只补了一半的层级。
 * @param run - 命令执行器。
 * @param workspaceRoot - 工作区根目录。
 * @param project - 含嵌套 group 的项目路径。
 * @param iids - 要补齐的票号。
 * @returns 工单 iid → 父级引用。
 * @throws {TrackerError} 任一批查询失败。
 */
export async function readWorkItemParents(
  run: CommandRunner,
  workspaceRoot: string,
  project: string,
  iids: readonly number[],
): Promise<ReadonlyMap<number, string>> {
  const parents = new Map<number, string>()

  for (let start = 0; start < iids.length; start += HIERARCHY_BATCH) {
    const batch = iids.slice(start, start + HIERARCHY_BATCH)
    const query = hierarchyQuery(batch)
    const output = await callGlab(run, workspaceRoot, [
      'api',
      'graphql',
      '-f',
      `query=${query}`,
      '-f',
      `project=${project}`,
    ])
    for (const [iid, parent] of parseWorkItemHierarchy(output)) {
      parents.set(iid, parent)
    }
  }
  return parents
}

/** 一批 iid 的工作项层级查询。iid 以字符串数组内联，与批量阻塞计数同一写法。 */
function hierarchyQuery(batch: readonly number[]): string {
  const iids = batch.map((iid) => `"${String(iid)}"`).join(', ')
  return `query ($project: ID!) { project(fullPath: $project) { workItems(iids: [${iids}], first: ${String(batch.length)}) { nodes { iid widgets { type ... on WorkItemWidgetHierarchy { parent { iid workItemType { name } } } } } } } }`
}

/**
 * 从 widgets 里找层级 widget 的父级。
 * @param value - 节点的 `widgets` 数组。
 * @returns 父级引用；无父级或类型不在列表内时 undefined。
 */
function readParent(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined

  for (const widget of value) {
    if (!isRecord(widget)) continue
    if (!Object.hasOwn(widget, 'parent')) continue

    const parent = widget.parent
    if (parent === null || parent === undefined) return undefined
    if (!isRecord(parent)) return undefined

    const iid = readIid(parent.iid)
    const type = parent.workItemType
    if (!isRecord(type)) return undefined
    const name = type.name
    if (typeof name !== 'string') return undefined

    switch (name.toLowerCase()) {
      case 'issue':
      case 'task':
        return `#${String(iid)}`
      case 'epic':
        return `&${String(iid)}`
      default:
        return undefined
    }
  }
  return undefined
}

function readIid(value: unknown): number {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value
  if (typeof value === 'string' && /^\d+$/.test(value)) {
    const iid = Number.parseInt(value, 10)
    if (Number.isInteger(iid) && iid > 0) return iid
  }
  throw invalid('工作项层级里的编号不合法')
}

function parseJson(output: string): unknown {
  try {
    return JSON.parse(output)
  } catch (error) {
    throw new TrackerError('fetch-failed', 'GitLab 返回的不是有效 JSON。', { cause: error })
  }
}

function invalid(message: string): TrackerError {
  return new TrackerError('fetch-failed', `工单数据格式不正确：${message}`)
}
