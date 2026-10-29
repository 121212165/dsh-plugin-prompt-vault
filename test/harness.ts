/** Shared assembly-layer harness: a scripted mock dsh context that the real
 * `apply()` wires against, so the /pv command surface is exercised over a real
 * temp library file. The mock itself lives in @dsh-family/kit; this file adds
 * prompt-vault's agent stub, followup capture and command helpers.
 *
 * The real @deepseek-ai/dsh-llm createUserMessage and dsh-brand brandString are
 * used unmocked.
 * @module test/harness */

import { join } from 'node:path';

import { applyOnce, createMockCtx, tempDir } from '@dsh-family/kit/kit/test-harness';

export interface CapturedCommand {
  name: string;
  description: string;
  input?: { hint?: string };
  handler: (args: { rawInput?: string }) => { kind: string; text: string };
}

export interface CapturedFollowup {
  text: string;
  message: {
    role?: string;
    source?: { kind?: string; form?: string; summary?: string };
    content?: Array<{ type: string; text?: string }>;
  };
}

export interface CapturedTool {
  name: string;
  execute: (args: Record<string, unknown>) => Promise<string>;
}

export interface Harness {
  commands: CapturedCommand[];
  tools: CapturedTool[];
  followups: CapturedFollowup[];
  /** Temp file backing LibraryStore for this mount — wiped after tests. */
  libraryPath: string;
  /** Mounts the real apply() against this harness once; later calls are no-ops. */
  apply(config: Record<string, unknown>): Promise<void>;
  command(name: string): CapturedCommand;
  tool(name: string): CapturedTool;
}

export interface HarnessOptions {
  /** false → no live session, so /pv send must fall back to the no-session error. */
  agent?: boolean;
}

export function makeHarness(options: HarnessOptions = {}): Harness {
  const followups: CapturedFollowup[] = [];

  const agent = {
    followup(message: { content?: Array<{ type: string; text?: string }>; source?: { kind?: string; form?: string; summary?: string } }) {
      const first = message.content?.[0];
      followups.push({ text: typeof first?.text === 'string' ? first.text : '', message });
    },
  };

  const mock = createMockCtx<CapturedCommand, CapturedTool, never>({
    // apply() probes get('client-session') first, then list()[0]
    agents: options.agent === false ? { get: () => undefined, list: () => [] } : { get: () => undefined, list: () => [agent] },
  });

  const libraryPath = join(tempDir('prompt-vault-wire-'), 'library.jsonl');

  // apply once per harness — a second call would double-register /pv.
  let pending: Record<string, unknown> = {};
  let mounted = false;
  const applied = applyOnce(() =>
    import('../src/plugin.ts').then(({ apply }) =>
      apply(mock.ctx as never, { enabled: true, libraryPath, ...pending } as never),
    ),
  );

  return {
    commands: mock.commands,
    tools: mock.tools,
    followups,
    libraryPath,
    apply(config: Record<string, unknown>) {
      if (!mounted) {
        mounted = true;
        pending = config;
      }
      return applied();
    },
    command: mock.command,
    tool: mock.tool,
  };
}

/** Convenience: mount the harness and return it. */
export async function mounted(opts?: { agent?: boolean }): Promise<Harness> {
  const harness = makeHarness(opts);
  // libraryPath MUST point at the harness temp file or tests would write the
  // real ~/.dsh/prompt-vault/library.jsonl
  await harness.apply({});
  return harness;
}

/** Fire a command on an already-mounted harness, returning the raw result. */
export function fire(harness: Harness, rawInput: string): { kind: string; text: string } {
  return harness.command('pv').handler({ rawInput });
}

/** Fire /pv and unwrap its text, asserting it succeeded. */
export function fireOk(harness: Harness, rawInput: string): string {
  const result = fire(harness, rawInput);
  if (result.kind !== 'success') throw new Error(`expected success from /pv ${rawInput}, got ${result.kind}: ${result.text}`);
  return result.text;
}
