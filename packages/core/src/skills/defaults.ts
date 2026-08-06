/**
 * 内置推荐 skill —— 首次使用时可一键安装
 */
export interface DefaultSkill {
  /** 安装源（传给 SkillInstaller.install） */
  source: string;
  /** 安装后的 skill 名（用于判断是否已装） */
  name: string;
  label: string;
  description: string;
}

export const DEFAULT_SKILLS: DefaultSkill[] = [
  {
    source: 'https://github.com/vercel-labs/skills/tree/main/skills/find-skills',
    name: 'find-skills',
    label: 'find-skills',
    description: '从开放的 Agent Skills 生态中发现并安装技能。当你问“怎么做 X”“有没有做 X 的技能”时会被触发。',
  },
];
