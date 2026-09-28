import assert from 'node:assert/strict';
import { test } from 'node:test';
import { importMarkdown, parseLibrary, renderList, matchItem, slugify, type PromptItem } from '../src/library.ts';

const item = (over: Partial<PromptItem>): PromptItem =>
  ({ v: 1, id: 'a', title: 'A', tags: [], body: 'body', importedAt: '2026-09-28T00:00:00.000Z', ...over });

test('markdown import splits on ## headings; preface and empty blocks are skipped', () => {
  const result = importMarkdown('# 我的库\n\n前言一段\n\n## 反审清单\n\n逐条检查AI味\n\n## 开场钩子\n\n前三十字定生死\n\n##只有标题没有正文', new Set());
  assert.equal(result.items.length, 2);
  assert.equal(result.items[0]!.id, '反审清单');
  assert.equal(result.items[0]!.body, '逐条检查AI味');
  assert.equal(result.items[1]!.id, '开场钩子');
  assert.equal(result.skippedHeadings, 1);
});

test('slugify dedupes with numeric suffixes', () => {
  const used = new Set<string>();
  assert.equal(slugify('开场 钩子!', used), '开场-钩子');
  assert.equal(slugify('开场 钩子!', used), '开场-钩子-2');
  assert.equal(slugify('!!!', used), 'prompt');
});

test('library parsing tolerates junk lines and future versions', () => {
  const good = JSON.stringify(item({ id: 'x' }));
  const result = parseLibrary(`${good}\nnot json\n{"v":2}\n`);
  assert.equal(result.items.length, 1);
  assert.equal(result.skipped, 2);
});

test('list rendering filters by title, id and tag', () => {
  const items = [item({ id: 'anti-ai', title: '反审清单', tags: ['质量'] }), item({ id: 'hook', title: '开场钩子' })];
  assert.ok(renderList(items).includes('2 条提示词'));
  assert.ok(renderList(items, '质量').includes('反审清单'));
  assert.ok(renderList(items, 'anti').includes('反审清单'));
  assert.ok(renderList(items, '不存在').startsWith('没有匹配'));
  assert.ok(renderList([]).includes('还是空的'));
});

test('matchItem: exact, unique prefix, ambiguous, missing', () => {
  const items = [item({ id: 'anti-ai' }), item({ id: 'anti-ai-v2' }), item({ id: 'hook' })];
  assert.equal(matchItem(items, 'hook'), items[2]);
  assert.equal(matchItem(items, 'anti'), 'ambiguous');
  assert.equal(matchItem(items, 'anti-ai-v'), items[1]);
  assert.equal(matchItem(items, 'zzz'), 'missing');
  assert.equal(matchItem(items, ''), 'missing');
});
