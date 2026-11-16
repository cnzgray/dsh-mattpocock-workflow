/**
 * GitLab 正文里内联上传图片的取回。
 *
 * GitLab 把拖进正文的附件写成根相对地址 `/uploads/<secret>/<filename>`。私有项目的附件要登录
 * 才能取，面板里的 `<img>` 带不上 GitLab 会话，所以由宿主用已登录的 `glab api` 取回字节，
 * 以 base64 交给界面。抓取目标只由「当前工作区的项目 + 合法的 uploads 路径」推导，
 * 正文里的主机与其他地址一律不信任；token 由 `glab` 自己持有，不经过这里。
 */
import type { CommandRunner, TicketAttachment } from '../../core/ticket.ts'
import { TrackerError } from '../../core/tracker-error.ts'
import { mapGlabError, projectEndpoint, readProjectPath } from './shared.ts'

/** 内联显示的图片上限；超过就退回原链接，不把大文件塞进面板。 */
export const ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024

/** GitLab 上传附件的根相对地址：32 位十六进制 secret 加单段文件名。 */
const UPLOAD_PATH = /^\/uploads\/([0-9a-f]{32})\/([^/?#]+)$/

/** 识别图片类型用的文件头。SVG 是文本格式、可能带脚本，不在其列。 */
const IMAGE_SIGNATURES: readonly {
  readonly mediaType: string
  readonly matches: (bytes: Uint8Array) => boolean
}[] = [
  {
    mediaType: 'image/png',
    matches: (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  },
  { mediaType: 'image/jpeg', matches: (b) => startsWith(b, [0xff, 0xd8, 0xff]) },
  { mediaType: 'image/gif', matches: (b) => startsWith(b, [0x47, 0x49, 0x46, 0x38]) },
  {
    mediaType: 'image/webp',
    matches: (b) =>
      startsWith(b, [0x52, 0x49, 0x46, 0x46]) &&
      startsWith(b.subarray(8), [0x57, 0x45, 0x42, 0x50]),
  },
]

/**
 * 解析正文里的附件地址，得到项目内的 uploads 接口相对段。
 * @param path - 正文里的根相对地址。
 * @returns `uploads/<secret>/<编码后的文件名>`；不是合法附件地址时 undefined。
 */
export function uploadEndpointSegment(path: string): string | undefined {
  const match = UPLOAD_PATH.exec(path)
  if (match === null) return undefined
  const [, secret, rawName] = match
  if (secret === undefined || rawName === undefined) return undefined
  let name: string
  try {
    name = decodeURIComponent(rawName)
  } catch {
    return undefined
  }
  // 解码后仍必须是单段、可见的文件名，防止 `%2F..%2F` 之类越出 uploads 目录。
  // eslint-disable-next-line no-control-regex -- 这里就是要拒绝控制字符。
  if (name.length === 0 || name === '.' || name === '..' || /[/\\\u0000-\u001f]/.test(name)) {
    return undefined
  }
  return `uploads/${secret}/${encodeURIComponent(name)}`
}

/**
 * 取回一张正文内联图片。
 * @param deps - 命令执行器。
 * @param workspaceRoot - 工作区根目录。
 * @param path - 正文里的根相对附件地址。
 * @returns 图片类型与 base64 字节。
 * @throws {TrackerError} 地址不合法、取不到、不是图片或超过大小上限。
 */
export async function readGitlabAttachment(
  deps: { readonly run: CommandRunner },
  workspaceRoot: string,
  path: string,
): Promise<TicketAttachment> {
  const segment = uploadEndpointSegment(path)
  if (segment === undefined) {
    throw new TrackerError('fetch-failed', '只能读取当前项目的 /uploads/ 附件。')
  }

  const project = await readProjectPath(deps.run, workspaceRoot)
  let base64: string
  try {
    base64 = (
      await deps.run('glab', ['api', `${projectEndpoint(project)}/${segment}`], {
        cwd: workspaceRoot,
        stdout: 'base64',
      })
    ).stdout
  } catch (error) {
    throw mapGlabError(error)
  }

  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(base64) || base64.length === 0) {
    throw new TrackerError('fetch-failed', '附件响应为空或已损坏。')
  }
  // base64 每 4 个字符对应 3 个字节；先按长度拦掉超限的，再解码。
  if (Math.floor((base64.length * 3) / 4) > ATTACHMENT_MAX_BYTES) {
    throw new TrackerError('fetch-failed', '附件超过内联显示的大小上限。')
  }

  const head = Buffer.from(base64.slice(0, 24), 'base64')
  const signature = IMAGE_SIGNATURES.find((candidate) => candidate.matches(head))
  if (signature === undefined) {
    throw new TrackerError('fetch-failed', '附件不是可内联显示的图片。')
  }
  return { mediaType: signature.mediaType, base64 }
}

function startsWith(bytes: Uint8Array, prefix: readonly number[]): boolean {
  return prefix.every((value, index) => bytes[index] === value)
}
