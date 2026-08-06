/**
 * 国际化（i18n）
 *
 * 同时服务于 CLI 与桌面端。默认语言为中文（zh）。
 * 用法：
 *   import { t, setLang, getLang, resolveLang } from '@codix/core';
 *   setLang('en');
 *   t('cli.toolsReady', { model: 'gpt-4o', count: 12 });
 *
 * 字典里缺失的 key 会回退到 zh，再回退到 key 本身，保证不会白屏。
 */
import type { Lang } from './types.js';

export type { Lang } from './types.js';

type Dict = Record<string, string>;
type Vars = Record<string, string | number>;

// ============================ 中文字典（默认） ============================
const zh: Dict = {
  // ---- CLI 通用 ----
  'cli.connecting': '连接中…',
  'cli.toolsReady': '${model} · ${count} 个工具就绪',
  'cli.needTTY': 'codix CLI 需要交互式终端。管道 / CI 场景请用 --help 查看非交互用法。',
  'cli.dirNotExist': '目录不存在：${cwd}',
  'cli.usageTitle': 'Usage',
  'cli.optionsTitle': 'Options',
  'cli.examplesTitle': 'Examples',
  'cli.flag.model': '模型 key（对应 config.models 中的 key）',
  'cli.flag.resume': '恢复会话 id',
  'cli.flag.list': '列出所有会话',
  'cli.flag.config': '初始化配置文件',
  'cli.flag.lang': '界面语言：zh（中文，默认）| en（English）',
  'cli.flag.help': '显示帮助',
  'cli.flag.version': '显示版本',

  // ---- 横幅 / 提示 ----
  'banner.hint': '输入 / 查看命令，· Ctrl+C 中断，/ /exit 退出',

  // ---- 会话 ----
  'session.notFound': '未找到会话 ${id}，已改为新建。',
  'session.newTitle': '新会话',
  'session.omitted': '（已省略更早的 ${n} 条消息）',
  'session.restored': '已恢复会话：${title}',
  'session.empty': '暂无历史会话。',
  'session.untitled': '(无标题)',
  'session.resumeTitle': '恢复会话',
  'session.currentDir': '当前目录：${dir}',
  'session.switched': '已切换到：${dir}',
  'session.cdFailed': '切换失败：${msg}',
  'session.created': '已新建会话：${title}（${id}）',
  'session.notFoundErr': '未找到会话：${id}',
  'session.notDir': '不是目录',

  // ---- 预览 / 队列 / 回合 ----
  'preview.moreLines': '上面还有 ${n} 行',
  'queue.count': '已排队 ${n} 条，稍后依次发送',
  'turn.aborted': '已中断。',
  'turn.tools': '${n} 次工具',

  // ---- 输入框提示 / 占位 ----
  'hint.confirm': '↑↓ 选择 · Enter 确认',
  'hint.overlay': '↑↓ 选择 · Tab 补全 · Enter 确认 · Esc 关闭',
  'hint.running': 'Esc 中断 · Enter 排队',
  'hint.multiline': '多行：Enter 换行 · Alt+Enter 发送',
  'hint.idle': '/ 命令',
  'hint.running.esc': 'Esc 中断',
  'placeholder.running': '输入下一条消息，回车排队…',
  'placeholder.idle': '问点什么，或输入 / 打开命令',

  // ---- 错误 / toast ----
  'error.ui': '界面异常：${msg}',
  'toast.aborting': '已请求中断…',
  'toast.ctrlCExit': '再按一次 Ctrl+C 退出',
  'bye': '再见。',
  'toast.multilineOn': '多行模式：Enter 换行',
  'toast.multilineOff': '单行模式：Enter 发送',

  // ---- 浮层 ----
  'overlay.commandsTitle': '命令',
  'overlay.commandsFooter': 'Tab 补全 · Enter 执行',
  'overlay.modelTitle': '选择模型',
  'overlay.filterHint': '直接输入可过滤',
  'overlay.noMatch': '（无匹配项）',
  'overlay.more': '还有 ${n} 项',

  // ---- 权限确认 ----
  'permission.title': '需要授权：${tool}',
  'permission.allow': '允许这一次',
  'permission.allowAll': '本会话内始终允许',
  'permission.deny': '拒绝',
  'permission.allowed': '已允许',
  'permission.allowedAll': '已允许（本会话内不再询问）',
  'permission.denied': '已拒绝',

  // ---- shell ----
  'shell.usage': '用法：!<shell 命令>',
  'shell.exitCode': '退出码 ${code}',

  // ---- 模型 ----
  'model.none': '还没有配置模型。在桌面端「设置 → 模型」里添加，或编辑 ~/.codix/config.json。',
  'model.switched': '已切换模型：${key}（${model}）',
  'model.notFound': '未找到模型：${key}',
  'model.matchCount': '匹配到 ${n} 个模型：',
  'model.notFoundArg': '未找到模型：${arg}（输入 /model 打开选择器）',

  // ---- MCP ----
  'mcp.none': 'MCP：未配置服务器（在桌面端「设置 → MCP」中添加）。',
  'mcp.listTitle': 'MCP 服务器：',
  'mcp.toolCount': '${n} 个工具',

  // ---- skill ----
  'skills.none': '尚未安装 skill。用 /install <url> 安装。',
  'skills.listTitle': '已安装 skill（${n}）：',
  'install.usage': '用法：/install <url|npm:pkg|git:repo|local:path>',
  'install.done': '已安装：${dest}',
  'install.failed': '安装失败：${msg}',

  // ---- 规则 / 配置 ----
  'rules.notFound': '未找到规则文件：${p}\n新建该文件即可添加全局规则。',
  'config.path': '全局配置：${p}',
  'config.exists': '配置已存在：${file}',
  'config.defaultModel': '默认模型：${defaultModel}',
  'config.models': '已配置模型：${models}',
  'config.created': '已创建配置：${file}',
  'config.apiKeyHint': '请填入 API Key 后重新运行 codix。',
  'config.notSet': '(未设置)',
  'config.none': '(无)',
  'cmd.unknown': '未知命令：/${cmd}（输入 /help 查看命令列表）',

  // ---- 状态栏 ----
  'status.dir': '目录',
  'status.session': '会话',
  'status.model': '模型',
  'status.tools': '工具',
  'status.mcp': 'MCP',
  'status.mcpConnected': '个已连接',
  'status.unit': '个',
  'session.listCount': '历史会话（${n}）：',
  'tools.listTitle': '可用工具（${n}）：',

  // ---- 帮助 ----
  'help.commands': '命令',
  'help.shortcuts': '快捷键',
  'help.send': '发送',
  'help.newline': '换行（Ctrl+J 同）',
  'help.multilineMode': '切换多行模式（此时 Enter 换行、Alt+Enter 发送）',
  'help.cmdPalette': '打开命令面板 · Tab 补全',
  'help.history': '浏览输入历史（多行时在行间移动）',
  'help.ctrlC': '中断任务 / 清空输入 / 连按两次退出',
  'help.ctrlD': '退出（输入为空时）',
  'help.ctrlL': '清屏',
  'help.ctrlW': '删除前一个词    Ctrl+U 删到行首    Ctrl+K 删到行尾',
  'help.esc': '关闭浮层 / 中断任务',
  'help.bang': '直接在 shell 里执行',

  // ---- 工具调用渲染 ----
  'thinking.label': '思考过程',
  'tool.failed': '失败',
  'tool.done': '完成',
  'tool.moreLines': '… 另有 ${n} 行',

  // ---- 斜杠命令描述 ----
  'cmd.help.desc': '显示所有命令与快捷键',
  'cmd.model.desc': '切换模型（不带参数打开选择器）',
  'cmd.new.desc': '开一个新会话',
  'cmd.resume.desc': '恢复历史会话（不带参数打开选择器）',
  'cmd.sessions.desc': '列出历史会话',
  'cmd.cd.desc': '切换工作目录',
  'cmd.tools.desc': '列出当前可用工具',
  'cmd.mcp.desc': '查看 MCP 服务器状态',
  'cmd.skills.desc': '列出已安装的 skill',
  'cmd.install.desc': '安装 skill',
  'cmd.rules.desc': '查看全局规则文件（~/.codix/rules.md）',
  'cmd.config.desc': '查看配置',
  'cmd.status.desc': '显示当前会话状态',
  'cmd.clear.desc': '清屏（不清空会话）',
  'cmd.exit.desc': '退出',

  // ---- 桌面端通用 ----
  'ui.error': '出错了：',
  'ui.modelSwitchFailed': '切换模型失败：',
  'ui.expandSidebar': '展开侧栏',
  'ui.collapseSidebar': '折叠侧栏',
  'ui.emptyMessage': '(空消息)',
  'ui.remove': '移除',
  'ui.copy': '复制',
  'ui.copied': '已复制 ✓',
  'ui.toolResult': '执行结果',
  'ui.toolFailed': '执行失败',
  'ui.thinking': '正在思考',
  'ui.imageAlt': '图片',
  'ui.fileTooLarge': '文件 ${name} 超过 20MB 限制',
  'ui.editHint': '编辑消息后发送，将覆盖此前的 AI 回复  ·  Enter 发送  ·  Esc 取消',
  'ui.noSessionHint': '输入消息，将自动创建新对话',
  'ui.busyHint': '输入消息，发送后将排队',
  'ui.composerHint': '输入消息或粘贴文件、图片  ·  Enter 发送  ·  Shift+Enter 换行',
  'ui.currentModel': '当前模型：${model}',
  'ui.settings': '设置',
  'ui.newSession': '新建会话 (Ctrl+N)',
  'ui.deleteX': '删除 ',
  'ui.cancel': '取消',
  'ui.confirmDelete': '确认删除？',

  // ---- 桌面端 配置/保存 类 ----
  'ui.loadFailed': '加载失败: ',
  'ui.saveFailed': '保存失败: ',
  'ui.saved': '已保存',
  'ui.saving': '保存中…',
  'ui.jsonParseFailed': 'JSON 解析失败: ',
  'ui.themeLight': '当前：浅色',
  'ui.themeDark': '当前：深色',
  'ui.showRawConfig': '展开原始配置 (JSON)',
  'ui.hideRawConfig': '收起原始配置',
  'ui.saveGlobal': '保存到全局',

  // ---- 桌面端 MCP ----
  'ui.mcp.jsonParseFailed': 'JSON 解析失败：',
  'ui.mcp.topMustObject': '顶层必须是一个 JSON 对象',
  'ui.mcp.missingName': '缺少必填字段 name（字符串）',
  'ui.mcp.badTransport': 'transport 必须是 stdio / sse / http，收到：${t}',
  'ui.mcp.stdioNeedsCommand': 'stdio 方式需要 command（字符串）',
  'ui.mcp.argsMustArray': 'args 必须是字符串数组',
  'ui.mcp.sseNeedsUrl': 'sse / http 方式需要 url（字符串）',
  'ui.mcp.envMustObject': 'env 必须是对象',
  'ui.mcp.headersMustObject': 'headers 必须是对象',
  'ui.mcp.testDone': '连接测试完成：${ok}/${total} 可用',
  'ui.mcp.connectFailed': '连接失败: ',
  'ui.mcp.dupName': '已存在同名服务器「${name}」',
  'ui.mcp.updated': '已更新 MCP 服务器',
  'ui.mcp.added': '已添加 MCP 服务器',
  'ui.mcp.deleted': '已删除 ',
  'ui.mcp.disabled': '已停用 ${name}',
  'ui.mcp.enabled': '已启用 ${name}',
  'ui.mcp.testing': '连接中…',
  'ui.mcp.testConnect': '测试连接',
  'ui.mcp.enable': '启用',
  'ui.mcp.disable': '停用',
  'ui.mcp.editTitle': '编辑 MCP 服务器',
  'ui.mcp.addTitle': '添加 MCP 服务器',
  'ui.mcp.save': '保存',
  'ui.mcp.add': '添加',

  // ---- 桌面端 模型设置 ----
  'ui.model.searchPlaceholder': '搜索模型或供应商…',
  'ui.providerDefault': '默认地址',
  'ui.hostLabelZhipu': '智谱 AI',
  'ui.modelHintOpenai': '/chat/completions —— OpenAI 官方、DeepSeek、智谱、Ollama 等，通常选它',
  'ui.providerAnthropicHint': 'Claude 系列',
  'ui.providerGeminiHint': 'Gemini 系列',
  'ui.modelUncategorized': '未归类模型',
  'ui.providerNotFound': '供应商不存在',
  'ui.modelNotFound': '模型不存在',
  'ui.noModelsReturned': '该供应商没有返回任何模型。',
  'ui.fetchModelsFailed': '获取模型失败: ',
  'ui.modelsAdded': '已添加 ${n} 个模型',
  'ui.modelsAddedNone': '没有新增模型（已存在）',
  'ui.setDefault': '已设为默认',
  'ui.modelSaved': '已保存模型',
  'ui.modelDeleted': '已删除模型',
  'ui.providerUpdated': '已更新供应商',
  'ui.providerAdded': '已添加供应商',
  'ui.providerDeletedModels': '已删除供应商，同时移除 ${n} 个模型',
  'ui.batchTestDone': '批量测试完成：${ok}/${total} 可用',
  'ui.batchDeleted': '已删除 ${n} 个模型',
  'ui.selectedCount': '已选 ${n} 个',
  'ui.selectAll': '全选',
  'ui.batchTesting': '测试中…',
  'ui.collapse': '折叠',
  'ui.expand': '展开',
  'ui.getAllModels': '一键获取全部模型',
  'ui.fetching': '获取中…',
  'ui.editProvider': '编辑供应商',
  'ui.addProvider': '添加供应商',
  'ui.providerLabelPlaceholder': '如 DeepSeek',
  'ui.modelPlaceholder': '如 gpt-oss-120b',
  'ui.inheritKey': '继承供应商的 Key',
  'ui.providerNoKey': '供应商也没有 Key',
  'ui.inheritBaseURL': '继承供应商地址',
  'ui.searchModels': '搜索模型…',

  // ---- 桌面端 规则 ----
  'ui.rulesPlaceholder': '# 我的规则\n\n- 回复使用中文\n- 修改代码前先读文件',

  // ---- 桌面端 权限弹窗 ----
  'ui.permissionDeny': '拒绝',
  'ui.permissionAllow': '允许',

  // ---- 桌面端 skill ----
  'ui.skillInstalled': '已安装到: ',
  'ui.skillInstallFailed': '安装失败: ',
  'ui.skillUninstalled': '已卸载 ',
  'ui.skillUninstallFailed': '卸载失败: ',
  'ui.skillInstalling': '安装中…',
  'ui.skillInstall': '安装',
  'ui.skillOneClick': '一键安装',

  // ---- 语言设置 ----
  'settings.language': '语言',
  'settings.language.zh': '中文',
  'settings.language.en': 'English',
  'settings.languageHint': '切换后界面文案立即生效，CLI 需重新启动。',

  // ---- 桌面端 设置导航 ----
  'nav.general': '通用',
  'nav.models': '模型',
  'nav.skills': '技能',
  'nav.mcp': 'MCP',
  'nav.rules': '规则',

  // ---- 桌面端 通用词 ----
  'ui.queueCount': '排队中 · ${n} 条',
  'ui.attachmentCount': '${n} 附件',
  'ui.loading': '加载中…',
  'ui.refresh': '刷新',
  'ui.reload': '重新加载',
  'ui.edit': '编辑',
  'ui.delete': '删除',
  'ui.confirm': '确认',
  'ui.save': '保存',
  'ui.add': '添加',
  'ui.close': '关闭',
  'ui.name': '名称',
  'ui.apiKey': 'API Key',
  'ui.baseURL': 'Base URL',

  // ---- 桌面端 聊天区 ----
  'chat.emptyTitle': '开始新对话',
  'chat.emptyDesc': '输入消息，或拖入图片 / 文件',
  'chat.download': '下载',
  'chat.thinkingProcess': '思考过程',
  'chat.contextSummary': '上下文摘要',
  'chat.regenerate': '重新回复',
  'chat.thinkingDots': '思考中…',

  // ---- 桌面端 输入区 ----
  'composer.editingBadge': '正在编辑一条消息',
  'composer.pasteImage': '粘贴或上传图片',
  'composer.pasteFile': '粘贴或上传文件',
  'composer.counter': '${chars} 字符 · ${files} 附件',
  'composer.send': '发送',

  // ---- 桌面端 MCP 页 ----
  'ui.mcp.title': 'MCP 服务器',
  'ui.mcp.desc': 'Model Context Protocol 扩展工具。配置写入全局 ',
  'ui.mcp.emptyHint': '尚未配置 MCP 服务器。点击「添加」，例如：',
  'ui.mcp.tagDisabled': '已停用',
  'ui.mcp.connectedTools': '已连接 · ${n} 工具',
  'ui.mcp.tagConnFailed': '连接失败',
  'ui.mcp.andMore': '等 ${n} 个',
  'ui.mcp.dialogHint': '直接在下面的代码块中编辑该 MCP 服务器的 JSON（可整段粘贴）：',
  'ui.mcp.format': '格式化',

  // ---- 桌面端 模型选择弹窗 ----
  'model.pickerTitle': '切换模型',
  'model.pickerHint': '↑↓ 选择 · Enter 确认 · Esc 关闭',
  'model.pickerEmpty': '暂无可用模型，请到「设置 → 模型」添加供应商。',
  'model.pickerNoMatch': '没有匹配「${q}」的模型',
  'model.currentTag': '当前',

  // ---- 桌面端 模型设置页 ----
  'ui.modelsTitle': '模型',
  'ui.modelsDesc': '按供应商管理模型。一个供应商可以挂多个模型。',
  'ui.addProviderBtn': '+ 添加供应商',
  'ui.batchTest': '批量测试连接',
  'ui.batchDelete': '批量删除',
  'ui.batchDeleteConfirm': '删除 ${n} 个模型？',
  'ui.providersEmpty': '还没有供应商。点击右上角「添加供应商」开始，例如 DeepSeek、OpenAI、本地 Ollama。',
  'ui.modelCount': '${n} 个模型',
  'ui.tagNoKey': '未设置 Key',
  'ui.getAllModelsTip': '调用该供应商的 /models 接口，把返回的模型全部加进来',
  'ui.pickModels': '选择性获取',
  'ui.manualAdd': '手动添加',
  'ui.delProviderConfirm': '连同 ${n} 个模型一起删除？',
  'ui.uncategorizedHint': '这些模型没有关联供应商（老配置）',
  'ui.modelsEmpty': '还没有模型。',
  'ui.tagDefault': '默认',
  'ui.tagOwnKey': '独立 Key',
  'ui.tagTesting': '测试中…',
  'ui.tagOk': '可用 · ${ms}ms',
  'ui.tagFail': '失败 · ${msg}',
  'ui.setDefaultBtn': '设为默认',
  'ui.testLink': '测试链接',
  'ui.deleteModel': '删除模型',
  'ui.protocolType': '协议类型',
  'ui.providerIdPreview': '供应商 id：',
  'ui.providerIdSuffix': '（模型 key 会以此为前缀）',
  'ui.editModelTitle': '编辑模型',
  'ui.modelNameLabel': '模型名称',
  'ui.ownKeyLabel': '独立 API Key（留空则继承供应商）',
  'ui.ownBaseURLLabel': '独立 Base URL（留空则继承供应商）',
  'ui.modelKeyLabel': '模型 key：',
  'ui.discoverTitle': '选择要添加的模型',
  'ui.discoverLoading': '正在从供应商拉取模型列表…',
  'ui.selectAllToggle': '全选/取消',
  'ui.discoverCount': '${total} 个 · 已选 ${picked}',
  'ui.tagAdded': '已添加',
  'ui.addSelected': '添加选中（${n}）',
  'ui.manualTitle': '手动添加模型',
  'ui.manualHint': '用英文逗号分隔多个模型 ID，也可以换行。',
  'ui.manualPreview': '将添加 ${n} 个：${list}',

  // ---- 桌面端 权限弹窗 ----
  'ui.permissionTitle': '权限请求',

  // ---- 桌面端 规则页 ----
  'ui.rulesTitle': '规则',
  'ui.rulesDesc': '全局规则，对所有项目生效。会注入到 system prompt 影响 Agent 行为，Markdown 格式。',

  // ---- 桌面端 通用设置页 ----
  'ui.appearance': '外观',
  'ui.themeMode': '主题模式',
  'ui.themeLightBtn': '浅色',
  'ui.themeDarkBtn': '深色',
  'ui.advanced': '高级',
  'ui.mergedWarn': '当前展示的是',
  'ui.mergedWarnStrong': '合并后的配置',
  'ui.mergedWarnTail': '（全局 + 项目级覆盖），直接保存会污染全局配置。点击「编辑全局」加载可编辑的全局配置。',
  'ui.editGlobal': '编辑全局',
  'ui.viewMerged': '查看合并',

  // ---- 桌面端 侧栏 ----
  'ui.confirmDeleteTip': '确认删除',

  // ---- 桌面端 技能页 ----
  'ui.skillsTitle': '技能',
  'ui.skillsDescPre': '技能是带 ',
  'ui.skillsDescMid': ' 或 ',
  'ui.skillsDescPost': ' 的目录，会扩展 Agent 的能力。',
  'ui.skillRecommended': '推荐',
  'ui.skillTagInstalled': '已安装',
  'ui.skillAlreadyListed': '已在下方列表中',
  'ui.skillInstalledCount': '已安装（${n}）',
  'ui.skillsEmpty': '尚未安装任何 skill。可以从上方推荐一键安装，或在下面填写来源。',
  'ui.skillTagDisabled': '已停用',
  'ui.skillOpenDir': '打开目录',
  'ui.skillUninstall': '卸载',
  'ui.skillConfirmDelDir': '删除该目录？',
  'ui.skillFromSource': '从来源安装',
  'ui.skillSourceHintPre': '支持 skills.sh / GitHub 链接、',
  'ui.skillSourceHintPost': '。',
};

