/**
 * 宿主把 core 判定的技能动作附到快照上：阻塞补齐后要按新计数重算，
 * 同时 core 与 protocol 的动作词表必须一致。
 */
import { describe, expect, it } from 'vitest'

import { SKILL_ACTION_REASONS, SKILL_ACTIONS } from '../core/skill-action.ts'
import type { Ticket, TrackerSnapshot } from '../core/ticket.ts'
import { REQUIRED_SKILLS, SKILL_ACTION_SKILLS } from '../protocol/env-check.ts'
import { TICKET_ACTION_REASONS, TICKET_SKILL_ACTIONS, TRACKER_LABELS } from '../protocol/labels.ts'
import type { BackendResolver } from './backend-resolver.ts'
import { createSnapshotService, type SnapshotService } from './snapshot-service.ts'

const ROOT = '/workspace'

const READY_TICKET: Ticket = {
  ref: '#1',
  number: 1,
  title: '一张可接的需求',
  state: 'open',
  labels: [TRACKER_LABELS.readyForAgent, TRACKER_LABELS.enhancement],
  author: null,
  assignees: [],
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  openBlockers: 0,
}

const RAW: TrackerSnapshot = {
  repository: 'cnzgray/repo',
  fetchedAt: 1_000,
  loaded: 1,
  total: 1,
  tickets: [READY_TICKET],
  viewer: null,
}

function serviceWithNativeBlocker(): SnapshotService {
  const resolve: BackendResolver = () =>
    Promise.resolve({
      kind: 'gitlab',
      tracker: {
        fetchSnapshot: () => Promise.resolve(RAW),
        resolveBlockers: () =>
          Promise.resolve({ open: new Map([['#1', 1]]), blockedBy: new Map() }),
      },
      choice: { kind: 'gitlab', source: 'remote' },
      address: { host: 'gitlab.com', path: 'cnzgray/repo' },
    })

  return createSnapshotService({
    resolve,
    now: () => 1_000,
    labels: TRACKER_LABELS,
    log: () => undefined,
  })
}

describe('快照里的技能动作', () => {
  it('补齐原生阻塞后按新阻塞数重算技能动作', async () => {
    const service = serviceWithNativeBlocker()

    const phaseOne = await service.handle('snapshot.get', { workspaceRoot: ROOT })
    if (!phaseOne.ok) throw new Error(phaseOne.error.message)
    expect(phaseOne.result.tickets[0]).toMatchObject({
      ref: '#1',
      skillAction: 'implement',
      skillActionReason: 'ready-for-agent',
    })

    const finalized = await service.handle('snapshot.resolveBlockers', { workspaceRoot: ROOT })
    if (!finalized.ok) throw new Error(finalized.error.message)
    expect(finalized.result.tickets[0]).toMatchObject({
      ref: '#1',
      openBlockers: 1,
      skillAction: 'none',
      skillActionReason: 'blocked',
    })
  })
})

describe('技能动作词表', () => {
  it('core 与 protocol 的动作和判定依据取值一致', () => {
    expect([...TICKET_SKILL_ACTIONS]).toEqual([...SKILL_ACTIONS])
    expect([...TICKET_ACTION_REASONS]).toEqual([...SKILL_ACTION_REASONS])
  })

  it('core 能产出的每个可注入动作都有面板技能名', () => {
    const injectable = SKILL_ACTIONS.filter((action) => action !== 'none')

    expect(Object.keys(SKILL_ACTION_SKILLS)).toEqual(injectable)
  })

  it('注入用到的技能名都在必需技能清单里', () => {
    for (const name of Object.values(SKILL_ACTION_SKILLS)) {
      expect(REQUIRED_SKILLS).toContain(name)
    }
  })
})
