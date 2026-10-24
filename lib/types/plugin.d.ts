/**
 * dsh wiring for prompt-vault. Storage is a JSONL file the plugin owns
 * (~/.dsh/prompt-vault/library.jsonl) — same philosophy as the sidecar family.
 * Sending rides the official cookbook's verified UI-plugin surface:
 * ctx.agents.get(...).followup(createUserMessage(...)).
 */
import type { Context } from '@deepseek-ai/cordis';
import Schema from '@deepseek-ai/schemastery';
import { slugify, type PromptItem } from './library.ts';
export declare const name = "prompt-vault";
export declare const inject: string[];
export interface Config {
    enabled: boolean;
    libraryPath?: string;
}
export declare const Config: Schema<Schemastery.ObjectS<{
    enabled: Schema<boolean, boolean>;
    libraryPath: Schema<string, string>;
}>, Schemastery.ObjectT<{
    enabled: Schema<boolean, boolean>;
    libraryPath: Schema<string, string>;
}>>;
export declare function expandHome(path: string): string;
export declare const LOCK_TIMEOUT_MS = 400;
export declare const LOCK_STALE_MS = 5000;
/** Exclusive-create advisory lock, the pinboard family's mutate pattern: spin
 * until the deadline, take over a stale older than LOCK_STALE_MS, degrade to
 * an unlocked write when busy. */
export declare function acquireLock(lockPath: string): boolean;
export declare class LibraryStore {
    readonly path: string;
    /** set by apply() so lock degradation is visible in the plugin log */
    warn?: (message: string) => void;
    constructor(libraryPath: string | undefined);
    load(): PromptItem[];
    save(items: PromptItem[]): void;
    /** The one write path: load-modify-write under the advisory lock, per family
     * convention (pinboard FactStore/PinStore), so concurrent processes each
     * keep their line. */
    mutate<T>(fn: (view: {
        load(): PromptItem[];
        save(items: PromptItem[]): void;
    }) => T): T;
}
export declare function apply(ctx: Context, config: Config): void;
export { slugify };
//# sourceMappingURL=plugin.d.ts.map