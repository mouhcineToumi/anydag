/**
 * Where a chat is kept: files in its home vault, which is what lets
 * vault sync carry it to another machine.
 *
 *     <vault>/.anydag/chats/<chatId>/chat.json             written whenever the chat changes
 *     <vault>/.anydag/chats/<chatId>/<turnId>.json         one turn, written once when it ends
 *     <vault>/.anydag/chats/<chatId>/undo/<id>.json        one undo or redo, written once
 *
 * **Every file but `chat.json` is written once**, so two machines never edit one file and sync never
 * has to merge one. Ids sort by time and carry the device, so the order needs no index and two
 * machines never mint the same one. What is this machine's alone — the device id, the provider
 * session a turn can resume, and the other vaults the person let a chat reach — is kept in the
 * home's `kv`, never in the vault.
 *
 * **A grant is authority, so it is never read from the vault** (#9). `chat.json` syncs, and anyone
 * who writes the vault's folder writes it: a `grant:<vault>` planted there would have let a chat
 * read and change another vault with nobody asked. The person grants on this machine — the access
 * card or the scope menu — and that is what `grants()` answers; a `grant:` key in the file is not
 * read at all.
 */

import fs from "node:fs";
import path from "node:path";

import type { Home } from "../home";
import { ALPHABET } from "../ids";
import { writeAtomic } from "../vault";
import { isOp } from "./record";
import type { ChatMeta, ChatRow, Mode, Provider, Turn, UndoRecord } from "./types";

/** What this machine let a chat reach: `null` is a grant taken back, kept so undo knows it was given once. */
export type Grants = Record<string, { mode: Mode; at: string } | null>;

const CHATS = ".anydag/chats";

const CHAT_ID = /^c[0-9a-z]{9}[0-9a-z]{4}[0-9a-z]{4}$/;
const STEP_ID = /^[tu][0-9a-z]{9}[0-9a-z]{4}[0-9a-z]{4}$/;

const rand = (n: number): string => {
  let out = "";
  for (let i = 0; i < n; i++) out += ALPHABET[Math.floor(Math.random() * 32)];
  return out;
};

/** This machine, as four characters: minted once, kept in the home. */
function deviceOf(home: Home): string {
  let d = home.get("chat-device");
  if (!d || !/^[0-9a-z]{4}$/.test(d)) {
    d = rand(4);
    home.set("chat-device", d);
  }
  return d;
}

let lastMs = 0;
/** `<prefix><time, base 36, 9 wide><device><random>`: sorts by when, never collides across machines. */
export function newId(prefix: "c" | "t" | "u" | "b", device: string): string {
  let ms = Date.now();
  if (ms <= lastMs) ms = lastMs + 1;
  lastMs = ms;
  return `${prefix}${ms.toString(36).padStart(9, "0")}${device}${rand(4)}`;
}

export const validChatId = (id: unknown): id is string => typeof id === "string" && CHAT_ID.test(id);

const dirOf = (root: string, chat: string): string => path.join(root, CHATS, chat);

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
}

/*
 * A turn or an undo file is read back from the vault, and anybody who can write the vault can write
 * one: one without the shape the page and undo rely on is not read at all. The paths in its ops are
 * checked again by `undo`, whatever the shape.
 */
const str = (v: unknown): v is string => typeof v === "string";
const ops = (v: unknown): boolean => Array.isArray(v) && v.every(isOp);

function isTurn(t: unknown, id: string, chat: string): t is Turn {
  if (!t || typeof t !== "object") return false;
  const o = t as Record<string, unknown>;
  if (o.id !== id || o.chat !== chat || !Array.isArray(o.steps) || !Array.isArray(o.blocks)) return false;
  return o.blocks.every((b: unknown) => {
    if (!b || typeof b !== "object") return false;
    const k = b as Record<string, unknown>;
    return str(k.id) && str(k.title) && ops(k.ops);
  });
}

function isUndo(u: unknown, id: string, chat: string): u is UndoRecord {
  if (!u || typeof u !== "object") return false;
  const o = u as Record<string, unknown>;
  return (
    o.id === id &&
    o.chat === chat &&
    str(o.turn) &&
    str(o.block) &&
    typeof o.redo === "boolean" &&
    ops(o.ops) &&
    Array.isArray(o.conflicts)
  );
}

const json = (v: unknown): string => `${JSON.stringify(v, null, 1)}\n`;

/** One file written once: refused if it is there, so a second write is a bug and not a silent loss. */
function writeOnce(file: string, v: unknown): void {
  if (fs.existsSync(file)) throw new Error(`${path.basename(file)} is already written`);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  writeAtomic(file, json(v));
}

export class ChatStore {
  constructor(readonly home: Home) {}

  get device(): string {
    return deviceOf(this.home);
  }

  create(root: string, meta: Omit<ChatMeta, "v" | "id" | "created">): ChatMeta {
    const chat: ChatMeta = { v: 1, id: newId("c", this.device), created: new Date().toISOString(), ...meta } as ChatMeta;
    const dir = dirOf(root, chat.id);
    fs.mkdirSync(dir, { recursive: true });
    writeAtomic(path.join(dir, "chat.json"), json(chat));
    return chat;
  }

