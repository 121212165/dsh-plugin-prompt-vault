/** Pure prompt-library model: markdown import, listing, id matching.
 * Library file is JSONL of {v:1,id,title,tags[],body}. Markdown import splits
 * on `## ` headings; text before the first heading becomes the library note. */
export function slugify(title, used) {
    const base = title
        .trim()
        .toLowerCase()
        .replace(/[^\p{L}\p{N}]+/gu, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 40) || 'prompt';
    let id = base;
    let counter = 2;
    while (used.has(id))
        id = `${base}-${counter++}`;
    used.add(id);
    return id;
}
export function importMarkdown(content, used) {
    const items = [];
    let skippedHeadings = 0;
    const blocks = content.split(/^##\s+/m);
    for (const block of blocks) {
        const trimmed = block.trim();
        if (!trimmed)
            continue;
        const newline = trimmed.indexOf('\n');
        if (newline === -1) {
            skippedHeadings++;
            continue;
        }
        const title = trimmed.slice(0, newline).trim();
        const body = trimmed.slice(newline + 1).trim();
        // a '#' title line is the document's H1/preface, not a prompt entry
        if (!title || !body || title.startsWith('#')) {
            skippedHeadings++;
            continue;
        }
        items.push({ id: slugify(title, used), title, tags: [], body });
    }
    return { items, skippedHeadings };
}
export function parseLibraryLine(line) {
    const text = line.trim();
    if (!text)
        return null;
    let value;
    try {
        value = JSON.parse(text);
    }
    catch {
        return null;
    }
    if (typeof value !== 'object' || value === null)
        return null;
    const record = value;
    if (record.v !== 1)
        return null;
    if (typeof record.id !== 'string' || typeof record.title !== 'string' || typeof record.body !== 'string')
        return null;
    if (!Array.isArray(record.tags))
        return null;
    if (typeof record.importedAt !== 'string')
        return null;
    const item = value;
    if (item.usedCount !== undefined && (typeof item.usedCount !== 'number' || !Number.isInteger(item.usedCount) || item.usedCount < 0))
        delete item.usedCount;
    if (item.lastUsedAt !== undefined && (typeof item.lastUsedAt !== 'string' || !Number.isFinite(Date.parse(item.lastUsedAt))))
        delete item.lastUsedAt;
    return item;
}
export function parseLibrary(content) {
    let skipped = 0;
    const items = [];
    for (const line of content.split(/\r?\n/)) {
        const item = parseLibraryLine(line);
        if (item)
            items.push(item);
        else if (line.trim())
            skipped++;
    }
    return { items, skipped };
}
/** `/pv list --hot` orders by the usage tally instead of library order. */
export function renderList(items, filter, hot = false) {
    const needle = filter?.trim().toLowerCase();
    const visible = needle
        ? items.filter((item) => `${item.title}\u0000${item.id}\u0000${item.tags.join(',')}`.toLowerCase().includes(needle))
        : items;
    if (!visible.length)
        return needle ? `没有匹配 "${filter}" 的提示词。` : '弹药库还是空的。/pv import <markdown> 先导入一批。';
    const ordered = hot ? [...visible].sort((a, b) => (b.usedCount ?? 0) - (a.usedCount ?? 0)) : visible;
    const lines = ordered.map((item) => {
        const uses = item.usedCount ? ` · 用${item.usedCount}次` : '';
        return `  ${item.id.padEnd(28)} ${item.title}${item.tags.length ? `  [${item.tags.join(', ')}]` : ''} · ${item.body.length} 字${uses}`;
    });
    return `${visible.length} 条提示词${hot ? '（按热度）' : ''}:\n${lines.join('\n')}`;
}
/** Bump the tally on send. Pure: returns the new array, caller persists. */
export function markUsed(items, id, now = new Date()) {
    return items.map((item) => (item.id === id ? { ...item, usedCount: (item.usedCount ?? 0) + 1, lastUsedAt: now.toISOString() } : item));
}
/** Exact id first, then unique prefix/substring; ambiguous ids fail loud. */
export function matchItem(items, idOrPrefix) {
    const needle = idOrPrefix.trim().toLowerCase();
    if (!needle)
        return 'missing';
    const exact = items.find((item) => item.id === needle);
    if (exact)
        return exact;
    const partial = items.filter((item) => item.id.includes(needle) || item.title.toLowerCase().includes(needle));
    if (partial.length === 1)
        return partial[0];
    return partial.length ? 'ambiguous' : 'missing';
}
export function renderBody(item) {
    return `#${item.id} ${item.title}${item.tags.length ? `  [${item.tags.join(', ')}]` : ''}\n\n${item.body}`;
}
//# sourceMappingURL=library.js.map