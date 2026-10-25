/**
 * Offline smoke test: mocks fal.ai / kie.ai and video downloads, then verifies
 * the whole generation flow (submit -> poll -> download -> reply), provider
 * switching and error mapping. Run: node test/smoke.mjs
 */
import assert from 'node:assert/strict';
import { config, models } from '../src/config.js';
import { ProviderError } from '../src/providers/errors.js';
import { buildInput as kieInput, checkProvider as checkKie } from '../src/providers/kie.js';
import { generate } from '../src/providers/index.js';
import { runGeneration } from '../src/commands/generation.js';

const realFetch = globalThis.fetch;
let submittedBody = null;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function fakeInteraction() {
  const calls = { replies: [], edits: [], deferred: false };
  return {
    user: { id: 'user_1' },
    memberPermissions: { has: () => true },
    client: {},
    createdTimestamp: Date.now(),
    calls,
    reply: async (payload) => {
      calls.replies.push(payload);
      return { id: 'msg_1' };
    },
    deferReply: async () => {
      calls.deferred = true;
    },
    editReply: async (payload) => {
      calls.edits.push(payload);
      return { id: 'msg_1' };
    },
  };
}

function mockVideoDownload(url) {
  if (url.endsWith('.mp4')) {
    return new Response(Buffer.alloc(1024, 1), { status: 200 });
  }
  return null;
}

// ---------------------------------------------------------------- fal.ai flow
config.falKey = 'test-key';
config.kieKey = '';
config.pollIntervalMs = 5;

let falPolls = 0;
globalThis.fetch = async (url, options = {}) => {
  const href = String(url);
  const method = (options.method ?? 'GET').toUpperCase();

  if (href.startsWith('https://queue.fal.run/') && method === 'POST') {
    submittedBody = JSON.parse(options.body);
    assert.equal(options.headers.Authorization, 'Key test-key');
    return json({
      request_id: 'req_123',
      status: 'IN_QUEUE',
      status_url: 'https://queue.fal.run/mock/requests/req_123/status',
      response_url: 'https://queue.fal.run/mock/requests/req_123',
    });
  }

  if (href.endsWith('/status')) {
    falPolls += 1;
    if (falPolls === 1) return json({ status: 'IN_QUEUE', queue_position: 2, request_id: 'req_123' });
    return json({ status: 'COMPLETED', request_id: 'req_123' });
  }

  if (href === 'https://queue.fal.run/mock/requests/req_123') {
    return json({ video: { url: 'https://fal.media/out.mp4' }, seed: 42 });
  }

  const download = mockVideoDownload(href);
  if (download) return download;

  throw new Error(`unexpected fetch: ${method} ${href}`);
};

const progressEvents = [];
const falResult = await generate(
  models.seedance,
  { prompt: 'test prompt', duration: '5' },
  { onProgress: (p) => progressEvents.push(p) },
);
assert.equal(falResult.requestId, 'req_123');
assert.equal(falResult.videoUrl, 'https://fal.media/out.mp4');
assert.equal(submittedBody.prompt, 'test prompt');
assert.equal(submittedBody.duration, '5');
assert.equal(submittedBody.generate_audio, true);
assert.ok(progressEvents.length >= 2, 'progress should be reported on every poll');
console.log('ok  fal.ai submit → poll → result');

const falInteraction = fakeInteraction();
await runGeneration(falInteraction, {
  model: models.seedance,
  prompt: 'a cat surfing on a wave at sunset',
  params: { prompt: 'a cat surfing on a wave at sunset', duration: '5' },
});
assert.ok(falInteraction.calls.deferred, 'interaction must be deferred');
const falFinal = falInteraction.calls.edits.at(-1);
assert.ok(falFinal.files?.length === 1, 'final reply must attach the video file');
assert.match(falFinal.embeds[0].title, /готово/i);
console.log('ok  /generate_seedance happy path (video attached)');

config.falKey = '';
const noKeyInteraction = fakeInteraction();
await runGeneration(noKeyInteraction, {
  model: models.omni,
  prompt: 'test',
  params: { prompt: 'test' },
});
assert.equal(noKeyInteraction.calls.replies.length, 1);
assert.match(JSON.stringify(noKeyInteraction.calls.replies[0]), /FAL_KEY/);
console.log('ok  missing API key is reported to the user');

