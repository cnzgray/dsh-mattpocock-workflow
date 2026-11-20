/**
 * 视图偏好的纯逻辑测试：模块只依赖注入的存储对象，这里用内存实现模拟浏览器存储。
 */
import { describe, expect, it } from 'vitest'

import {
  DEFAULT_VIEW,
  readViewPreference,
  writeViewPreference,
  type PreferenceStorage,
  type ViewPreference,
} from './view-preference.ts'

const SAVED: ViewPreference = {
  filter: 'closed',
  sortKey: 'number',
  direction: 'desc',
  assignedToMe: true,
  createdByMe: false,
  layout: 'tree',
  showAuthor: false,
  showCreatedAt: false,
  showUpdatedAt: true,
  showAssignees: true,
}

class MemoryStorage implements PreferenceStorage {
  private readonly items = new Map<string, string>()

  get length(): number {
    return this.items.size
  }

  key(index: number): string | null {
    return [...this.items.keys()][index] ?? null
  }

  getItem(key: string): string | null {
    return this.items.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.items.set(key, value)
  }

  removeItem(key: string): void {
    this.items.delete(key)
  }

  onlyKey(): string {
    const key = [...this.items.keys()].at(0)
    if (key === undefined) throw new Error('存储为空')
    return key
  }

  /** 改写唯一一条记录，模拟损坏存档、旧版本或手工改动。 */
  rewriteOnly(mutate: (record: Record<string, unknown>) => void): void {
    const key = this.onlyKey()
    const raw = this.items.get(key)
    if (raw === undefined) throw new Error('存储为空')
    const record = JSON.parse(raw) as Record<string, unknown>
    mutate(record)
    this.items.set(key, JSON.stringify(record))
  }
}

function brokenStorage(): PreferenceStorage {
  const fail = (): never => {
    throw new Error('存储不可用')
  }
  return {
    get length(): number {
      return fail()
    },
    key: fail,
    getItem: fail,
    setItem: fail,
    removeItem: fail,
  }
}

