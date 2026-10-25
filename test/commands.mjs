/**
 * Smoke test for /ping and /status without a live gateway connection.
 * Run: node test/commands.mjs
 */
import assert from 'node:assert/strict';
import { Collection, version as discordVersion } from 'discord.js';
import { config, models } from '../src/config.js';
import { providerName } from '../src/providers/index.js';
import { checkProvider } from '../src/providers/fal.js';
import ping from '../src/commands/ping.js';
import status from '../src/commands/status.js';

const realFetch = globalThis.fetch;

function fakeClient() {
  return {
    ws: { ping: 42, shards: new Collection([[0, { id: 0 }]]) },
    uptime: 3_725_000,
    guilds: { cache: new Collection() },
  };
}

function fakeInteraction() {
  const edits = [];
  const replies = [];
  return {
    client: fakeClient(),
    createdTimestamp: Date.now(),
    replies,
    edits,
    reply: async (payload) => replies.push(payload),
    deferReply: async () => {},
    editReply: async (payload) => edits.push(payload),
  };
}

const pingInteraction = fakeInteraction();
await ping.execute(pingInteraction);
assert.equal(pingInteraction.replies.length, 1, '/ping must reply once');
assert.equal(pingInteraction.edits.length, 1, '/ping must edit the reply with final numbers');
const pingEmbed = pingInteraction.edits[0].embeds[0];
assert.match(pingEmbed.title, /Понг/i);
assert.ok(pingEmbed.fields.some((field) => field.name === 'WebSocket (heartbeat)'));
console.log('ok  /ping builds latency embed');

// /status probes the provider for key/balance state — answer with a fake 422.
config.kieKey = '';
config.falKey = 'test-key';
assert.equal(providerName(), 'fal.ai');
globalThis.fetch = async () => new Response('{"detail":"prompt required"}', { status: 422 });

const statusInteraction = fakeInteraction();
await status.execute(statusInteraction);
const statusEmbed = statusInteraction.edits[0].embeds[0];
assert.match(statusEmbed.title, /Статус/);
assert.ok(statusEmbed.fields.some((field) => field.name === 'Пинг'));
assert.ok(statusEmbed.fields.some((field) => field.value.includes(discordVersion)));
assert.ok(statusEmbed.fields.some((field) => field.name === 'Модели'));
assert.ok(
  statusEmbed.fields.some((field) => field.name.includes('Провайдер видео') && field.value.includes('✅')),
  '/status must report a healthy provider',
);
console.log('ok  /status builds status embed with provider health');

// Locked account must be reported as such (refresh the cached probe first).
globalThis.fetch = async () =>
  new Response('{"detail":"User is locked. Reason: Exhausted balance."}', { status: 403 });
await checkProvider({ ttlMs: 0 });
const blockedInteraction = fakeInteraction();
await status.execute(blockedInteraction);
const blockedEmbed = blockedInteraction.edits[0].embeds[0];
assert.ok(
  blockedEmbed.fields.some((field) => field.name.includes('Провайдер') && /баланс/i.test(field.value)),
  '/status must show exhausted balance',
);
console.log('ok  /status reports exhausted balance');

globalThis.fetch = realFetch;
console.log('\ncommand tests passed');
