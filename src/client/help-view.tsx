/**
 * 流程帮助视图：按场景分页签，每次只看一张竖向排版的 SVG 流程图，
 * 讲清入池、triage 状态机、需求链、需求已明确时的直达规格、缺陷链，以及访谈与画图的取舍。
 *
 * 图里的命令、归属与交接关系全部来自 protocol 的流程定义；图本身不可点击。
 * 颜色走面板的主题变量，深色/浅色主题都能读。
 */
import * as React from 'react'

import { FLOW_COMMANDS, FLOW_DIAGRAMS, type FlowDiagram, type FlowNode } from '../protocol/flow.ts'
import {
  BUTTON_STYLE,
  CHIP_ACTIVE_STYLE,
  CHIP_STYLE,
  COLORS,
  MONO_FONT,
  SEGMENTED_STYLE,
} from './task-panel-styles.ts'

/** 帮助视图依赖。 */
export interface HelpViewProps {
  /** 返回打开帮助前所在的面板视图。 */
  readonly onBack: () => void
}

const SVG_WIDTH = 300
const PADDING = 10
const NODE_HEIGHT = 38
const NODE_GAP = 8
const LINE_GAP = 8
const ROW_GAP = 24
const FRAME_PADDING = 4

const LEGEND_ITEM_STYLE = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: 5,
} as const

const STOP_DOT_STYLE = {
  width: 7,
  height: 7,
  borderRadius: '50%',
  background: COLORS.warn,
  display: 'inline-block',
} as const

interface PlacedNode {
  readonly node: FlowNode
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

interface RowFrame {
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

interface PlacedRow {
  readonly top: number
  readonly bottom: number
  /** 每行节点；超过三个节点时折成两行。 */
  readonly lines: readonly (readonly PlacedNode[])[]
  /** 连线的起点与终点；有框时落在框边上。 */
  readonly edgeTop: number
  readonly edgeBottom: number
  readonly frame: RowFrame | null
}

interface DiagramLayout {
  readonly rows: readonly PlacedRow[]
  readonly height: number
}

/** 流程图在宽面板里的最大显示宽度：约为设计尺寸的 1.2 倍，字号不再跟着面板放大。 */
const DIAGRAM_MAX_WIDTH = 360

/**
 * 流程帮助视图根组件。
 * @param props - 返回入口。
 * @returns 返回按钮、场景页签、当前场景的流程图与图例。
 */
export function HelpView(props: HelpViewProps): React.ReactElement {
  const [activeId, setActiveId] = React.useState(FLOW_DIAGRAMS[0]?.id ?? '')
  const active = FLOW_DIAGRAMS.find((diagram) => diagram.id === activeId) ?? FLOW_DIAGRAMS[0]

  return (
    <div
      data-testid="help-view"
      style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}
    >
      <header
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          flex: 'none',
          padding: '10px 12px',
          borderBottom: `1px solid ${COLORS.border}`,
        }}
      >
        <button type="button" data-testid="help-back" onClick={props.onBack} style={BUTTON_STYLE}>
          ← 返回
        </button>
        <span style={{ fontSize: 13, fontWeight: 600 }}>流程帮助</span>
      </header>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          flex: 1,
          minHeight: 0,
          overflow: 'auto',
          padding: '12px 12px 16px',
        }}
      >
        <p style={{ margin: 0, color: COLORS.secondary, fontSize: 12, lineHeight: 1.6 }}>
          入池只建票、不处理；处理从票出发，每一步都在命令之间停下，等你发下一条命令。
        </p>
        <ScenarioTabs
          activeId={active?.id}
          onSelect={(id) => {
            setActiveId(id)
          }}
        />
        {active === undefined ? null : (
          <div
            id="flow-diagrams"
            data-testid="flow-diagrams"
            role="tabpanel"
            aria-labelledby={`flow-tab-${active.id}`}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 12,
              padding: '12px 14px 14px',
              border: `1px solid ${COLORS.border}`,
              borderRadius: 10,
            }}
          >
            <Diagram key={active.id} diagram={active} />
            <Legend />
          </div>
        )}
      </div>
    </div>
  )
}

/** 场景页签：每个场景一张图，一次只看一张。 */
function ScenarioTabs(props: {
  readonly activeId: string | undefined
  readonly onSelect: (id: string) => void
}): React.ReactElement {
  return (
    <div role="tablist" aria-label="场景" style={{ ...SEGMENTED_STYLE, alignSelf: 'flex-start' }}>
      {FLOW_DIAGRAMS.map((diagram) => {
        const selected = diagram.id === props.activeId
        return (
          <button
            key={diagram.id}
            type="button"
            role="tab"
            id={`flow-tab-${diagram.id}`}
            data-testid={`flow-tab-${diagram.id}`}
            aria-selected={selected}
            aria-controls="flow-diagrams"
            data-hover="soft"
            onClick={() => {
              props.onSelect(diagram.id)
            }}
            style={{ ...CHIP_STYLE, ...(selected ? CHIP_ACTIVE_STYLE : undefined) }}
          >
            {diagram.title}
          </button>
        )
      })}
    </div>
  )
}

