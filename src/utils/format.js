/** Human readable duration, e.g. 1м 05с */
export function formatElapsed(ms) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds} с`;
  return `${minutes} м ${String(seconds).padStart(2, '0')} с`;
}

/** Human readable uptime, e.g. 2д 04ч 11м */
export function formatUptime(ms) {
  const totalMinutes = Math.floor(ms / 60_000);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  const parts = [];
  if (days) parts.push(`${days}д`);
  if (hours || days) parts.push(`${hours}ч`);
  parts.push(`${minutes}м`);
  return parts.join(' ');
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return '—';
  const mb = bytes / (1024 * 1024);
  return mb >= 1 ? `${mb.toFixed(1)} МБ` : `${Math.max(1, Math.round(bytes / 1024))} КБ`;
}

export function truncate(text, max = 1000) {
  if (!text) return '';
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
