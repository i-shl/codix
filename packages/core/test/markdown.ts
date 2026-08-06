/**
 * markdown 解析器测试
 */
import { parseMarkdown, parseInline } from '../dist/utils/markdown.js';

const passed: string[] = [];
const failed: string[] = [];
function assert(cond: boolean, label: string): void {
  if (cond) { passed.push(label); console.log(`  ✓ ${label}`); }
  else { failed.push(label); console.log(`  ✗ ${label}`); }
}

console.log('=== Markdown Parser ===\n');

// 1. 标题
{
  const blocks = parseMarkdown('# Hello\n\n## World\n\n### Sub');
  assert(blocks.length === 3, '解析 3 个标题');
  assert(blocks[0].kind === 'heading' && blocks[0].level === 1, 'h1');
  assert(blocks[1].kind === 'heading' && blocks[1].level === 2, 'h2');
  assert(blocks[2].kind === 'heading' && blocks[2].level === 3, 'h3');
}

// 2. 段落
{
  const blocks = parseMarkdown('这是普通段落。\n\n第二段。');
  assert(blocks.length === 2, '2 个段落');
  assert(blocks[0].kind === 'paragraph' && blocks[1].kind === 'paragraph', '都是 paragraph');
}

// 3. 粗体
{
  const inl = parseInline('这是 **粗体** 文本');
  const bold = inl.find((n) => n.kind === 'bold');
  assert(!!bold, '识别 **bold**');
  if (bold && bold.kind === 'bold') {
    assert(bold.children[0]?.kind === 'text' && (bold.children[0] as any).text === '粗体', 'bold 内容正确');
  }
}

// 4. 斜体
{
  const inl = parseInline('这是 *斜体* 文本');
  const italic = inl.find((n) => n.kind === 'italic');
  assert(!!italic, '识别 *italic*');
}

// 5. 行内代码
{
  const inl = parseInline('使用 `console.log()` 输出');
  const code = inl.find((n) => n.kind === 'code');
  assert(!!code, '识别 `code`');
  if (code && code.kind === 'code') {
    assert(code.text === 'console.log()', 'code 文本正确');
  }
}

// 6. 粗体含特殊字符
{
  const inl = parseInline('**a `b` c**');
  const bold = inl.find((n) => n.kind === 'bold');
  assert(!!bold, 'bold 含 inline code');
  if (bold && bold.kind === 'bold') {
    const code = bold.children.find((n) => n.kind === 'code');
    assert(!!code, 'bold 内有 code');
  }
}

// 7. 代码块
{
  const blocks = parseMarkdown('```typescript\nconst x: number = 1;\n```');
  assert(blocks.length === 1, '解析代码块');
  assert(blocks[0].kind === 'code-block', '是 code-block');
  if (blocks[0].kind === 'code-block') {
    assert(blocks[0].lang === 'typescript', 'lang 正确');
    assert(blocks[0].text === 'const x: number = 1;', 'code 内容正确');
  }
}

// 8. 链接
{
  const inl = parseInline('点击 [这里](https://example.com)');
  const link = inl.find((n) => n.kind === 'link');
  assert(!!link, '识别 [text](url)');
  if (link && link.kind === 'link') {
    assert(link.text === '这里', 'link text 正确');
    assert(link.url === 'https://example.com', 'link url 正确');
  }
}

// 9. 无序列表
{
  const blocks = parseMarkdown('- 项目 1\n- 项目 2\n- 项目 3');
  assert(blocks.length === 1, '1 个列表');
  if (blocks[0].kind === 'list') {
    assert(!blocks[0].ordered, '无序');
    assert(blocks[0].items.length === 3, '3 个 item');
  }
}

// 10. 有序列表
{
  const blocks = parseMarkdown('1. 第一\n2. 第二\n3. 第三');
  if (blocks[0].kind === 'list') {
    assert(blocks[0].ordered, '有序');
    assert(blocks[0].items.length === 3, '3 个 item');
  }
}

// 11. 引用
{
  const blocks = parseMarkdown('> 这是一个引用\n> 多行');
  assert(blocks.length === 1, '1 个引用块');
  assert(blocks[0].kind === 'blockquote', '是 blockquote');
}

// 12. 分隔线
{
  const blocks = parseMarkdown('---');
  assert(blocks.length === 1 && blocks[0].kind === 'hr', '解析 ---');
}

