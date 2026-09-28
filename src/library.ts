/** Pure prompt-library model: markdown import, listing, id matching.
 * Library file is JSONL of {v:1,id,title,tags[],body}. Markdown import splits
 * on `## ` headings; text before the first heading becomes the library note. */

export interface PromptItem {
  v: 1;
  id: string;
  title: string;
  tags: string[];
  body: string;
  importedAt: string;
}

export interface ImportResult {
  items: Omit<PromptItem, 'v' | 'importedAt'>[];
  skippedHeadings: number;
}

export function slugify(title: string, used: Set<string>): string {
  const base = title
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'prompt';
  let id = base;
  let counter = 2;
  while (used.has(id)) id = `${base}-${counter++}`;
  used.add(id);
  return id;
}

export function importMarkdown(content: string, used: Set<string>): ImportResult {
  const items: ImportResult['items'] = [];
  let skippedHeadings = 0;
  const blocks = content.split(/^##\s+/m);
  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;
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

export function parseLibraryLine(line: string): PromptItem | null {
  const text = line.trim();
  if (!text) return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null) return null;
  const record = value as Record<string, unknown>;
  if (record.v !== 1) return null;
  if (typeof record.id !== 'string' || typeof record.title !== 'string' || typeof record.body !== 'string') return null;
  if (!Array.isArray(record.tags)) return null;
  if (typeof record.importedAt !== 'string') return null;
  return value as unknown as PromptItem;
}

export function parseLibrary(content: string): { items: PromptItem[]; skipped: number } {
  let skipped = 0;
  const items: PromptItem[] = [];
  for (const line of content.split(/\r?\n/)) {
    const item = parseLibraryLine(line);
    if (item) items.push(item);
    else if (line.trim()) skipped++;
  }
  return { items, skipped };
}

export interface ListedPrompt {
  id: string;
  title: string;
  tags: string[];
  chars: number;
}

export function renderList(items: PromptItem[], filter?: string): string {
  const needle = filter?.trim().toLowerCase();
  const visible = needle
    ? items.filter((item) => `${item.title}\u0000${item.id}\u0000${item.tags.join(',')}`.toLowerCase().includes(needle))
    : items;
  if (!visible.length) return needle ? `没有匹配 "${filter}" 的提示词。` : '弹药库还是空的。/pv import <markdown> 先导入一批。';
  const lines = visible.map((item) => `  ${item.id.padEnd(28)} ${item.title}${item.tags.length ? `  [${item.tags.join(', ')}]` : ''} · ${item.body.length} 字`);
  return `${visible.length} 条提示词:\n${lines.join('\n')}`;
}

/** Exact id first, then unique prefix/substring; ambiguous ids fail loud. */
export function matchItem(items: PromptItem[], idOrPrefix: string): PromptItem | 'missing' | 'ambiguous' {
  const needle = idOrPrefix.trim().toLowerCase();
  if (!needle) return 'missing';
  const exact = items.find((item) => item.id === needle);
  if (exact) return exact;
  const partial = items.filter((item) => item.id.includes(needle) || item.title.toLowerCase().includes(needle));
  if (partial.length === 1) return partial[0]!;
  return partial.length ? 'ambiguous' : 'missing';
}

export function renderBody(item: PromptItem): string {
  return `#${item.id} ${item.title}${item.tags.length ? `  [${item.tags.join(', ')}]` : ''}\n\n${item.body}`;
}
