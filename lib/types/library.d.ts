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
    /** usage tally, optional-in-v1: lines written before /pv send counted simply
     * lack the key, and a bad value only loses the tally. */
    usedCount?: number;
    lastUsedAt?: string;
}
export interface ImportResult {
    items: Omit<PromptItem, 'v' | 'importedAt'>[];
    skippedHeadings: number;
}
export declare function slugify(title: string, used: Set<string>): string;
export declare function importMarkdown(content: string, used: Set<string>): ImportResult;
export declare function parseLibraryLine(line: string): PromptItem | null;
export declare function parseLibrary(content: string): {
    items: PromptItem[];
    skipped: number;
};
export interface ListedPrompt {
    id: string;
    title: string;
    tags: string[];
    chars: number;
}
/** `/pv list --hot` orders by the usage tally instead of library order. */
export declare function renderList(items: PromptItem[], filter?: string, hot?: boolean): string;
/** Bump the tally on send. Pure: returns the new array, caller persists. */
export declare function markUsed(items: PromptItem[], id: string, now?: Date): PromptItem[];
/** Exact id first, then unique prefix/substring; ambiguous ids fail loud. */
export declare function matchItem(items: PromptItem[], idOrPrefix: string): PromptItem | 'missing' | 'ambiguous';
export declare function renderBody(item: PromptItem): string;
//# sourceMappingURL=library.d.ts.map