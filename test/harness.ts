/** Shared assembly-layer harness: a scripted mock dsh context that the real
 * `apply()` wires against, so the /pv command surface is exercised over a real
 * temp library file — the wire coverage the family audit found missing
 * everywhere. Pattern adopted from dsh-auto-review's mountHarness (222★),
 * rebuilt on node:test after dsh-plugin-task-forge (the family's first port).
 *
 * prompt-vault only touches ctx.logger / ctx.commands / ctx.agents, so that is
 * all the mock provides — the real @deepseek-ai/dsh-llm createUserMessage and
 * dsh-brand brandString are used unmocked.
 * @module test/harness */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after } from 'node:test';

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

export interface Harness {
  commands: CapturedCommand[];
  followups: CapturedFollowup[];
  /** Temp file backing LibraryStore for this mount — wiped after tests. */
  libraryPath: string;
  /** Mounts the real apply() against this harness once; later calls are no-ops. */
  apply(config: Record<string, unknown>): Promise<void>;
  command(name: string): CapturedCommand;
}

export interface HarnessOptions {
  /** false → no live session, so /pv send must fall back to the no-session error. */
  agent?: boolean;
}

export function makeHarness(options: HarnessOptions = {}): Harness {
  const commands: CapturedCommand[] = [];
  const followups: CapturedFollowup[] = [];

  const agent = {
    followup(message: { content?: Array<{ type: string; text?: string }>; source?: { kind?: string; form?: string; summary?: string } }) {
      const first = message.content?.[0];
      followups.push({ text: typeof first?.text === 'string' ? first.text : '', message });
    },
  };

  const ctx = {
    logger(_name: string) {
      return { info() {}, warn() {} };
    },
    commands: {
      register(definition: CapturedCommand) {
        commands.push(definition);
      },
    },
    // apply() probes get('client-session') first, then list()[0]
    agents:
      options.agent === false
        ? { get: () => undefined, list: () => [] }
        : { get: () => undefined, list: () => [agent] },
  };

  const dir = mkdtempSync(join(tmpdir(), 'prompt-vault-wire-'));
  const libraryPath = join(dir, 'library.jsonl');
  after(() => rmSync(dir, { recursive: true, force: true }));

  // apply once per harness — a second call would double-register /pv.
  let applied: Promise<void> | null = null;

  const harness: Harness = {
    commands,
    followups,
    libraryPath,
    apply(config: Record<string, unknown>) {
      applied ??= import('../src/plugin.ts').then(({ apply }) => apply(ctx as never, { enabled: true, libraryPath, ...config } as never));
      return applied;
    },
    command(name: string): CapturedCommand {
      const found = commands.find((candidate) => candidate.name === name);
      if (!found) throw new Error(`command ${name} was never registered`);
      return found;
    },
  };
  return harness;
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
