import Schema from '@deepseek-ai/schemastery';
import { defineTool } from '@deepseek-ai/dsh-tools';
import { createUserMessage } from '@deepseek-ai/dsh-llm';
import { closeSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { brandString } from '@deepseek-ai/dsh-brand';
import { importMarkdown, markUsed, parseLibrary, renderList, renderBody, matchItem, slugify } from './library.js';
export const name = 'prompt-vault';
export const inject = ['commands', 'llm', 'agents', 'tools'];
export const Config = Schema.object({
    enabled: Schema.boolean().default(true),
    libraryPath: Schema.string(),
});
export function expandHome(path) {
    return path.startsWith('~') ? join(homedir(), path.slice(1)) : path;
}
export const LOCK_TIMEOUT_MS = 400;
export const LOCK_STALE_MS = 5000;
/** Exclusive-create advisory lock, the pinboard family's mutate pattern: spin
 * until the deadline, take over a stale older than LOCK_STALE_MS, degrade to
 * an unlocked write when busy. */
export function acquireLock(lockPath) {
    const deadline = Date.now() + LOCK_TIMEOUT_MS;
    for (;;) {
        try {
            closeSync(openSync(lockPath, 'wx'));
            return true;
        }
        catch (error) {
            if (error.code !== 'EEXIST')
                return true;
            if (Date.now() >= deadline)
                return false;
            try {
                if (Date.now() - statSync(lockPath).mtimeMs > LOCK_STALE_MS)
                    unlinkSync(lockPath);
            }
            catch {
                // vanished or lost the takeover race — retry the create instead
            }
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
        }
    }
}
function releaseLock(lockPath) {
    try {
        unlinkSync(lockPath);
    }
    catch {
        // nothing to clean or a concurrent releaser got there first
    }
}
export class LibraryStore {
    path;
    /** set by apply() so lock degradation is visible in the plugin log */
    warn;
    constructor(libraryPath) {
        this.path = libraryPath ? expandHome(libraryPath) : join(homedir(), '.dsh', 'prompt-vault', 'library.jsonl');
    }
    load() {
        if (!existsSync(this.path))
            return [];
        return parseLibrary(readFileSync(this.path, 'utf8')).items;
    }
    save(items) {
        // dirname() handles both separators and relative filenames where a raw
        // lastIndexOf(sep) would produce '' and crash mkdirSync.
        const dir = dirname(this.path);
        mkdirSync(dir, { recursive: true });
        // temp+rename: a crash or a concurrent reader never sees a torn library
        const tmp = join(dir, `.library-${process.pid}-${Date.now()}.tmp`);
        writeFileSync(tmp, items.map((item) => JSON.stringify(item)).join('\n') + '\n', 'utf8');
        renameSync(tmp, this.path);
    }
    /** The one write path: load-modify-write under the advisory lock, per family
     * convention (pinboard FactStore/PinStore), so concurrent processes each
     * keep their line. */
    mutate(fn) {
        mkdirSync(dirname(this.path), { recursive: true });
        const lockPath = `${this.path}.lock`;
        const locked = acquireLock(lockPath);
        if (!locked)
            this.warn?.('prompt-vault lock busy — saved without lock');
        try {
            return fn({ load: () => this.load(), save: (items) => this.save(items) });
        }
        finally {
            if (locked)
                releaseLock(lockPath);
        }
    }
}
export function apply(ctx, config) {
    const log = ctx.logger('prompt-vault');
    if (!config.enabled)
        return void log.info('disabled by config');
    const store = new LibraryStore(config.libraryPath);
    store.warn = (message) => log.warn(message);
    // Zero-config: an empty library seeds itself with the bundled starter set,
    // so /pv list is never an empty screen on first run.
    if (store.load().length === 0) {
        try {
            const seedPath = new URL('../seed/seed-prompts.md', import.meta.url);
            const seedContent = readFileSync(seedPath, 'utf8');
            const seeded = importMarkdown(seedContent, new Set());
            if (seeded.items.length) {
                const now = new Date().toISOString();
                const library = seeded.items.map((item) => ({ v: 1, ...item, importedAt: now }));
                store.mutate((view) => view.save([...view.load(), ...library]));
                log.info(`seeded ${library.length} starter prompts`);
            }
        }
        catch (error) {
            log.warn(`seed skipped: ${String(error)}`);
        }
    }
    const items = () => store.load();
    ctx.commands.register({
        name: 'pv',
        description: '提示词弹药库：/pv [过滤词] 列表（加 --hot 按使用热度排序） · /pv show <id> · /pv send <id> · /pv import <markdown文件>',
        input: { hint: '[过滤词|--hot|show <id>|send <id>|import <file>]' },
        handler: ({ rawInput }) => {
            const input = String(rawInput ?? '').trim();
            const hot = /\s--hot\b|^--hot\b/.test(input);
            const cleaned = input.replace(/\s--hot\b|^--hot\b/, '').trim();
            const [verb, ...rest] = cleaned.split(/\s+/);
            const argument = rest.join(' ');
            if (!verb || verb === 'list')
                return { kind: 'success', text: renderList(items(), verb === 'list' && argument ? argument : cleaned && verb !== 'list' ? cleaned : undefined, hot) };
            if (verb === 'show') {
                const match = matchItem(items(), argument);
                if (match === 'missing')
                    return { kind: 'error', text: `没有叫 ${argument} 的提示词。/pv 先看列表。` };
                if (match === 'ambiguous')
                    return { kind: 'error', text: `"${argument}" 匹配到多条，用更完整的 id。` };
                return { kind: 'success', text: renderBody(match) };
            }
            if (verb === 'send') {
                const match = matchItem(items(), argument);
                if (match === 'missing')
                    return { kind: 'error', text: `没有叫 ${argument} 的提示词。` };
                if (match === 'ambiguous')
                    return { kind: 'error', text: `"${argument}" 匹配到多条，用更完整的 id。` };
                const session = ctx.agents?.get?.(brandString('client-session')) ?? undefined;
                const agent = (ctx.agents?.list?.() ?? [])[0] ?? session;
                if (!agent)
                    return { kind: 'error', text: '当前没有活跃会话可以注入。' };
                agent.followup(createUserMessage({
                    // Session format v4 retired the {kind:'plugin', plugin:<name>} wrapper and
                    // throws on it, so this aborted the session the moment a template was
                    // sent. Producers own their kind as `plugin:<name>` — the shape the
                    // official v3->v4 producerKind() migrates to — which keeps the "the
                    // plugin injected this, the human did not type it" attribution.
                    // dsh-llm's source union predates that and is narrower than its runtime.
                    content: [{ type: 'text', text: match.body }],
                    source: { kind: `plugin:${name}`, form: 'notice', summary: match.title },
                }));
                store.mutate((view) => view.save(markUsed(view.load(), match.id)));
                return { kind: 'success', text: `已把 #${match.id}「${match.title}」作为用户消息注入当前会话（使用 +1）。` };
            }
            if (verb === 'import') {
                const file = expandHome(argument);
                if (!existsSync(file))
                    return { kind: 'error', text: `文件不存在: ${file}` };
                const used = new Set(items().map((item) => item.id));
                const result = importMarkdown(readFileSync(file, 'utf8'), used);
                if (!result.items.length)
                    return { kind: 'error', text: `没有解析出 "## 标题 + 正文" 的块（跳过 ${result.skippedHeadings} 个）。` };
                const now = new Date().toISOString();
                store.mutate((view) => {
                    const onDisk = view.load();
                    const used = new Set(onDisk.map((item) => item.id));
                    for (const item of result.items) {
                        if (used.has(item.id))
                            continue;
                        onDisk.push({ v: 1, ...item, importedAt: now });
                        used.add(item.id);
                    }
                    view.save(onDisk);
                });
                return { kind: 'success', text: `导入 ${result.items.length} 条（跳过 ${result.skippedHeadings} 个空块），弹药库共 ${items().length} 条。` };
            }
            if (verb === 'tag') {
                const [id, ...tags] = rest;
                const library = items();
                const match = matchItem(library, id ?? '');
                if (match === 'missing' || match === 'ambiguous')
                    return { kind: 'error', text: `定位不到 ${id}` };
                const fresh = [...new Set([...match.tags, ...tags.map((tag) => tag.replace(/^#/, ''))])];
                store.mutate((view) => view.save(view.load().map((item) => (item.id === match.id ? { ...item, tags: fresh } : item))));
                return { kind: 'success', text: renderBody({ ...match, tags: fresh }) };
            }
            return { kind: 'error', text: `看不懂 "${verb}"。用法：/pv [过滤词] · show <id> · send <id> · import <file> · tag <id> <tag...>` };
        },
    });
    ctx.tools.register(defineTool({
        name: 'prompt_save',
        description: '把一条可复用的提示词存进提示词弹药库（跨会话，供 prompt_get 取回）。用户说"把这个提示词存档/复用"时用它。',
        parameters: {
            title: { type: 'string', required: true, description: '短标题，入库 id 由它生成' },
            body: { type: 'string', required: true, description: '提示词正文，可多行' },
            tags: { type: 'array', items: { type: 'string' }, description: '可选标签' },
        },
        output: {
            schema: { type: 'string' },
            render: (_args, value) => [{ type: 'text', text: value }],
        },
        presentCall: () => ({ card: 'generic', title: '存提示词', kind: 'edit' }),
        presentResult: (_args, value) => ({
            card: 'generic',
            title: String(value).split('\n')[0].slice(0, 60),
            kind: 'edit',
            rawInput: value,
        }),
        async execute(args) {
            const title = String(args.title ?? '').replace(/\s+/g, ' ').trim();
            const body = String(args.body ?? '').trim();
            if (!title || !body)
                return '标题或正文为空，未入库。各给一句 title 和 body。';
            const tags = [...new Set((args.tags ?? []).map((tag) => String(tag).replace(/^#/, '').trim()).filter(Boolean))];
            let id = '';
            store.mutate((view) => {
                id = slugify(title, new Set(view.load().map((item) => item.id)));
                view.save([...view.load(), { v: 1, id, title, tags, body, importedAt: new Date().toISOString() }]);
            });
            return `已存档 #${id}「${title}」（取回用 prompt_get ${id}）`;
        },
    }));
    ctx.tools.register(defineTool({
        name: 'prompt_get',
        description: '取回存档的提示词（id 或唯一前缀/子串定位）。拿到的是全文，直接按它执行或转给用户。',
        parameters: {
            id: { type: 'string', required: true, description: 'id、id 前缀或标题子串' },
        },
        output: {
            schema: { type: 'string' },
            render: (_args, value) => [{ type: 'text', text: value }],
        },
        presentCall: () => ({ card: 'generic', title: '取提示词', kind: 'search' }),
        presentResult: (_args, value) => ({
            card: 'generic',
            title: String(value).split('\n')[0].slice(0, 60),
            kind: 'search',
            rawInput: value,
        }),
        async execute(args) {
            const match = matchItem(store.load(), String(args.id ?? ''));
            if (match === 'missing')
                return '没有这条提示词。用更完整的 id 或标题子串再取。';
            if (match === 'ambiguous')
                return '匹配到多条，用一个更长的唯一前缀。';
            return renderBody(match);
        },
    }));
    log.info(`mounted · ${store.path}`);
}
export { slugify };
//# sourceMappingURL=plugin.js.map