// ============================ 英文字典 ============================
const en: Dict = {
  'cli.connecting': 'Connecting…',
  'cli.toolsReady': '${model} · ${count} tools ready',
  'cli.needTTY': 'codix CLI needs an interactive terminal. For pipes/CI, see --help for non-interactive usage.',
  'cli.dirNotExist': 'Directory does not exist: ${cwd}',
  'cli.usageTitle': 'Usage',
  'cli.optionsTitle': 'Options',
  'cli.examplesTitle': 'Examples',
  'cli.flag.model': 'model key (from config.models)',
  'cli.flag.resume': 'resume session id',
  'cli.flag.list': 'list all sessions',
  'cli.flag.config': 'initialize config file',
  'cli.flag.lang': 'UI language: zh (Chinese, default) | en',
  'cli.flag.help': 'show help',
  'cli.flag.version': 'show version',

  'banner.hint': "Type / for commands · Ctrl+C to abort · /exit to quit",

  'session.notFound': 'Session ${id} not found, started a new one.',
  'session.newTitle': 'New session',
  'session.omitted': '(omitted ${n} earlier messages)',
  'session.restored': 'Restored session: ${title}',
  'session.empty': 'No history sessions yet.',
  'session.untitled': '(untitled)',
  'session.resumeTitle': 'Resume session',
  'session.currentDir': 'Current directory: ${dir}',
  'session.switched': 'Switched to: ${dir}',
  'session.cdFailed': 'Switch failed: ${msg}',
  'session.created': 'Created session: ${title} (${id})',
  'session.notFoundErr': 'Session not found: ${id}',
  'session.notDir': 'Not a directory',

  'preview.moreLines': '${n} more lines above',
  'queue.count': '${n} queued, will send in order',
  'turn.aborted': 'Aborted.',
  'turn.tools': '${n} tool calls',

  'hint.confirm': '↑↓ select · Enter confirm',
  'hint.overlay': '↑↓ select · Tab complete · Enter confirm · Esc close',
  'hint.running': 'Esc abort · Enter queue',
  'hint.multiline': 'Multiline: Enter newline · Alt+Enter send',
  'hint.idle': '/ command',
  'hint.running.esc': 'Esc abort',
  'placeholder.running': 'Type next message, Enter to queue…',
  'placeholder.idle': 'Ask something, or type / for commands',

  'error.ui': 'UI error: ${msg}',
  'toast.aborting': 'Abort requested…',
  'toast.ctrlCExit': 'Press Ctrl+C again to exit',
  'bye': 'Goodbye.',
  'toast.multilineOn': 'Multiline mode: Enter newline',
  'toast.multilineOff': 'Single-line mode: Enter send',

  'overlay.commandsTitle': 'Commands',
  'overlay.commandsFooter': 'Tab complete · Enter run',
  'overlay.modelTitle': 'Select model',
  'overlay.filterHint': 'Type to filter',
  'overlay.noMatch': '(no matches)',
  'overlay.more': '${n} more items',

  'permission.title': 'Permission required: ${tool}',
  'permission.allow': 'Allow this time',
  'permission.allowAll': 'Always allow in this session',
  'permission.deny': 'Deny',
  'permission.allowed': 'Allowed',
  'permission.allowedAll': "Allowed (won't ask again this session)",
  'permission.denied': 'Denied',

  'shell.usage': 'Usage: !<shell command>',
  'shell.exitCode': 'Exit code ${code}',

  'model.none': 'No models configured yet. Add one in desktop "Settings → Models", or edit ~/.codix/config.json.',
  'model.switched': 'Switched model: ${key} (${model})',
  'model.notFound': 'Model not found: ${key}',
  'model.matchCount': 'Matched ${n} models:',
  'model.notFoundArg': 'Model not found: ${arg} (type /model to open picker)',

  'mcp.none': 'MCP: no servers configured (add in desktop "Settings → MCP").',
  'mcp.listTitle': 'MCP servers:',
  'mcp.toolCount': '${n} tools',

  'skills.none': 'No skills installed yet. Use /install <url> to install.',
  'skills.listTitle': 'Installed skills (${n}):',
  'install.usage': 'Usage: /install <url|npm:pkg|git:repo|local:path>',
  'install.done': 'Installed: ${dest}',
  'install.failed': 'Install failed: ${msg}',

  'rules.notFound': 'Rules file not found: ${p}\nCreate it to add global rules.',
  'config.path': 'Global config: ${p}',
  'config.exists': 'Config exists: ${file}',
  'config.defaultModel': 'Default model: ${defaultModel}',
  'config.models': 'Configured models: ${models}',
  'config.created': 'Created config: ${file}',
  'config.apiKeyHint': 'Please add your API Key then run codix again.',
  'config.notSet': '(not set)',
  'config.none': '(none)',
  'cmd.unknown': 'Unknown command: /${cmd} (type /help for the list)',

  'status.dir': 'Dir',
  'status.session': 'Session',
  'status.model': 'Model',
  'status.tools': 'Tools',
  'status.mcp': 'MCP',
  'status.mcpConnected': 'connected',
  'status.unit': '',
  'session.listCount': 'History (${n}):',
  'tools.listTitle': 'Available tools (${n}):',

  'help.commands': 'Commands',
  'help.shortcuts': 'Shortcuts',
  'help.send': 'Send',
  'help.newline': 'Newline (Ctrl+J)',
  'help.multilineMode': 'Toggle multiline mode (Enter newline, Alt+Enter send)',
  'help.cmdPalette': 'Open command palette · Tab complete',
  'help.history': 'Browse input history (multiline: move between lines)',
  'help.ctrlC': 'Abort / clear input / double-press to quit',
  'help.ctrlD': 'Quit (when input empty)',
  'help.ctrlL': 'Clear screen',
  'help.ctrlW': 'Delete word   Ctrl+U to line start   Ctrl+K to line end',
  'help.esc': 'Close overlay / abort task',
  'help.bang': 'Run directly in shell',

  'thinking.label': 'Thinking',
  'tool.failed': 'Failed',
  'tool.done': 'Done',
  'tool.moreLines': '… ${n} more lines',

  'cmd.help.desc': 'Show all commands and shortcuts',
  'cmd.model.desc': 'Switch model (open picker without args)',
  'cmd.new.desc': 'Start a new session',
  'cmd.resume.desc': 'Resume a session (open picker without args)',
  'cmd.sessions.desc': 'List history sessions',
  'cmd.cd.desc': 'Change working directory',
  'cmd.tools.desc': 'List available tools',
  'cmd.mcp.desc': 'Show MCP server status',
  'cmd.skills.desc': 'List installed skills',
  'cmd.install.desc': 'Install a skill',
  'cmd.rules.desc': 'Show global rules file (~/.codix/rules.md)',
  'cmd.config.desc': 'Show config',
  'cmd.status.desc': 'Show current session status',
  'cmd.clear.desc': 'Clear screen (keep session)',
  'cmd.exit.desc': 'Quit',

  'ui.error': 'Error: ',
  'ui.modelSwitchFailed': 'Failed to switch model: ',
  'ui.expandSidebar': 'Expand sidebar',
  'ui.collapseSidebar': 'Collapse sidebar',
  'ui.emptyMessage': '(empty message)',
  'ui.remove': 'Remove',
  'ui.copy': 'Copy',
  'ui.copied': 'Copied ✓',
  'ui.toolResult': 'Result',
  'ui.toolFailed': 'Failed',
  'ui.thinking': 'Thinking',
  'ui.imageAlt': 'image',
  'ui.fileTooLarge': 'File ${name} exceeds 20MB limit',
  'ui.editHint': 'Editing will overwrite the previous AI reply  ·  Enter send  ·  Esc cancel',
  'ui.noSessionHint': 'Type a message to start a new chat',
  'ui.busyHint': 'Type a message; it will be queued',
  'ui.composerHint': 'Type or paste files/images  ·  Enter send  ·  Shift+Enter newline',
  'ui.currentModel': 'Current model: ${model}',
  'ui.settings': 'Settings',
  'ui.newSession': 'New session (Ctrl+N)',
  'ui.deleteX': 'Delete ',
  'ui.cancel': 'Cancel',
  'ui.confirmDelete': 'Delete it?',

  'ui.loadFailed': 'Load failed: ',
  'ui.saveFailed': 'Save failed: ',
  'ui.saved': 'Saved',
  'ui.saving': 'Saving…',
  'ui.jsonParseFailed': 'JSON parse failed: ',
  'ui.themeLight': 'Current: Light',
  'ui.themeDark': 'Current: Dark',
  'ui.showRawConfig': 'Expand raw config (JSON)',
  'ui.hideRawConfig': 'Collapse raw config',
  'ui.saveGlobal': 'Save to global',

  'ui.mcp.jsonParseFailed': 'JSON parse failed: ',
  'ui.mcp.topMustObject': 'Top level must be a JSON object',
  'ui.mcp.missingName': 'Missing required field name (string)',
  'ui.mcp.badTransport': 'transport must be stdio / sse / http, got: ${t}',
  'ui.mcp.stdioNeedsCommand': 'stdio requires command (string)',
  'ui.mcp.argsMustArray': 'args must be a string array',
  'ui.mcp.sseNeedsUrl': 'sse / http require url (string)',
  'ui.mcp.envMustObject': 'env must be an object',
  'ui.mcp.headersMustObject': 'headers must be an object',
  'ui.mcp.testDone': 'Connection test done: ${ok}/${total} available',
  'ui.mcp.connectFailed': 'Connection failed: ',
  'ui.mcp.dupName': 'A server named "${name}" already exists',
  'ui.mcp.updated': 'MCP server updated',
  'ui.mcp.added': 'MCP server added',
  'ui.mcp.deleted': 'Deleted ',
  'ui.mcp.disabled': 'Disabled ${name}',
  'ui.mcp.enabled': 'Enabled ${name}',
  'ui.mcp.testing': 'Connecting…',
  'ui.mcp.testConnect': 'Test connection',
  'ui.mcp.enable': 'Enable',
  'ui.mcp.disable': 'Disable',
  'ui.mcp.editTitle': 'Edit MCP server',
  'ui.mcp.addTitle': 'Add MCP server',
  'ui.mcp.save': 'Save',
  'ui.mcp.add': 'Add',

  'ui.model.searchPlaceholder': 'Search models or providers…',
  'ui.providerDefault': 'Default address',
  'ui.hostLabelZhipu': 'Zhipu AI',
  'ui.modelHintOpenai': '/chat/completions — OpenAI, DeepSeek, Zhipu, Ollama, etc. Usually this one',
  'ui.providerAnthropicHint': 'Claude series',
  'ui.providerGeminiHint': 'Gemini series',
  'ui.modelUncategorized': 'Uncategorized',
  'ui.providerNotFound': 'Provider not found',
  'ui.modelNotFound': 'Model not found',
  'ui.noModelsReturned': 'This provider returned no models.',
  'ui.fetchModelsFailed': 'Failed to fetch models: ',
  'ui.modelsAdded': 'Added ${n} models',
  'ui.modelsAddedNone': 'No new models (already exist)',
  'ui.setDefault': 'Set as default',
  'ui.modelSaved': 'Model saved',
  'ui.modelDeleted': 'Model deleted',
  'ui.providerUpdated': 'Provider updated',
  'ui.providerAdded': 'Provider added',
  'ui.providerDeletedModels': 'Provider deleted, ${n} models removed',
  'ui.batchTestDone': 'Batch test done: ${ok}/${total} available',
  'ui.batchDeleted': 'Deleted ${n} models',
  'ui.selectedCount': '${n} selected',
  'ui.selectAll': 'Select all',
  'ui.batchTesting': 'Testing…',
  'ui.collapse': 'Collapse',
  'ui.expand': 'Expand',
  'ui.getAllModels': 'Fetch all models',
  'ui.fetching': 'Fetching…',
  'ui.editProvider': 'Edit provider',
  'ui.addProvider': 'Add provider',
  'ui.providerLabelPlaceholder': 'e.g. DeepSeek',
  'ui.modelPlaceholder': 'e.g. gpt-oss-120b',
  'ui.inheritKey': "Inherit provider's Key",
  'ui.providerNoKey': 'Provider has no Key either',
  'ui.inheritBaseURL': "Inherit provider's address",
  'ui.searchModels': 'Search models…',

  'ui.rulesPlaceholder': '# My rules\n\n- Reply in Chinese\n- Read files before editing code',

  'ui.permissionDeny': 'Deny',
  'ui.permissionAllow': 'Allow',

  'ui.skillInstalled': 'Installed to: ',
  'ui.skillInstallFailed': 'Install failed: ',
  'ui.skillUninstalled': 'Uninstalled ',
  'ui.skillUninstallFailed': 'Uninstall failed: ',
  'ui.skillInstalling': 'Installing…',
  'ui.skillInstall': 'Install',
  'ui.skillOneClick': 'One-click install',

  'settings.language': 'Language',
  'settings.language.zh': '中文',
  'settings.language.en': 'English',
  'settings.languageHint': 'The UI updates immediately; restart the CLI for it to take effect there.',

  'nav.general': 'General',
  'nav.models': 'Models',
  'nav.skills': 'Skills',
  'nav.mcp': 'MCP',
  'nav.rules': 'Rules',

  'ui.queueCount': 'Queued · ${n}',
  'ui.attachmentCount': '${n} attachment(s)',
  'ui.loading': 'Loading…',
  'ui.refresh': 'Refresh',
  'ui.reload': 'Reload',
  'ui.edit': 'Edit',
  'ui.delete': 'Delete',
  'ui.confirm': 'Confirm',
  'ui.save': 'Save',
  'ui.add': 'Add',
  'ui.close': 'Close',
  'ui.name': 'Name',
  'ui.apiKey': 'API Key',
  'ui.baseURL': 'Base URL',

  'chat.emptyTitle': 'Start a new chat',
  'chat.emptyDesc': 'Type a message, or drop in images / files',
  'chat.download': 'Download',
  'chat.thinkingProcess': 'Thinking',
  'chat.contextSummary': 'Context summary',
  'chat.regenerate': 'Regenerate',
  'chat.thinkingDots': 'Thinking…',

  'composer.editingBadge': 'Editing a message',
  'composer.pasteImage': 'Paste or upload an image',
  'composer.pasteFile': 'Paste or upload a file',
  'composer.counter': '${chars} chars · ${files} attachment(s)',
  'composer.send': 'Send',

  'ui.mcp.title': 'MCP servers',
  'ui.mcp.desc': 'Model Context Protocol tools. Config is written to the global ',
  'ui.mcp.emptyHint': 'No MCP server configured yet. Click "Add", for example:',
  'ui.mcp.tagDisabled': 'Disabled',
  'ui.mcp.connectedTools': 'Connected · ${n} tools',
  'ui.mcp.tagConnFailed': 'Connection failed',
  'ui.mcp.andMore': 'and ${n} more',
  'ui.mcp.dialogHint': 'Edit this MCP server as JSON below (you can paste the whole block):',
  'ui.mcp.format': 'Format',

  'model.pickerTitle': 'Switch model',
  'model.pickerHint': '↑↓ select · Enter confirm · Esc close',
  'model.pickerEmpty': 'No models available. Add a provider under Settings → Models.',
  'model.pickerNoMatch': 'No model matches "${q}"',
  'model.currentTag': 'Current',

  'ui.modelsTitle': 'Models',
  'ui.modelsDesc': 'Manage models by provider. A provider can host multiple models.',
  'ui.addProviderBtn': '+ Add provider',
  'ui.batchTest': 'Test selected',
  'ui.batchDelete': 'Delete selected',
  'ui.batchDeleteConfirm': 'Delete ${n} model(s)?',
  'ui.providersEmpty': 'No provider yet. Click "Add provider" in the top-right to start — e.g. DeepSeek, OpenAI, or a local Ollama.',
  'ui.modelCount': '${n} model(s)',
  'ui.tagNoKey': 'No API key',
  'ui.getAllModelsTip': "Call this provider's /models endpoint and add everything it returns",
  'ui.pickModels': 'Pick models',
  'ui.manualAdd': 'Add manually',
  'ui.delProviderConfirm': 'Delete along with ${n} model(s)?',
  'ui.uncategorizedHint': 'These models have no provider (legacy config)',
  'ui.modelsEmpty': 'No model yet.',
  'ui.tagDefault': 'Default',
  'ui.tagOwnKey': 'Own key',
  'ui.tagTesting': 'Testing…',
  'ui.tagOk': 'OK · ${ms}ms',
  'ui.tagFail': 'Failed · ${msg}',
  'ui.setDefaultBtn': 'Set default',
  'ui.testLink': 'Test',
  'ui.deleteModel': 'Delete model',
  'ui.protocolType': 'Protocol',
  'ui.providerIdPreview': 'Provider id: ',
  'ui.providerIdSuffix': ' (model keys are prefixed with it)',
  'ui.editModelTitle': 'Edit model',
  'ui.modelNameLabel': 'Model name',
  'ui.ownKeyLabel': 'Own API key (leave blank to inherit from provider)',
  'ui.ownBaseURLLabel': 'Own base URL (leave blank to inherit from provider)',
  'ui.modelKeyLabel': 'Model key: ',
  'ui.discoverTitle': 'Pick models to add',
  'ui.discoverLoading': 'Fetching the model list from the provider…',
  'ui.selectAllToggle': 'Select all / none',
  'ui.discoverCount': '${total} total · ${picked} selected',
  'ui.tagAdded': 'Added',
  'ui.addSelected': 'Add selected (${n})',
  'ui.manualTitle': 'Add models manually',
  'ui.manualHint': 'Separate multiple model IDs with commas or newlines.',
  'ui.manualPreview': 'Will add ${n}: ${list}',

  'ui.permissionTitle': 'Permission request',

  'ui.rulesTitle': 'Rules',
  'ui.rulesDesc': 'Global rules apply to every project. They are injected into the system prompt to steer the agent. Markdown.',

  'ui.appearance': 'Appearance',
  'ui.themeMode': 'Theme',
  'ui.themeLightBtn': 'Light',
  'ui.themeDarkBtn': 'Dark',
  'ui.advanced': 'Advanced',
  'ui.mergedWarn': 'You are viewing the ',
  'ui.mergedWarnStrong': 'merged config',
  'ui.mergedWarnTail': ' (global + project overrides). Saving directly would pollute the global config. Click "Edit global" to load the editable global config.',
  'ui.editGlobal': 'Edit global',
  'ui.viewMerged': 'View merged',

  'ui.confirmDeleteTip': 'Confirm delete',

  'ui.skillsTitle': 'Skills',
  'ui.skillsDescPre': 'A skill is a directory containing ',
  'ui.skillsDescMid': ' or ',
  'ui.skillsDescPost': ' that extends what the agent can do.',
  'ui.skillRecommended': 'Recommended',
  'ui.skillTagInstalled': 'Installed',
  'ui.skillAlreadyListed': 'Already in the list below',
  'ui.skillInstalledCount': 'Installed (${n})',
  'ui.skillsEmpty': 'No skill installed yet. Install one from the recommendations above, or enter a source below.',
  'ui.skillTagDisabled': 'Disabled',
  'ui.skillOpenDir': 'Open folder',
  'ui.skillUninstall': 'Uninstall',
  'ui.skillConfirmDelDir': 'Delete this folder?',
  'ui.skillFromSource': 'Install from source',
  'ui.skillSourceHintPre': 'Supports skills.sh / GitHub links, ',
  'ui.skillSourceHintPost': '.',
};

