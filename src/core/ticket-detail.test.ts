import { describe, expect, it } from 'vitest'

import {
  dedupeBy,
  diffSets,
  isEmptyDiff,
  normalizeLabelColor,
  planSetChange,
  resolveTargetSet,
} from './ticket-detail.ts'

describe('集合变更', () => {
  it('按当前值算增减，保持各自顺序', () => {
    expect(diffSets(['a', 'b', 'c'], ['c', 'd', 'a'])).toEqual({
      add: ['d'],
      remove: ['b'],
    })
  })

  it('目标集合为空时移除全部', () => {
    expect(diffSets(['a', 'b'], [])).toEqual({ add: [], remove: ['a', 'b'] })
  })

  it('相同的集合没有差异', () => {
    expect(diffSets(['a'], ['a'])).toEqual({ add: [], remove: [] })
    expect(isEmptyDiff(diffSets(['a'], ['a']))).toBe(true)
    expect(isEmptyDiff(diffSets(['a'], ['b']))).toBe(false)
  })

  it('补丁没给目标集合时沿用当前值，只并入当前用户', () => {
    expect(resolveTargetSet(['alice'], undefined, 'me')).toEqual(['alice', 'me'])
  })

  it('当前用户已存在时不重复追加', () => {
    expect(resolveTargetSet(['alice', 'me'], ['alice', 'me'], 'me')).toEqual(['alice', 'me'])
  })

  it('补丁给出目标集合时以补丁为准，再加当前用户', () => {
    expect(planSetChange(['alice', 'bob'], ['bob'], 'me')).toEqual({
      add: ['me'],
      remove: ['alice'],
    })
  })

  it('标签这种不带当前用户的变更只看目标集合', () => {
    expect(planSetChange(['bug'], ['bug', 'ready-for-agent'])).toEqual({
      add: ['ready-for-agent'],
      remove: [],
    })
  })
})

describe('补全候选的归一化', () => {
  it('颜色统一成小写 #rrggbb，不带 # 或带大写也能识别', () => {
    expect(normalizeLabelColor('d73a4a')).toBe('#d73a4a')
    expect(normalizeLabelColor('#A2EEEF')).toBe('#a2eeef')
  })

  it('缺失、空串或不是六位十六进制时颜色为 null', () => {
    expect(normalizeLabelColor(undefined)).toBeNull()
    expect(normalizeLabelColor('')).toBeNull()
    expect(normalizeLabelColor('#abc')).toBeNull()
    expect(normalizeLabelColor('1234567')).toBeNull()
    expect(normalizeLabelColor(42)).toBeNull()
  })

  it('按 key 去重并保留首次出现的顺序', () => {
    expect(
      dedupeBy(
        [
          { name: 'bug', color: '#d73a4a' },
          { name: 'enhancement', color: '#a2eeef' },
          { name: 'bug', color: '#000000' },
        ],
        (label) => label.name,
      ),
    ).toEqual([
      { name: 'bug', color: '#d73a4a' },
      { name: 'enhancement', color: '#a2eeef' },
    ])
  })
})
