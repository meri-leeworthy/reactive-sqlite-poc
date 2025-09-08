import type { AnyEvent } from "../lib/db/types/events";
import { executeQuery } from "./setup-sqlite";

function encodeJsonToBlob(data: unknown): Uint8Array {
  const json = JSON.stringify(data);
  return new TextEncoder().encode(json);
}

function ulidToBytes(ulid: string): Uint8Array {
  const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
  const map: Record<string, number> = {};
  for (let i = 0; i < alphabet.length; i++) {
    const ch = alphabet.charAt(i);
    map[ch] = i;
    map[ch.toLowerCase()] = i;
  }
  const out = new Uint8Array(16);
  let bits = 0;
  let value = 0;
  let idx = 0;
  for (let i = 0; i < ulid.length && idx < 16; i++) {
    const c = ulid.charAt(i);
    const v = map[c];
    if (v === undefined) continue;
    value = (value << 5) | v;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out[idx++] = (value >>> bits) & 0xff;
      value = value & ((1 << bits) - 1);
    }
  }
  if (idx === 16) return out;
  // Fallback to ASCII bytes if decoding failed
  return new TextEncoder().encode(ulid);
}

type PreparedRow = [
  eventId: Uint8Array,
  entityIdOrNull: null | Uint8Array,
  payload: Uint8Array,
  createdAtMs: number,
];

function prepareRow(e: AnyEvent): PreparedRow {
  const eventId = ulidToBytes((e as { eventId: string }).eventId);
  const entityId: string | undefined = (e as { entityId?: string }).entityId;
  const entityBlob = entityId ? ulidToBytes(entityId) : null;
  const payload = encodeJsonToBlob(e);
  const createdAt = (e as { createdAt?: number }).createdAt ?? Date.now();
  return [eventId, entityBlob, payload, createdAt];
}

function buildInsert(rows: number): { sql: string; bind: unknown[] } {
  const values = new Array(rows).fill("(?, ?, ?, ?)").join(", ");
  const sql = `BEGIN IMMEDIATE; INSERT INTO events (event_ulid, entity_ulid, payload, created_at) VALUES ${values}; COMMIT;`;
  return { sql, bind: [] };
}

export async function ingestEvents(
  events: AnyEvent | AnyEvent[],
): Promise<{ ok: true; inserted: number }> {
  const list = Array.isArray(events) ? events : [events];
  if (list.length === 0) return { ok: true, inserted: 0 };

  const rows = list.map(prepareRow);
  const { sql } = buildInsert(rows.length);
  const bind: unknown[] = [];
  for (const [eventId, entityIdOrNull, payload, createdAtMs] of rows) {
    bind.push(eventId, entityIdOrNull, payload, createdAtMs);
  }
  await executeQuery(sql, bind);
  return { ok: true, inserted: rows.length };
}