  meta(root: string, chat: string): ChatMeta | null {
    const m = readJson<ChatMeta>(path.join(dirOf(root, chat), "chat.json"));
    return m && m.id === chat ? m : null;
  }

  /** Change `chat.json`: read it, apply `fn`, write it. Keys are never removed, only set. */
  update(root: string, chat: string, fn: (m: ChatMeta) => void): ChatMeta {
    const m = this.meta(root, chat);
    if (!m) throw new Error(`no chat \`${chat}\``);
    fn(m);
    writeAtomic(path.join(dirOf(root, chat), "chat.json"), json(m));
    return m;
  }

  turns(root: string, chat: string): Turn[] {
    const dir = dirOf(root, chat);
    let names: string[];
    try {
      names = fs.readdirSync(dir);
    } catch {
      return [];
    }
    const out: Turn[] = [];
    for (const n of names.sort()) {
      if (!n.endsWith(".json") || !STEP_ID.test(n.slice(0, -5)) || !n.startsWith("t")) continue;
      const t = readJson<unknown>(path.join(dir, n));
      if (isTurn(t, n.slice(0, -5), chat)) out.push(t);
    }
    return out;
  }

  undos(root: string, chat: string): UndoRecord[] {
    const dir = path.join(dirOf(root, chat), "undo");
    let names: string[];
    try {
      names = fs.readdirSync(dir);
    } catch {
      return [];
    }
    const out: UndoRecord[] = [];
    for (const n of names.sort()) {
      if (!n.endsWith(".json") || !STEP_ID.test(n.slice(0, -5))) continue;
      const u = readJson<unknown>(path.join(dir, n));
      if (isUndo(u, n.slice(0, -5), chat)) out.push(u);
    }
    return out;
  }

  writeTurn(root: string, turn: Turn): void {
    writeOnce(path.join(dirOf(root, turn.chat), `${turn.id}.json`), turn);
  }

  writeUndo(root: string, rec: UndoRecord): void {
    writeOnce(path.join(dirOf(root, rec.chat), "undo", `${rec.id}.json`), rec);
  }

  /** Every chat kept in `root`, newest activity first. */
  list(root: string, vault: string, running: (id: string) => boolean): ChatRow[] {
    let names: string[];
    try {
      names = fs.readdirSync(path.join(root, CHATS));
    } catch {
      return [];
    }
    const out: ChatRow[] = [];
    for (const id of names) {
      if (!validChatId(id)) continue;
      const m = this.meta(root, id);
      if (!m) continue;
      let updated = m.created;
      try {
        const last = fs
          .readdirSync(dirOf(root, id))
          .filter((n) => n.startsWith("t") && n.endsWith(".json"))
          .sort()
          .pop();
        if (last) updated = new Date(parseInt(last.slice(1, 10), 36)).toISOString();
      } catch {
        /* gone while listed */
      }
      out.push({
        id,
        title: m.title,
        vault,
        created: m.created,
        updated,
        provider: m.provider,
        model: m.model,
        running: running(id),
      });
    }
    return out.sort((a, b) => (a.updated < b.updated ? 1 : -1));
  }

  remove(root: string, chat: string): void {
    fs.rmSync(dirOf(root, chat), { recursive: true, force: true });
    for (const p of ["claude", "opencode"] as const) this.home.set(sessionKey(chat, p), null);
    this.home.set(grantsKey(chat), null);
  }

  /** The vaults the person let this chat reach, on this machine. A record that is not one is none. */
  grants(chat: string): Grants {
    const raw = this.home.get(grantsKey(chat));
    if (!raw) return {};
    let got: unknown;
    try {
      got = JSON.parse(raw);
    } catch {
      return {};
    }
    if (!got || typeof got !== "object" || Array.isArray(got)) return {};
    const out: Grants = {};
    for (const [vault, g] of Object.entries(got as Record<string, unknown>)) {
      if (g === null) out[vault] = null;
      else if (g && typeof g === "object") {
        const { mode, at } = g as { mode?: unknown; at?: unknown };
        if ((mode === "ask" || mode === "edit") && typeof at === "string") out[vault] = { mode, at };
      }
    }
    return out;
  }

  /** Grant `vault`, or take it back with `null`. Only the person's answer calls this. */
  setGrant(chat: string, vault: string, grant: { mode: Mode; at: string } | null): void {
    this.home.set(grantsKey(chat), JSON.stringify({ ...this.grants(chat), [vault]: grant }));
  }

  /** The provider session this machine can resume, and the model it was made on. */
  session(chat: string, provider: Provider): { id: string; model: string; turn: string } | null {
    const raw = this.home.get(sessionKey(chat, provider));
    if (!raw) return null;
    try {
      return JSON.parse(raw) as { id: string; model: string; turn: string };
    } catch {
      return null;
    }
  }

  setSession(chat: string, provider: Provider, s: { id: string; model: string; turn: string } | null): void {
    this.home.set(sessionKey(chat, provider), s ? JSON.stringify(s) : null);
  }
}

const sessionKey = (chat: string, provider: Provider): string => `chat-session:${chat}:${provider}`;
const grantsKey = (chat: string): string => `chat-grants:${chat}`;