config.falKey = 'bad-key';
globalThis.fetch = async () => json({ detail: 'invalid key' }, 401);
await assert.rejects(
  () => generate(models.omni, { prompt: 'x' }, { pollIntervalMs: 1 }),
  (error) => error instanceof ProviderError && error.status === 401 && /FAL_KEY/.test(error.message),
);
console.log('ok  fal.ai errors are mapped to readable messages');

// ---------------------------------------------------------------- kie.ai flow
// Setting KIE_API_KEY switches the provider automatically.
config.kieKey = 'kie-key';
config.falKey = '';

let kiePolls = 0;
let kieAuth = null;
let kiePayload = null;
globalThis.fetch = async (url, options = {}) => {
  const href = String(url);
  const method = (options.method ?? 'GET').toUpperCase();

  if (href === 'https://api.kie.ai/api/v1/jobs/createTask' && method === 'POST') {
    kieAuth = options.headers.Authorization;
    kiePayload = JSON.parse(options.body);
    return json({ code: 200, msg: 'success', data: { taskId: 'task_1' } });
  }

  if (href.startsWith('https://api.kie.ai/api/v1/jobs/recordInfo')) {
    kiePolls += 1;
    if (kiePolls === 1) {
      return json({ code: 200, msg: 'success', data: { taskId: 'task_1', state: 'waiting' } });
    }
    return json({
      code: 200,
      msg: 'success',
      data: {
        taskId: 'task_1',
        state: 'success',
        resultJson: '{"resultUrls":["https://kie.media/out.mp4"]}',
        creditsConsumed: 63,
      },
    });
  }

  const download = mockVideoDownload(href);
  if (download) return download;

  throw new Error(`unexpected fetch: ${method} ${href}`);
};

const kieResult = await generate(models.seedance, {
  prompt: 'seedance via kie',
  duration: 'auto',
  aspectRatio: 'auto',
});
assert.equal(kieAuth, 'Bearer kie-key');
assert.equal(kiePayload.model, 'bytedance/seedance-2-5');
assert.equal(kiePayload.input.duration, -1, 'auto duration becomes -1 on kie.ai');
assert.equal(kiePayload.input.aspect_ratio, 'adaptive');
assert.equal(kieResult.videoUrl, 'https://kie.media/out.mp4');
assert.equal(kieResult.credits, 63);
console.log('ok  kie.ai submit → poll → result (provider auto-switch)');

// Omni on kie.ai only accepts 4/6/8/10 seconds.
assert.equal(kieInput(models.omni, { prompt: 'x', duration: 7 }).duration, '8');
assert.equal(kieInput(models.omni, { prompt: 'x', duration: 3 }).duration, '4');
assert.equal(kieInput(models.omni, { prompt: 'x', duration: 12 }).duration, '10');
assert.equal(kieInput(models.omni, { prompt: 'x', aspectRatio: '9:16' }).aspect_ratio, '9:16');
console.log('ok  kie.ai omni parameter mapping');

const kieInteraction = fakeInteraction();
await runGeneration(kieInteraction, {
  model: models.omni,
  prompt: 'a cat surfing on a wave at sunset',
  params: { prompt: 'a cat surfing on a wave at sunset', duration: 8 },
});
const kieFinal = kieInteraction.calls.edits.at(-1);
assert.ok(kieFinal.files?.length === 1, 'kie.ai flow must attach the video file');
assert.match(kieFinal.embeds[0].title, /готово/i);
console.log('ok  /generate_omni happy path on kie.ai');

// Insufficient credits: HTTP 200 with code 402.
globalThis.fetch = async () => json({ code: 402, msg: 'insufficient credits', data: null });
await assert.rejects(
  () => generate(models.omni, { prompt: 'x' }, { pollIntervalMs: 1 }),
  (error) =>
    error instanceof ProviderError && error.status === 402 && /кредит/i.test(error.message),
);
console.log('ok  kie.ai insufficient credits are explained');

// Credit balance probe used by /status.
globalThis.fetch = async (url) => {
  assert.match(String(url), /\/chat\/credit$/);
  return json({ code: 200, msg: 'success', data: 80 });
};
const healthy = await checkKie({ ttlMs: 0 });
assert.equal(healthy.ok, true);
assert.equal(healthy.credits, 80);
assert.match(healthy.message, /80/);

globalThis.fetch = async () => json({ code: 200, msg: 'success', data: 0 });
const empty = await checkKie({ ttlMs: 0 });
assert.equal(empty.state, 'no-balance');
assert.match(empty.message, /пополни/i);
console.log('ok  kie.ai credit probe reports real balance');

globalThis.fetch = realFetch;
config.kieKey = '';
console.log('\nall smoke tests passed');
