/**
 * 权限引擎
 *
 * voked 始终运行在全自动模式：除显式 deny 规则外，所有工具调用一律放行，
 * 不再有「询问用户」的环节。决策顺序：
 *   1. 全局 deny 规则（始终拒绝）
 *   2. 当前 session 的临时规则（in-memory）
 *   3. 全局 allow / allowAll 规则
 *   4. 其余一律 allow
 */
import type { GlobalConfig } from '../types/config.js';
import type { PermissionAskRequest, PermissionDecision, PermissionRule } from '../types/permission.js';
import type { ToolContext } from '../types/tool.js';
import { PermissionError } from '../errors.js';

export interface PermissionDecisionResult {
  decision: PermissionDecision;
  rule?: PermissionRule;
  reason: string;
}

export class PermissionEngine {
  /** session 级的临时规则：scope=session，不写回 config */
  private sessionRules = new Map<string, PermissionRule[]>();

  constructor(private cfg: GlobalConfig) {}

  /** 重新加载配置 */
  reload(cfg: GlobalConfig): void {
    this.cfg = cfg;
  }

  /** 给指定 session 增加一条临时规则（生命周期与 session 绑定） */
  addSessionRule(sessionId: string, rule: PermissionRule): void {
    const arr = this.sessionRules.get(sessionId) ?? [];
    arr.push(rule);
    this.sessionRules.set(sessionId, arr);
  }

  /** 清理一个 session 的临时规则 */
  clearSession(sessionId: string): void {
    this.sessionRules.delete(sessionId);
  }

  async evaluate(
    tool: string,
    input: Record<string, unknown>,
    ctx: ToolContext
  ): Promise<PermissionDecisionResult> {
    const rules = this.cfg.permissionRules ?? [];
    const sessionRules = this.sessionRules.get(ctx.sessionId) ?? [];

    // 1. 全局 deny
    const denyRule = rules.find((r) => r.tool === tool && r.decision === 'deny' && matchesMatcher(r, input));
    if (denyRule) return { decision: 'deny', rule: denyRule, reason: `Rule: ${denyRule.description ?? 'deny'}` };

    // 2. session 级临时规则（最高优先级，允许用户在本会话"放行一类"）
    const sessionMatch = sessionRules.find((r) => r.tool === tool && matchesMatcher(r, input));
    if (sessionMatch) {
      if (sessionMatch.decision === 'allow' || sessionMatch.decision === 'allowAll') {
        return { decision: 'allow', rule: sessionMatch, reason: sessionMatch.description ?? 'session allow' };
      }
      if (sessionMatch.decision === 'deny') {
        return { decision: 'deny', rule: sessionMatch, reason: sessionMatch.description ?? 'session deny' };
      }
    }

    // 3. 全局 allow / allowAll 规则
    const matched = rules.find(
      (r) => r.tool === tool && r.decision !== 'deny' && matchesMatcher(r, input)
    );
    if (matched && (matched.decision === 'allow' || matched.decision === 'allowAll')) {
      return { decision: 'allow', rule: matched, reason: matched.description ?? '' };
    }

    // 4. 全自动：其余一律放行
    return { decision: 'allow', reason: 'auto mode (always allow)' };
  }

  /**
   * 询问用户；返回最终决策。
   * - 若 ctx.ask 存在：调用它
   * - 否则：抛出 PermissionError
   */
  async ensureAllowed(
    tool: string,
    input: Record<string, unknown>,
    ctx: ToolContext,
    describe: (input: Record<string, unknown>) => string
  ): Promise<PermissionDecisionResult> {
    const evalResult = await this.evaluate(tool, input, ctx);
    if (evalResult.decision === 'allow') return evalResult;
    if (evalResult.decision === 'deny') throw new PermissionError(`Denied: ${evalResult.reason}`);

    // ask
    if (!ctx.ask) throw new PermissionError(`Permission required but no ask handler (tool=${tool})`);
    const req: PermissionAskRequest = {
      tool,
      input,
      description: describe(input),
      options: {
        allow: '允许这一次',
        deny: '拒绝',
        allowAll: undefined,
      },
    };
    const userDecision = await ctx.ask(req.description, req.options);
    if (userDecision === 'allow') return { decision: 'allow', reason: 'user allow once' };
    if (userDecision === 'allowAll' && req.options.allowAll) {
      // 写 session 级规则，不污染共享 config
      this.addSessionRule(ctx.sessionId, { tool, decision: 'allowAll', description: 'user allowAll (session)' });
      return { decision: 'allow', reason: 'user allowAll (session)' };
    }
    throw new PermissionError('Denied by user');
  }
}

function matchesMatcher(rule: PermissionRule, input: Record<string, unknown>): boolean {
  if (!rule.matcher) return true;
  // 仅支持 input.xxx 形式；其他格式视为不匹配，避免误伤
  const m = rule.matcher.match(/^input\.([\w$.[\]]+)$/);
  if (!m) return false;
  const path = m[1].replace(/\[(\d+)\]/g, '.$1').split('.');
  let cur: unknown = input;
  for (const seg of path) {
    if (cur == null) return false;
    cur = (cur as Record<string, unknown>)[seg];
  }
  // 必须有实际值才算匹配（防 undefined 误匹配）
  return cur !== undefined;
}