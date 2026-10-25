import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const TEMP_DIR = path.join(os.tmpdir(), 'wasted-ai-video-bot');

async function ensureTempDir() {
  await fs.mkdir(TEMP_DIR, { recursive: true });
  return TEMP_DIR;
}

/**
 * Download a generated video to the temp folder.
 * Returns { path, size } on success or { tooLarge: true, size } when the file
 * exceeds `maxBytes` (so we can fall back to posting a link).
 */
export async function downloadVideo(url, requestId, maxBytes) {
  const safeId = String(requestId).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64) || 'video';
  const target = path.join(await ensureTempDir(), `${safeId}.mp4`);

  let expectedSize = null;
  try {
    const head = await fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(20_000) });
    const header = head.headers.get('content-length');
    if (header) expectedSize = Number(header);
  } catch {
    /* HEAD may be unsupported — continue with a normal download */
  }

  if (Number.isFinite(expectedSize) && expectedSize > maxBytes) {
    return { tooLarge: true, size: expectedSize, url };
  }

  const response = await fetch(url, { signal: AbortSignal.timeout(180_000) });
  if (!response.ok) {
    throw new Error(`Не удалось скачать видео (HTTP ${response.status}).`);
  }

  // Stream to disk with a hard cap so a huge file can never eat all the RAM.
  const chunks = [];
  let total = 0;
  for await (const chunk of response.body) {
    total += chunk.byteLength;
    if (total > maxBytes) {
      return { tooLarge: true, size: total, url };
    }
    chunks.push(chunk);
  }

  await fs.writeFile(target, Buffer.concat(chunks));
  return { path: target, size: total };
}

export async function removeFile(filePath) {
  if (!filePath) return;
  await fs.unlink(filePath).catch(() => {});
}
