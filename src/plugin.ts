/**
 * dsh wiring for prompt-vault. Storage is a JSONL file the plugin owns
 * (~/.dsh/prompt-vault/library.jsonl) — same philosophy as the sidecar family.
 * Sending rides the official cookbook's verified UI-plugin surface:
 * ctx.agents.get(...).followup(createUserMessage(...)).
 */
import type { Context } from '@deepseek-ai/cordis';
import Schema from '@deepseek-ai/schemastery';
import type {} from '@deepseek-ai/dsh-commands';
import type {} from '@deepseek-ai/dsh-session';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { brandString } from '@deepseek-ai/dsh-brand';

import { importMarkdown, parseLibrary, renderList, renderBody, matchItem, slugify, type PromptItem } from './library.ts';

export const name = 'prompt-vault';
export const inject = ['commands', 'llm', 'agents'];

export interface Config {
  enabled: boolean;
  libraryPath?: string;
}

export const Config = Schema.object({
  enabled: Schema.boolean().default(true),
  libraryPath: Schema.string(),
});

export function expandHome(path: string): string {
  return path.startsWith('~') ? join(homedir(), path.slice(1)) : path;
}

export class LibraryStore {
  readonly path: string;

  constructor(libraryPath: string | undefined) {
    this.path = libraryPath ? expandHome(libraryPath) : join(homedir(), '.dsh', 'prompt-vault', 'library.jsonl');
  }

  load(): PromptItem[] {
    if (!existsSync(this.path)) return [];
    return parseLibrary(readFileSync(this.path, 'utf8')).items;
  }

  save(items: PromptItem[]): void {
    mkdirSync(this.path.slice(0, this.path.lastIndexOf(this.platformSep())), { recursive: true });
    writeFileSync(this.path, items.map((item) => JSON.stringify(item)).join('\n') + '\n', 'utf8');
  }

  private platformSep(): string {
    return process.platform === 'win32' ? '\\' : '/';
  }
}

export function apply(ctx: Context, config: Config): void {
  const log = ctx.logger('prompt-vault');
  if (!config.enabled) return void log.info('disabled by config');
  const store = new LibraryStore(config.libraryPath);

  const items = (): PromptItem[] => store.load();

  ctx.commands.register({
    name: 'pv',
    description: '提示词弹药库：/pv [过滤词] 列表 · /pv show <id> · /pv send <id> · /pv import <markdown文件>',
    input: { hint: '[过滤词|show <id>|send <id>|import <file>]' },
    handler: ({ rawInput }) => {
      const input = String(rawInput ?? '').trim();
      const [verb, ...rest] = input.split(/\s+/);
      const argument = rest.join(' ');
      if (!verb || verb === 'list') return { kind: 'success', text: renderList(items(), verb === 'list' ? argument : undefined) };
      if (verb === 'show') {
        const match = matchItem(items(), argument);
        if (match === 'missing') return { kind: 'error', text: `没有叫 ${argument} 的提示词。/pv 先看列表。` };
        if (match === 'ambiguous') return { kind: 'error', text: `"${argument}" 匹配到多条，用更完整的 id。` };
        return { kind: 'success', text: renderBody(match) };
      }
      if (verb === 'send') {
        const match = matchItem(items(), argument);
        if (match === 'missing') return { kind: 'error', text: `没有叫 ${argument} 的提示词。` };
        if (match === 'ambiguous') return { kind: 'error', text: `"${argument}" 匹配到多条，用更完整的 id。` };
        const session = ctx.agents?.get?.(brandString<never>('client-session' as never)) ?? undefined;
        const agent = (ctx.agents?.list?.() ?? [])[0] ?? session;
        if (!agent) return { kind: 'error', text: '当前没有活跃会话可以注入。' };
        agent.followup(
          createUserMessage({
            content: [{ type: 'text', text: match.body }],
            source: { kind: 'plugin', plugin: name, form: 'notice', summary: match.title },
          }),
        );
        return { kind: 'success', text: `已把 #${match.id}「${match.title}」作为用户消息注入当前会话。` };
      }
      if (verb === 'import') {
        const file = expandHome(argument);
        if (!existsSync(file)) return { kind: 'error', text: `文件不存在: ${file}` };
        const used = new Set(items().map((item) => item.id));
        const result = importMarkdown(readFileSync(file, 'utf8'), used);
        if (!result.items.length) return { kind: 'error', text: `没有解析出 "## 标题 + 正文" 的块（跳过 ${result.skippedHeadings} 个）。` };
        const library = items();
        const now = new Date().toISOString();
        for (const item of result.items) library.push({ v: 1, ...item, importedAt: now });
        store.save(library);
        return { kind: 'success', text: `导入 ${result.items.length} 条（跳过 ${result.skippedHeadings} 个空块），弹药库共 ${library.length} 条。` };
      }
      if (verb === 'tag') {
        const [id, ...tags] = rest;
        const library = items();
        const match = matchItem(library, id ?? '');
        if (match === 'missing' || match === 'ambiguous') return { kind: 'error', text: `定位不到 ${id}` };
        match.tags = [...new Set([...match.tags, ...tags.map((tag) => tag.replace(/^#/, ''))])];
        store.save(library);
        return { kind: 'success', text: renderBody(match) };
      }
      return { kind: 'error', text: `看不懂 "${verb}"。用法：/pv [过滤词] · show <id> · send <id> · import <file> · tag <id> <tag...>` };
    },
  });

  log.info(`mounted · ${store.path}`);
}

export { slugify };