// 13. 混合：标题 + 段落 + 列表
{
  const src = '# 标题\n\n段落。\n\n- a\n- b';
  const blocks = parseMarkdown(src);
  assert(blocks.length === 3, '3 个 block');
  assert(blocks[0].kind === 'heading' && blocks[1].kind === 'paragraph' && blocks[2].kind === 'list', '顺序正确');
}

// 14. 空 markdown
{
  const blocks = parseMarkdown('');
  assert(blocks.length === 0, '空 → 0 blocks');
}

// 15. 段落内的粗体 + 链接 + 代码
{
  const inl = parseInline('看 **这个** [链接](https://x.com) 用 `code`');
  const kinds = inl.map((n) => n.kind);
  assert(kinds.includes('text') && kinds.includes('bold') && kinds.includes('link') && kinds.includes('code'), '混合内联');
}

// 16. 简单表格
{
  const src = '| Name | Age |\n|------|-----|\n| Alice | 30 |\n| Bob | 25 |';
  const blocks = parseMarkdown(src);
  assert(blocks.length === 1, '1 个表格 block');
  assert(blocks[0].kind === 'table', '是 table');
  if (blocks[0].kind === 'table') {
    assert(blocks[0].headers.length === 2, '2 列');
    assert(blocks[0].headers[0] === 'Name' && blocks[0].headers[1] === 'Age', 'headers 正确');
    assert(blocks[0].rows.length === 2, '2 行数据');
    assert(blocks[0].rows[0][0] === 'Alice' && blocks[0].rows[0][1] === '30', 'row[0] 正确');
    assert(blocks[0].rows[1][0] === 'Bob' && blocks[0].rows[1][1] === '25', 'row[1] 正确');
    assert(blocks[0].align[0] === 'left' && blocks[0].align[1] === 'left', '默认 left 对齐');
  }
}

// 17. 表格对齐（:--- / :---: / ---:）
{
  const src = '| L | C | R |\n|:---|:---:|---:|\n| a | b | c |';
  const blocks = parseMarkdown(src);
  if (blocks[0].kind === 'table') {
    assert(blocks[0].align[0] === 'left', '左对齐');
    assert(blocks[0].align[1] === 'center', '居中');
    assert(blocks[0].align[2] === 'right', '右对齐');
  }
}

// 18. 表格行数差异（数据行少于 header 列数时补空）
{
  const src = '| A | B | C |\n|---|---|---|\n| 1 | 2 |';
  const blocks = parseMarkdown(src);
  if (blocks[0].kind === 'table') {
    assert(blocks[0].rows[0].length === 3, '缺失列补空');
    assert(blocks[0].rows[0][2] === '', '最后一列为空');
  }
}

// 19. 表格前后有其他 block
{
  const src = '# 标题\n\n段落。\n\n| H |\n|---|\n| x |\n\n段落二。';
  const blocks = parseMarkdown(src);
  assert(blocks.length === 4, 'h + p + table + p');
  assert(blocks[0].kind === 'heading' && blocks[1].kind === 'paragraph' && blocks[2].kind === 'table' && blocks[3].kind === 'paragraph', '顺序正确');
}

// 20. 表格不强制两端 | 包围
{
  const src = '| A | B |\n|---|---|\n 1 | 2';
  const blocks = parseMarkdown(src);
  // 注意：第 3 行不以 | 开头，isTableLine 返回 false，应该作为段落结束。
  // 所以这里我们得到 1 个 table + 1 个 paragraph
  assert(blocks.length >= 1 && blocks[0].kind === 'table', '识别为表格');
}

// 21. 空表格（只有 header + 分隔）
{
  const src = '| A | B |\n|---|---|';
  const blocks = parseMarkdown(src);
  assert(blocks.length === 1 && blocks[0].kind === 'table', '空数据表格也识别');
  if (blocks[0].kind === 'table') {
    assert(blocks[0].rows.length === 0, '0 行数据');
  }
}

// 22. 表格前/后空行不影响识别
{
  const src = '\n\n| A |\n|---|\n| x |\n\n';
  const blocks = parseMarkdown(src);
  assert(blocks.length >= 1 && blocks[0].kind === 'table', '前后空行也能识别');
}

// 总结
console.log('\n=== 总结 ===');
console.log(`✓ 通过: ${passed.length}`);
console.log(`✗ 失败: ${failed.length}`);
if (failed.length) {
  for (const f of failed) console.log('  -', f);
  process.exit(1);
}
