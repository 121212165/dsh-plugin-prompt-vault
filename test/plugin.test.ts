/** Assembly-layer integration tests: the real apply() wired against a scripted
 * mock context, driving the /pv command surface over a real temp library file.
 * This is the wire coverage the family audit flagged as missing (plugin.ts had
 * zero tests). Pure-layer contracts live in the sibling library suite.
 * @module test/plugin.test */

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { fire, fireOk, mounted, type Harness } from './harness.ts';

const MARKDOWN = '# 我的库\n\n前言一段\n\n## 反审清单\n\n逐条检查AI味\n\n## 开场钩子\n\n前三十字定生死\n\n##只有标题没有正文\n';

/** Mount a harness, drop the fixture markdown into the temp dir, import it. */
async function seeded(opts?: { agent?: boolean }): Promise<{ harness: Harness; file: string }> {
  const harness = await mounted(opts);
  const file = join(harness.libraryPath, '..', 'prompts.md');
  writeFileSync(file, MARKDOWN, 'utf8');
  fireOk(harness, `import ${file}`);
  return { harness, file };
}

function libraryOf(harness: Harness): string {
  assert.ok(existsSync(harness.libraryPath), 'library JSONL exists on disk');
  return readFileSync(harness.libraryPath, 'utf8');
}

test('disabled by config mounts nothing', async () => {
  const { makeHarness } = await import('./harness.ts');
  const off = makeHarness();
  await off.apply({ enabled: false });
  assert.equal(off.commands.length, 0);
});

test('apply wires exactly one command: /pv, with a usage hint', async () => {
  const harness = await mounted();
  assert.deepEqual(harness.commands.map((command) => command.name), ['pv']);
  const pv = harness.command('pv');
  assert.match(pv.description, /提示词弹药库/);
  assert.match(pv.input?.hint ?? '', /show <id>/);
});

test('/pv import a real temp markdown file, then /pv list shows it; a re-import dedupes ids', async () => {
  const { harness, file } = await seeded();

  const list = fire(harness, 'list');
  assert.equal(list.kind, 'success');
  assert.ok(list.text.includes('2 条提示词'), list.text);
  assert.ok(list.text.includes('反审清单'));
  assert.ok(list.text.includes('开场钩子'));

  const onDisk = libraryOf(harness);
  assert.ok(onDisk.includes('逐条检查AI味'));
  assert.equal(onDisk.trim().split('\n').length, 2);

  // importing the same file again must not collide: ids get suffixes, count grows
  const again = fireOk(harness, `import ${file}`);
  assert.ok(again.includes('导入 2 条'), again);
  assert.ok(again.includes('共 4 条'), again);
  assert.ok(fire(harness, 'list').text.includes('-2'));
});

test('/pv import fails loud on a missing file and on a file with no importable blocks', async () => {
  const harness = await mounted();
  const missing = fire(harness, 'import Z:/definitely/not/here.md');
  assert.equal(missing.kind, 'error');
  assert.ok(missing.text.includes('文件不存在'), missing.text);

  const empty = join(harness.libraryPath, '..', 'empty.md');
  writeFileSync(empty, '前言不该算\n\n## 只有标题没有正文\n\n##\n', 'utf8');
  const result = fire(harness, `import ${empty}`);
  assert.equal(result.kind, 'error');
  assert.ok(result.text.includes('没有解析出'), result.text);
  assert.ok(result.text.includes('跳过 2 个'), result.text);
});

test('/pv show: unique prefix resolves, ambiguity and misses fail loud', async () => {
  const { harness } = await seeded();
  assert.ok(fireOk(harness, 'show 反审').includes('逐条检查AI味'));
  // '开场钩子' unique, 'a' prefix hits nothing, non-empty garbage misses
  const miss = fire(harness, 'show 不存在的东西');
  assert.equal(miss.kind, 'error');
  assert.ok(miss.text.includes('没有叫'), miss.text);
});

test('/pv send with a live session injects the body as a user message with the producer-owned kind', async () => {
  const { harness } = await seeded();
  const text = fireOk(harness, 'send 反审');

  assert.ok(text.includes('已把 #反审清单'), text);
  assert.equal(harness.followups.length, 1);
  const followup = harness.followups[0]!;
  assert.equal(followup.text, '逐条检查AI味');
  assert.equal(followup.message.role, 'user');
  assert.equal(followup.message.source?.kind, 'plugin:prompt-vault');
  assert.equal(followup.message.source?.form, 'notice');
  assert.equal(followup.message.source?.summary, '反审清单');
});

test('/pv send without a live session fails clean instead of dead-ending', async () => {
  const { harness } = await seeded({ agent: false });
  const result = fire(harness, 'send 反审');
  assert.equal(result.kind, 'error');
  assert.ok(result.text.includes('当前没有活跃会话'), result.text);
  assert.equal(harness.followups.length, 0);
});

test('/pv tag persists to disk and unknown verbs get the usage line', async () => {
  const { harness } = await seeded();

  const tagged = fireOk(harness, 'tag 反审清单 质量 #必读');
  assert.ok(tagged.includes('[质量, 必读]'), tagged);
  assert.ok(libraryOf(harness).includes('质量'));

  const usage = fire(harness, 'frobnicate');
  assert.equal(usage.kind, 'error');
  assert.ok(usage.text.includes('看不懂'), usage.text);
  assert.ok(usage.text.includes('import'), usage.text);

  // tag a miss fails loud and writes nothing new
  const linesBefore = libraryOf(harness).trim().split('\n').length;
  assert.equal(fire(harness, 'tag 幽灵条目 x').kind, 'error');
  assert.equal(libraryOf(harness).trim().split('\n').length, linesBefore);
});
