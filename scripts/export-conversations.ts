#!/usr/bin/env bun
// Exports one agent's conversation history from `openbot.db` to JSONL for fine-tuning outside
// OpenBot (OpenBot Bubbles fork; see docs/bubbles/FINETUNE.md). Read-only: the database is opened
// with `readOnly`, so a running app is not disturbed and nothing is written back. Every message goes
// through the same redaction as the logs before it is written.
//
//   bun scripts/export-conversations.ts --list
//   bun scripts/export-conversations.ts --agent=chief [--db=<path>] [--max-messages=40] [--out=<file>]
//
// Each line is one conversation window: {"messages":[{"role":"user"|"assistant","content":"..."}]}.

import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { createOpenBotLogger, redactText } from "@openbot/logging";
import { developmentInstanceIdForWorktree, developmentUserDataName } from "../src/main/development-profile";

const logger = createOpenBotLogger("export-conversations");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

interface Options {
  db: string;
  agent: string | null;
  list: boolean;
  maxMessages: number;
  out: string | null;
}

function appDataDirectory(): string {
  if (process.platform === "darwin") return join(homedir(), "Library", "Application Support");
  if (process.platform === "win32") return process.env.APPDATA ?? join(homedir(), "AppData", "Roaming");
  return process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config");
}

function parseOptions(argv: readonly string[]): Options {
  const value = (name: string) => argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) ?? null;
  // This checkout's dev profile by default: the one `bun run dev` opens.
  const defaultDb = join(
    appDataDirectory(),
    developmentUserDataName("app", developmentInstanceIdForWorktree(root)),
    "openbot.db",
  );
  const maxMessages = Number(value("max-messages") ?? 40);
  return {
    db: resolve(value("db") ?? defaultDb),
    agent: value("agent"),
    list: argv.includes("--list"),
    maxMessages: Number.isInteger(maxMessages) && maxMessages >= 2 ? maxMessages : 40,
    out: value("out"),
  };
}

interface Turn {
  role: "user" | "assistant";
  content: string;
}

/**
 * A stored message as training text, or null. Only what a person typed and what the agent answered
 * count: tool steps, questions the agent asked through a card, images and agent-to-agent exchanges
 * are not a model's reply to its user.
 */
export function messageTurn(author: string, itemType: string | null, json: string): Turn | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return null;
  }
  if (!isDynamicRecord(parsed) || typeof parsed.text !== "string") return null;
  const text = parsed.text.trim();
  if (!text) return null;
  if (author === "user" && (itemType === null || itemType === "")) return { role: "user", content: redactText(text) };
  if (author === "assistant" && itemType === "agentMessage") return { role: "assistant", content: redactText(text) };
  return null;
}

/** Splits a thread into windows that start with the user and end with the assistant. */
export function conversationWindows(turns: readonly Turn[], maxMessages: number): Turn[][] {
  const merged: Turn[] = [];
  for (const turn of turns) {
    const last = merged.at(-1);
    // Two replies in a row read as one: training formats want the roles to alternate.
    if (last && last.role === turn.role) last.content = `${last.content}\n\n${turn.content}`;
    else merged.push({ ...turn });
  }
  const windows: Turn[][] = [];
  let current: Turn[] = [];
  for (const turn of merged) {
    if (current.length === 0 && turn.role !== "user") continue;
    current.push(turn);
    if (current.length >= maxMessages && turn.role === "assistant") {
      windows.push(current);
      current = [];
    }
  }
  if (current.at(-1)?.role === "assistant") windows.push(current);
  else if (current.length > 1) windows.push(current.slice(0, -1));
  return windows.filter((window) => window.length >= 2);
}

function main(): void {
  const options = parseOptions(process.argv.slice(2));
  const db = new DatabaseSync(options.db, { readOnly: true });
  try {
    const agents = db
      .prepare("select agent_id as id, json_extract(agent_json, '$.name') as name from projection_agents")
      .all()
      .flatMap((row) =>
        isDynamicRecord(row) && typeof row.id === "string" ? [{ id: row.id, name: String(row.name ?? "") }] : [],
      );
    if (options.list || !options.agent) {
      // Machine-readable: the agent list on stdout.
      process.stdout.write(`${JSON.stringify(agents, null, 2)}\n`);
      if (!options.agent) logger.info("Pass --agent=<id or name> to export one agent.");
      return;
    }
    const wanted = options.agent.toLowerCase();
    const agent = agents.find((candidate) => candidate.id === options.agent || candidate.name.toLowerCase() === wanted);
    if (!agent) throw new Error(`No agent "${options.agent}" in ${options.db}. Use --list.`);
    const threads = db
      .prepare("select thread_id from projection_threads where agent_id = ? order by created_at")
      .all(agent.id)
      .flatMap((row) => (isDynamicRecord(row) && typeof row.thread_id === "string" ? [row.thread_id] : []));
    const messages = db.prepare(
      "select author, item_type, message_json from projection_thread_messages where thread_id = ? order by created_at, ordinal",
    );
    const lines: string[] = [];
    for (const threadId of threads) {
      const turns = messages
        .all(threadId)
        .flatMap((row) =>
          isDynamicRecord(row) && typeof row.author === "string" && typeof row.message_json === "string"
            ? [messageTurn(row.author, typeof row.item_type === "string" ? row.item_type : null, row.message_json)]
            : [],
        )
        .filter((turn): turn is Turn => turn !== null);
      for (const window of conversationWindows(turns, options.maxMessages))
        lines.push(JSON.stringify({ messages: window }));
    }
    const out = resolve(options.out ?? join(root, ".openbot-build", "exports", `${agent.id}.jsonl`));
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, lines.length > 0 ? `${lines.join("\n")}\n` : "");
    logger.info(`Wrote ${lines.length} conversations of ${agent.name} from ${threads.length} threads to ${out}.`);
  } finally {
    db.close();
  }
}

if (import.meta.main) main();