describe('视图偏好', () => {
  it('没有存档时返回默认视图', () => {
    expect(readViewPreference(new MemoryStorage(), '/repo')).toEqual(DEFAULT_VIEW)
  })

  it('没有工作区根路径时不读也不写', () => {
    const storage = new MemoryStorage()

    writeViewPreference(storage, undefined, SAVED)

    expect(storage.length).toBe(0)
    expect(readViewPreference(storage, undefined)).toEqual(DEFAULT_VIEW)
  })

  it('读写往返保持筛选、排序键与方向', () => {
    const storage = new MemoryStorage()

    writeViewPreference(storage, '/repo', SAVED)

    expect(readViewPreference(storage, '/repo')).toEqual(SAVED)
  })

  it('按工作区隔离，互不影响', () => {
    const storage = new MemoryStorage()

    writeViewPreference(storage, '/one', SAVED)
    writeViewPreference(storage, '/two', DEFAULT_VIEW)

    expect(readViewPreference(storage, '/one')).toEqual(SAVED)
    expect(readViewPreference(storage, '/two')).toEqual(DEFAULT_VIEW)
    expect(storage.length).toBe(2)
  })

  it('非法筛选只回退筛选', () => {
    const storage = new MemoryStorage()
    writeViewPreference(storage, '/repo', SAVED)
    storage.rewriteOnly((record) => {
      record.filter = 'bogus'
    })

    expect(readViewPreference(storage, '/repo')).toEqual({
      ...SAVED,
      filter: DEFAULT_VIEW.filter,
    })
  })

  it('非法排序键只回退排序键', () => {
    const storage = new MemoryStorage()
    writeViewPreference(storage, '/repo', SAVED)
    storage.rewriteOnly((record) => {
      record.sortKey = 'bogus'
    })

    expect(readViewPreference(storage, '/repo')).toEqual({
      ...SAVED,
      sortKey: DEFAULT_VIEW.sortKey,
    })
  })

  it('旧存档没有布局字段时回退平铺', () => {
    const storage = new MemoryStorage()
    writeViewPreference(storage, '/repo', SAVED)
    storage.rewriteOnly((record) => {
      delete record.layout
    })

    expect(readViewPreference(storage, '/repo')).toEqual({
      ...SAVED,
      layout: DEFAULT_VIEW.layout,
    })
  })

  it('非法布局只回退布局', () => {
    const storage = new MemoryStorage()
    writeViewPreference(storage, '/repo', SAVED)
    storage.rewriteOnly((record) => {
      record.layout = 'masonry'
    })

    expect(readViewPreference(storage, '/repo')).toEqual({
      ...SAVED,
      layout: DEFAULT_VIEW.layout,
    })
  })

  it('非法方向只回退方向', () => {
    const storage = new MemoryStorage()
    writeViewPreference(storage, '/repo', SAVED)
    storage.rewriteOnly((record) => {
      record.direction = 'sideways'
    })

    expect(readViewPreference(storage, '/repo')).toEqual({
      ...SAVED,
      direction: DEFAULT_VIEW.direction,
    })
  })

  it('旧记录没有人员开关时按关闭读取，其余字段保留', () => {
    const storage = new MemoryStorage()
    writeViewPreference(storage, '/repo', SAVED)
    storage.rewriteOnly((record) => {
      delete record.assignedToMe
      delete record.createdByMe
    })

    expect(readViewPreference(storage, '/repo')).toEqual({
      ...SAVED,
      assignedToMe: false,
      createdByMe: false,
    })
  })

  it('非法人员开关只回退该字段，另一个开关与筛选排序保留', () => {
    const storage = new MemoryStorage()
    writeViewPreference(storage, '/repo', SAVED)
    storage.rewriteOnly((record) => {
      record.assignedToMe = 'yes'
      record.createdByMe = true
    })

    expect(readViewPreference(storage, '/repo')).toEqual({
      ...SAVED,
      assignedToMe: DEFAULT_VIEW.assignedToMe,
      createdByMe: true,
    })
  })

  it('默认视图不按人员筛选', () => {
    expect(DEFAULT_VIEW.assignedToMe).toBe(false)
    expect(DEFAULT_VIEW.createdByMe).toBe(false)
  })

  it('默认视图显示创建人与创建时间，不显示更新时间与分配人', () => {
    expect(DEFAULT_VIEW.showAuthor).toBe(true)
    expect(DEFAULT_VIEW.showCreatedAt).toBe(true)
    expect(DEFAULT_VIEW.showUpdatedAt).toBe(false)
    expect(DEFAULT_VIEW.showAssignees).toBe(false)
  })

  it('旧记录没有行内显示开关时按默认读取，其余字段保留', () => {
    const storage = new MemoryStorage()
    writeViewPreference(storage, '/repo', SAVED)
    storage.rewriteOnly((record) => {
      delete record.showAuthor
      delete record.showCreatedAt
      delete record.showUpdatedAt
      delete record.showAssignees
    })

    expect(readViewPreference(storage, '/repo')).toEqual({
      ...SAVED,
      showAuthor: DEFAULT_VIEW.showAuthor,
      showCreatedAt: DEFAULT_VIEW.showCreatedAt,
      showUpdatedAt: false,
      showAssignees: false,
    })
  })

  it('非法行内显示开关只回退该字段，其余开关与偏好保留', () => {
    const storage = new MemoryStorage()
    writeViewPreference(storage, '/repo', SAVED)
    storage.rewriteOnly((record) => {
      record.showAuthor = 'yes'
      record.showCreatedAt = 1
      record.showUpdatedAt = false
    })

    expect(readViewPreference(storage, '/repo')).toEqual({
      ...SAVED,
      showAuthor: DEFAULT_VIEW.showAuthor,
      showCreatedAt: DEFAULT_VIEW.showCreatedAt,
      showUpdatedAt: false,
    })
  })

  it('JSON 损坏时整体回退默认视图', () => {
    const storage = new MemoryStorage()
    writeViewPreference(storage, '/repo', SAVED)
    storage.setItem(storage.onlyKey(), '{')

    expect(readViewPreference(storage, '/repo')).toEqual(DEFAULT_VIEW)
  })

  it('版本不符时整体回退默认视图', () => {
    const storage = new MemoryStorage()
    writeViewPreference(storage, '/repo', SAVED)
    storage.rewriteOnly((record) => {
      record.version = 2
    })

    expect(readViewPreference(storage, '/repo')).toEqual(DEFAULT_VIEW)
  })

  it('最多保留 50 个工作区条目，写入时淘汰最旧', () => {
    const storage = new MemoryStorage()

    for (let index = 0; index < 51; index += 1) {
      writeViewPreference(storage, `/ws/${String(index)}`, SAVED, () => index)
    }

    expect(storage.length).toBe(50)
    expect(readViewPreference(storage, '/ws/0')).toEqual(DEFAULT_VIEW)
    expect(readViewPreference(storage, '/ws/1')).toEqual(SAVED)
    expect(readViewPreference(storage, '/ws/50')).toEqual(SAVED)
  })

  it('存储读取抛错时返回默认视图', () => {
    expect(readViewPreference(brokenStorage(), '/repo')).toEqual(DEFAULT_VIEW)
  })

  it('存储写入抛错时不抛出，面板照常运行', () => {
    expect(() => {
      writeViewPreference(brokenStorage(), '/repo', SAVED)
    }).not.toThrow()
  })
})
