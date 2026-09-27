/**
 * Hand-in content encoding (docs/CLASSROOM.md §2.8, §4.5): the sketch and the blocks workspace
 * are stored as gzip bytes when the browser can compress and it is smaller, else as plain strings.
 * Decoding inflates with a cap, so a gzip bomb in a crafted hand-in cannot exhaust the dashboard.
 * Pure: no Firebase (student.ts / teacher.ts convert Uint8Array ↔ Firestore Bytes).
 */
import { LIMITS, utf8Length } from './model';

export type ContentEncoding = 'plain' | 'gzip';
export interface EncodedContent {
  enc: ContentEncoding;
  code: string | Uint8Array;
  workspace: string | Uint8Array;
}
export type DecodeResult =
  | { ok: true; code: string; workspaceJson: string }
  | { ok: false; problem: 'too_large' | 'corrupt' | 'unsupported' };

const EMPTY = new Uint8Array(0);

async function gzip(text: string): Promise<Uint8Array> {
  const stream = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Inflate `bytes`; null once the output would exceed `maxBytes` (the stream is cancelled). */
async function gunzipCapped(bytes: Uint8Array, maxBytes: number): Promise<string | null> {
  const reader = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip')).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return new TextDecoder('utf-8', { fatal: true }).decode(out);
}

/**
 * gzip both fields when CompressionStream exists and the gzip total is smaller; else plain strings.
 * An empty workspace (Code mode) becomes empty bytes under gzip, as the rules require.
 */
export async function encodeContent(
  code: string,
  workspaceJson: string,
  options: { compress?: boolean } = {},
): Promise<EncodedContent> {
  const plain: EncodedContent = { enc: 'plain', code, workspace: workspaceJson };
  if (options.compress === false || typeof CompressionStream === 'undefined') return plain;
  try {
    const codeBytes = await gzip(code);
    const workspaceBytes = workspaceJson === '' ? EMPTY : await gzip(workspaceJson);
    const rawTotal = utf8Length(code) + utf8Length(workspaceJson);
    if (codeBytes.length + workspaceBytes.length >= rawTotal) return plain;
    return { enc: 'gzip', code: codeBytes, workspace: workspaceBytes };
  } catch {
    return plain;
  }
}

async function decodeField(value: string | Uint8Array, enc: ContentEncoding, cap: number): Promise<DecodeResult> {
  if (enc === 'plain') {
    if (typeof value !== 'string') return { ok: false, problem: 'corrupt' };
    return utf8Length(value) > cap ? { ok: false, problem: 'too_large' } : { ok: true, code: value, workspaceJson: '' };
  }
  if (typeof value === 'string') return { ok: false, problem: 'corrupt' };
  if (value.length === 0) return { ok: true, code: '', workspaceJson: '' };
  if (typeof DecompressionStream === 'undefined') return { ok: false, problem: 'unsupported' };
  try {
    const text = await gunzipCapped(value, cap);
    return text === null ? { ok: false, problem: 'too_large' } : { ok: true, code: text, workspaceJson: '' };
  } catch {
    return { ok: false, problem: 'corrupt' };
  }
}

/** Inflate with LIMITS.*DecodeCap; 'unsupported' when DecompressionStream is missing. */
export async function decodeContent(content: EncodedContent): Promise<DecodeResult> {
  const enc: ContentEncoding = content.enc === 'gzip' ? 'gzip' : 'plain';
  const code = await decodeField(content.code, enc, LIMITS.codeDecodeCap);
  if (!code.ok) return code;
  const workspace = await decodeField(content.workspace, enc, LIMITS.workspaceDecodeCap);
  if (!workspace.ok) return workspace;
  return { ok: true, code: code.code, workspaceJson: workspace.code };
}
