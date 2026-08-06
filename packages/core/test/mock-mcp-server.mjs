/**
 * 简单的 MCP server 模拟 - 用于测试 McpManager
 *
 * 通信通过 stdio，JSON-RPC 2.0 协议
 */
import readline from 'node:readline';

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: false });

const handlers = {
  initialize: () => ({
    protocolVersion: '2024-11-05',
    capabilities: { tools: {}, resources: {}, prompts: {} },
    serverInfo: { name: 'test-server', version: '1.0.0' },
  }),
  'tools/list': () => ({
    tools: [{
      name: 'echo',
      description: 'Echo input back',
      inputSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
    }],
  }),
  'tools/call': (params) => ({
    content: [{ type: 'text', text: `echo: ${params?.arguments?.text ?? ''}` }],
    isError: false,
  }),
  'resources/list': () => ({ resources: [] }),
  'prompts/list': () => ({ prompts: [] }),
  'notifications/initialized': () => null,
  ping: () => ({}),
};

rl.on('line', (line) => {
  if (!line.trim()) return;
  try {
    const req = JSON.parse(line);
    const handler = handlers[req.method];
    if (!handler) {
      const errResp = { jsonrpc: '2.0', id: req.id, error: { code: -32601, message: `Method not found: ${req.method}` } };
      console.log(JSON.stringify(errResp));
      return;
    }
    const result = handler(req.params ?? {});
    if (req.id !== undefined) {
      console.log(JSON.stringify({ jsonrpc: '2.0', id: req.id, result }));
    }
  } catch (e) {
    console.error('parse error:', e);
  }
});

console.log('mock-mcp-server ready');