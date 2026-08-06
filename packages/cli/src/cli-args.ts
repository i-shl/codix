/**
 * CLI 参数解析
 */
import meow from 'meow';
import { t, setLang, resolveLang } from '../../core/dist/index.js';

/**
 * 在进入主流程前，依据 `--lang`/`-L` 与环境变量同步确定语言，
 * 这样 `meow` 在构造时（--help 会立即打印并退出）就能用到正确的界面语言。
 * 配置文件的 ui.language 由 index.ts 的 applyLanguage 在更晚的阶段再叠加。
 */
function resolveEarlyLang(): void {
  const argv = process.argv.slice(2);
  let flag: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if ((a === '--lang' || a === '-L') && argv[i + 1]) { flag = argv[i + 1]; break; }
    if (a.startsWith('--lang=')) { flag = a.slice('--lang='.length); break; }
    if (a.startsWith('-L') && a.length > 2) { flag = a.slice(2); break; }
  }
  const env = process.env.CODIX_LANG || process.env.LANG || '';
  setLang(resolveLang({ flag, env }));
}
resolveEarlyLang();

const usage = `
${t('cli.usageTitle')}
  $ codix [cwd] [options]

${t('cli.optionsTitle')}
  --model, -m       ${t('cli.flag.model')}
  --resume, -r      ${t('cli.flag.resume')}
  --list, -l        ${t('cli.flag.list')}
  --config, -c      ${t('cli.flag.config')}
  --lang, -L        ${t('cli.flag.lang')}
  --help, -h        ${t('cli.flag.help')}
  --version, -v     ${t('cli.flag.version')}

${t('cli.examplesTitle')}
  $ codix
  $ codix ./my-project
  $ codix --lang en
  $ codix --model claude
  $ codix -r <sessionId>
  $ codix --list
`;

export const cli = meow(usage, {
  importMeta: import.meta,
  flags: {
    model: { type: 'string', shortFlag: 'm' },
    resume: { type: 'string', shortFlag: 'r' },
    list: { type: 'boolean', shortFlag: 'l', default: false },
    config: { type: 'boolean', shortFlag: 'c', default: false },
    lang: { type: 'string', shortFlag: 'L' },
  },
});
