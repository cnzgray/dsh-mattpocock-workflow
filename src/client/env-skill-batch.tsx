/**
 * 技能总装卡片：缺两项以上必需技能时，一条会话提示词一次装齐。
 * 缺失清单从报告里的技能检查项派生，不新增检查项，也不参与通过/失败计数。
 */
import * as React from 'react'

import { ENV_CHECK_IDS, type EnvCheckItem } from '../protocol/env-check.ts'
import { ENV_DETAIL_STYLE, ENV_SECTION_STYLE, ENV_TITLE_STYLE } from './env-check-styles.ts'
import { installSkillsContent } from './env-remedy-text.ts'
import { RemedyLink, SessionAction } from './env-remedy-view.tsx'
import { useI18n } from './i18n.tsx'
import type { PromptInjection } from './injection.ts'

/** 缺失的必需技能，按报告里检查项的固定顺序；跳过项不算缺失。 */
export function missingSkills(items: readonly EnvCheckItem[]): readonly string[] {
  return items.flatMap((item) =>
    item.id === ENV_CHECK_IDS.skill && item.status === 'fail' && item.subject !== null
      ? [item.subject]
      : [],
  )
}

/**
 * 技能总装卡片；缺失项少于两项时什么都不渲染。
 * @param props - 缺失技能与注入端口。
 * @returns 标题、明细、摘要、会话动作与来源链接。
 */
export function SkillBatchCard(props: {
  readonly skills: readonly string[]
  readonly injection: PromptInjection
}): React.ReactElement | null {
  const { t } = useI18n()
  if (props.skills.length < 2) return null

  const content = installSkillsContent(props.skills, t)
  return (
    <section data-testid="env-skill-batch" style={ENV_SECTION_STYLE}>
      <div data-testid="env-skill-batch-title" style={ENV_TITLE_STYLE}>
        {t('env.skills.title')}
      </div>
      <div data-testid="env-skill-batch-detail" style={ENV_DETAIL_STYLE}>
        {t('env.skills.detail', {
          count: props.skills.length,
          skills: props.skills.join(t('common.listSeparator')),
        })}
      </div>
      <div data-testid="env-skill-batch-summary" style={ENV_DETAIL_STYLE}>
        {content.summary}
      </div>
      <SessionAction prompt={content.action.prompt} injection={props.injection} />
      <RemedyLink href={content.link.href} label={content.link.label} />
    </section>
  )
}