const dicts: Record<Lang, Dict> = { zh, en };

let currentLang: Lang = 'zh';

/** 设置当前语言。任何非 'en' 的值都视为中文（默认）。 */
export function setLang(lang: Lang | string | null | undefined): void {
  currentLang = lang === 'en' ? 'en' : 'zh';
}

/** 读取当前语言。 */
export function getLang(): Lang {
  return currentLang;
}

/**
 * 翻译。支持 {var} 插值。
 * 缺失 key 回退：当前语言 → 中文 → key 本身。
 */
export function t(key: string, vars?: Vars): string {
  const table = dicts[currentLang] ?? dicts.zh;
  const s: string = table[key] ?? dicts.zh[key] ?? key;
  if (!vars) return s;
  // 同时支持 ${name} 与 {name} 两种占位符写法；未提供的变量原样保留。
  return s.replace(/\$?\{(\w+)\}/g, (m, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : m,
  );
}

/**
 * 语言解析优先级：flag > env > config > 默认(zh)。
 */
export function resolveLang(opts: { flag?: string; env?: string; config?: Lang | string } = {}): Lang {
  const { flag, env, config } = opts;
  if (String(flag ?? '').toLowerCase() === 'en') return 'en';
  // LANG 等环境变量常带区域后缀（如 en_US.UTF-8），按前缀判断
  if (env && String(env).toLowerCase().startsWith('en')) return 'en';
  if (String(config ?? '').toLowerCase() === 'en') return 'en';
  return 'zh';
}

// ============================ 转圈动词（随语言切换） ============================
const VERBS_ZH = [
  '思考中', '琢磨中', '推演中', '拆解中', '构思中', '梳理中',
  '盘算中', '演算中', '编排中', '权衡中', '勘察中', '打磨中',
  '推敲中', '归纳中', '串联中', '校准中', '沉淀中', '连线中',
  '组装中', '编织中', '解码中', '铺路中', '掂量中', '雕琢中',
];
const VERBS_EN = [
  'Thinking', 'Reasoning', 'Analyzing', 'Breaking down', 'Drafting', 'Organizing',
  'Weighing', 'Computing', 'Composing', 'Balancing', 'Scanning', 'Polishing',
  'Refining', 'Summarizing', 'Connecting', 'Calibrating', 'Settling', 'Linking',
  'Assembling', 'Weaving', 'Decoding', 'Paving', 'Estimating', 'Shaping',
];

/** 取一个随机「思考中」动词，按当前语言返回。 */
export function thinkingVerb(): string {
  const arr = currentLang === 'en' ? VERBS_EN : VERBS_ZH;
  return arr[Math.floor(Math.random() * arr.length)];
}