function Legend(): React.ReactElement {
  return (
    <div
      data-testid="flow-legend"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        justifyContent: 'center',
        gap: '4px 14px',
        paddingTop: 10,
        borderTop: `1px solid ${COLORS.border}`,
        color: COLORS.tertiary,
        fontSize: 11,
      }}
    >
      <span data-testid="legend-plugin" style={LEGEND_ITEM_STYLE}>
        <Swatch color={COLORS.accent} filled />
        mattwf- 插件命令
      </span>
      <span data-testid="legend-matt" style={LEGEND_ITEM_STYLE}>
        <Swatch color={COLORS.borderStrong} />
        matt 技能
      </span>
      <span data-testid="legend-stop" style={LEGEND_ITEM_STYLE}>
        <span style={STOP_DOT_STYLE} />
        agent 停下，等你发下一条命令
      </span>
    </div>
  )
}

function Swatch(props: { readonly color: string; readonly filled?: boolean }): React.ReactElement {
  return (
    <span
      style={{
        width: 12,
        height: 8,
        borderRadius: 3,
        border: `1.5px solid ${props.color}`,
        background: props.filled === true ? COLORS.surfaceActive : 'transparent',
        display: 'inline-block',
      }}
    />
  )
}

function Diagram(props: { readonly diagram: FlowDiagram }): React.ReactElement {
  const layout = layoutDiagram(props.diagram)
  const markerId = `flow-arrow-${props.diagram.id}`

  return (
    <section style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600, color: COLORS.text }}>
          {props.diagram.title}
        </h3>
        <p style={{ margin: 0, color: COLORS.secondary, fontSize: 12, lineHeight: 1.6 }}>
          {props.diagram.summary}
        </p>
      </div>
      <svg
        role="img"
        aria-label={props.diagram.title}
        viewBox={`0 0 ${String(SVG_WIDTH)} ${String(layout.height)}`}
        width="100%"
        style={{
          display: 'block',
          overflow: 'visible',
          maxWidth: DIAGRAM_MAX_WIDTH,
          margin: '0 auto',
        }}
      >
        <defs>
          <marker
            id={markerId}
            viewBox="0 0 8 8"
            refX="7"
            refY="4"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M0,0 L8,4 L0,8 z" fill={COLORS.borderStrong} />
          </marker>
        </defs>
        {layout.rows.map((row, index) =>
          row.frame === null ? null : (
            <rect
              key={`frame-${String(index)}`}
              x={row.frame.x}
              y={row.frame.y}
              width={row.frame.width}
              height={row.frame.height}
              rx={10}
              fill="none"
              stroke={COLORS.border}
              strokeDasharray="4 3"
            />
          ),
        )}
        <Connectors rows={layout.rows} markerId={markerId} />
        {layout.rows
          .flatMap((row) => row.lines.flat())
          .map((placed, index) => (
            <NodeShape
              key={`${String(index)}-${placed.node.command ?? placed.node.state ?? ''}`}
              placed={placed}
            />
          ))}
      </svg>
    </section>
  )
}

interface EdgePoint {
  readonly x: number
  readonly y: number
}

function Connectors(props: {
  readonly rows: readonly PlacedRow[]
  readonly markerId: string
}): React.ReactElement {
  const paths: React.ReactElement[] = []
  for (let index = 1; index < props.rows.length; index += 1) {
    const previous = props.rows[index - 1]
    const next = props.rows[index]
    if (previous === undefined || next === undefined) continue
    const from = edgePoints(previous, 'bottom')
    const to = edgePoints(next, 'top')
    if (from.length === 0 || to.length === 0) continue

    const sourceY = Math.min(...from.map((point) => point.y))
    const targetY = Math.max(...to.map((point) => point.y))
    const midY = sourceY + (targetY - sourceY) / 2
    const allCenters = [...from.map((point) => point.x), ...to.map((point) => point.x)]
    const left = Math.min(...allCenters)
    const right = Math.max(...allCenters)

    if (from.length === 1 && to.length === 1) {
      const start = from[0]
      const end = to[0]
      if (start === undefined || end === undefined) continue
      paths.push(
        <line
          key={`line-${String(index)}`}
          x1={start.x}
          y1={start.y}
          x2={end.x}
          y2={end.y}
          stroke={COLORS.borderStrong}
          strokeWidth={1.2}
          markerEnd={`url(#${props.markerId})`}
        />,
      )
      continue
    }

    const segments = [
      ...from.map((point) => (
        <line
          key={`from-${String(index)}-${String(point.x)}`}
          x1={point.x}
          y1={point.y}
          x2={point.x}
          y2={midY}
          stroke={COLORS.borderStrong}
          strokeWidth={1.2}
        />
      )),
      <line
        key={`bar-${String(index)}`}
        x1={left}
        y1={midY}
        x2={right}
        y2={midY}
        stroke={COLORS.borderStrong}
        strokeWidth={1.2}
        strokeLinecap="round"
      />,
      ...to.map((point) => (
        <line
          key={`to-${String(index)}-${String(point.x)}`}
          x1={point.x}
          y1={midY}
          x2={point.x}
          y2={point.y}
          stroke={COLORS.borderStrong}
          strokeWidth={1.2}
          markerEnd={`url(#${props.markerId})`}
        />
      )),
    ]
    paths.push(<g key={`connector-${String(index)}`}>{segments}</g>)
  }
  return <g>{paths}</g>
}

