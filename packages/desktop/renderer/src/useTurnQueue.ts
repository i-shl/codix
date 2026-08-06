/**
 * 对话轮次队列。
 *
 * 规则：AI 正在回复时用户继续发消息，这些消息进队列；上一轮**彻底结束**后
 * 才发出下一条，一条一条来，绝不并发。
 *
 * 为什么不用 `busy` 做锁：busy 是给 UI 用的响应式状态，在两轮之间会短暂变 false，
 * 若以它为准，恰好落在这个空窗期的第二次 send 会直接开跑，于是「三条排队消息一起飞出去」。
 * 所以这里用一个独立的、非响应式的 draining 布尔量做串行锁。
 */
import { ref, toRaw, type Ref } from 'vue';

export interface TurnQueueOptions<T> {
  /** 执行一轮对话；必须在这一轮完全结束（含错误）后才 resolve */
  runTurn: (input: T) => Promise<void>;
  /** 入队前的准备工作，例如「还没有会话就先建一个」。返回 false 则丢弃这条消息。 */
  before?: () => Promise<boolean>;
  /** 某一轮抛错时的回调。不提供则静默；无论如何队列都会继续消费下一条。 */
  onError?: (err: unknown, input: T) => void;
}

export interface TurnQueue<T> {
  /** 等待中的消息（不含正在执行的那一条） */
  queue: Ref<T[]>;
  /** 是否有一轮正在跑（供 UI 显示「思考中…」） */
  busy: Ref<boolean>;
  /** 入队并触发消费 */
  send: (input: T) => Promise<void>;
  /** 取消第 i 条排队消息 */
  cancel: (i: number) => void;
  /** 清空排队（不影响正在跑的那一轮） */
  clear: () => void;
}

export function useTurnQueue<T>(opts: TurnQueueOptions<T>): TurnQueue<T> {
  const queue = ref<T[]>([]) as Ref<T[]>;
  const busy = ref(false);
  let draining = false;
  /** before() 的在途 Promise，防止连点时并发执行（例如创建出多个会话） */
  let preparing: Promise<boolean> | null = null;

  async function drain(): Promise<void> {
    if (draining) return;
    draining = true;
    busy.value = true;
    try {
      while (queue.value.length) {
        const next = queue.value.shift();
        if (next === undefined) break;
        // 队列是响应式的，取出来的是 Proxy；Electron IPC 的结构化克隆无法序列化 Proxy
        const raw = toRaw(next);
        try {
          await opts.runTurn(raw);
        } catch (e) {
          // 一轮失败不能把后面排队的消息一起丢掉
          opts.onError?.(e, raw);
        }
      }
    } finally {
      draining = false;
      busy.value = false;
    }
  }

  async function send(input: T): Promise<void> {
    if (opts.before) {
      if (!preparing) {
        preparing = opts.before().finally(() => {
          preparing = null;
        });
      }
      if (!(await preparing)) return;
    }
    queue.value.push(input);
    await drain();
  }

  function cancel(i: number): void {
    queue.value.splice(i, 1);
  }

  function clear(): void {
    queue.value = [];
  }

  return { queue, busy, send, cancel, clear };
}