/** 一组并列节点只留一个连接点；普通行按每个节点连。 */
function edgePoints(row: PlacedRow, side: 'top' | 'bottom'): readonly EdgePoint[] {
  const y = side === 'top' ? row.edgeTop : row.edgeBottom
  if (row.frame !== null) {
    return [{ x: row.frame.x + row.frame.width / 2, y }]
  }
  const line = side === 'top' ? row.lines[0] : row.lines.at(-1)
  return (line ?? []).map((placed) => ({ x: placed.x + placed.width / 2, y }))
}

function NodeShape(props: { readonly placed: PlacedNode }): React.ReactElement {
  const { placed } = props
  const { node } = placed
  const command = node.command === null ? null : FLOW_COMMANDS[node.command]
  const centerX = placed.x + placed.width / 2
  const label = command === null ? (node.state ?? '') : command.name
  const plugin = command?.owner === 'plugin'

  return (
    <g
      data-command={command?.name}
      data-owner={command?.owner}
      data-stops={node.stops ? 'true' : 'false'}
    >
      <rect
        x={placed.x}
        y={placed.y}
        width={placed.width}
        height={placed.height}
        rx={7}
        fill={plugin ? COLORS.surfaceActive : COLORS.surface}
        stroke={plugin ? COLORS.accent : COLORS.borderStrong}
        strokeWidth={1.2}
        strokeDasharray={command === null ? '3 3' : undefined}
      />
      <text
        x={centerX}
        y={placed.y + (node.note === null ? 23 : 17)}
        textAnchor="middle"
        fontFamily={MONO_FONT}
        fontSize={command === null ? 9.5 : placed.width < 100 ? 8.5 : 10}
        fill={COLORS.text}
      >
        {label}
      </text>
      {node.note === null ? null : (
        <text
          x={centerX}
          y={placed.y + 31}
          textAnchor="middle"
          fontSize={8.5}
          fill={COLORS.secondary}
        >
          {node.note}
        </text>
      )}
      {node.stops ? (
        <circle cx={placed.x + placed.width} cy={placed.y} r={3.5} fill={COLORS.warn} />
      ) : null}
    </g>
  )
}

function layoutDiagram(diagram: FlowDiagram): DiagramLayout {
  let y = PADDING
  const rows: PlacedRow[] = []

  for (const row of diagram.rows) {
    const lines: readonly (readonly FlowNode[])[] = splitLines(row.nodes)
    const rowHeight = lines.length * NODE_HEIGHT + (lines.length - 1) * LINE_GAP
    const placedLines = lines.map((lineNodes, lineIndex) => {
      const width = (SVG_WIDTH - PADDING * 2 - NODE_GAP * (lineNodes.length - 1)) / lineNodes.length
      return lineNodes.map((node, nodeIndex) => ({
        node,
        x: PADDING + nodeIndex * (width + NODE_GAP),
        y: y + lineIndex * (NODE_HEIGHT + LINE_GAP),
        width,
        height: NODE_HEIGHT,
      }))
    })

    const grouped = row.nodes.length > 3
    const frame = grouped
      ? {
          x: PADDING - FRAME_PADDING,
          y: y - FRAME_PADDING,
          width: SVG_WIDTH - PADDING * 2 + FRAME_PADDING * 2,
          height: rowHeight + FRAME_PADDING * 2,
        }
      : null
    rows.push({
      top: y,
      bottom: y + rowHeight,
      lines: placedLines,
      edgeTop: frame?.y ?? y,
      edgeBottom: frame === null ? y + rowHeight : frame.y + frame.height,
      frame,
    })
    y += rowHeight + ROW_GAP
  }

  const lastFrame = rows.at(-1)?.frame
  const height =
    (lastFrame === undefined || lastFrame === null ? y - ROW_GAP : lastFrame.y + lastFrame.height) +
    PADDING
  return { rows, height }
}

/** 一行最多三个节点；四个节点折成两行，窄侧栏里也放得下。 */
function splitLines(nodes: readonly FlowNode[]): readonly (readonly FlowNode[])[] {
  if (nodes.length <= 3) return [nodes]
  const lines: FlowNode[][] = []
  for (let index = 0; index < nodes.length; index += 2) {
    lines.push(nodes.slice(index, index + 2))
  }
  return lines
}
