import { config } from '../config.js';
import { ProviderError } from './errors.js';

const API_BASE = 'https://api.kie.ai/api/v1';
const REQUEST_TIMEOUT_MS = 60_000;

export const name = 'kie.ai';
export const keyName = 'KIE_API_KEY';

export function hasKey() {
  return Boolean(config.kieKey);
}

const CREDIT_MESSAGE = 'На балансе kie.ai недостаточно кредитов. Пополни: https://kie.ai/pricing';

function describeHttp(status) {
  switch (status) {
    case 401:
      return 'Неверный KIE_API_KEY. Проверь ключ в файле .env.';
    case 402:
      return CREDIT_MESSAGE;
    case 404:
      return 'kie.ai не нашёл задачу или модель.';
    case 429:
      return 'Слишком много запросов к kie.ai. Попробуй чуть позже.';
    default:
      return status >= 500
        ? 'Сервис kie.ai временно недоступен. Попробуй позже.'
        : `Ошибка провайдера kie.ai (HTTP ${status}).`;
  }
}

/** kie.ai reports errors inside a 200 response — map its numeric `code`. */
function describeCode(code, msg) {
  switch (Number(code)) {
    case 401:
      return 'Неверный KIE_API_KEY. Проверь ключ в файле .env.';
    case 402:
      return CREDIT_MESSAGE;
    case 404:
      return 'kie.ai не нашёл задачу или модель.';
    case 408:
      return 'kie.ai не успел сгенерировать видео за 10 минут.';
    case 422:
      return 'kie.ai отклонил параметры запроса.';
    case 429:
      return 'Слишком много запросов к kie.ai. Попробуй чуть позже.';
    case 433:
    case 455:
      return 'Сервис kie.ai на техобслуживании. Попробуй позже.';
    case 501:
      return 'kie.ai не смог сгенерировать видео по этому промпту.';
    case 505:
      return 'Эта функция kie.ai сейчас отключена.';
    default:
      return `Ошибка провайдера kie.ai (код ${code})${msg ? `: ${msg}` : ''}.`;
  }
}

async function apiRequest(path, { method = 'GET', body } = {}) {
  if (!config.kieKey) {
    throw new ProviderError('KIE_API_KEY не настроен.', { status: 401 });
  }

  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${config.kieKey}`,
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new ProviderError(`Не удалось связаться с kie.ai: ${error.message}`, { retryable: true });
  }

  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    throw new ProviderError(describeHttp(response.status), {
      status: response.status,
      detail: text.slice(0, 500) || null,
      retryable: response.status === 429 || response.status >= 500,
    });
  }

  const code = payload?.code;
  if (code !== undefined && Number(code) !== 200) {
    throw new ProviderError(describeCode(code, payload?.msg), {
      status: Number(code),
      detail: payload?.msg ?? null,
      retryable: [408, 429, 433, 455, 500].includes(Number(code)),
    });
  }

  return payload ?? {};
}

/** Omni on kie.ai only accepts 4/6/8/10 seconds — snap the requested duration. */
function snapOmniDuration(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds)) return '8';
  if (seconds <= 4) return '4';
  if (seconds <= 6) return '6';
  if (seconds <= 8) return '8';
  return '10';
}

/**
 * Translate semantic parameters into the provider payload.
 * `params`: { prompt, duration, aspectRatio, resolution, audio }
 */
export function buildInput(model, params) {
  if (model.key === 'seedance') {
    return {
      prompt: params.prompt,
      duration: params.duration === 'auto' || params.duration === undefined ? -1 : Number(params.duration),
      aspect_ratio: !params.aspectRatio || params.aspectRatio === 'auto' ? 'adaptive' : params.aspectRatio,
      resolution: params.resolution ?? '720p',
      generate_audio: params.audio ?? true,
    };
  }

  return {
    prompt: params.prompt,
    duration: snapOmniDuration(params.duration ?? 8),
    aspect_ratio: params.aspectRatio === '9:16' ? '9:16' : '16:9',
    resolution: params.resolution ?? '720p',
  };
}

export async function submit(model, input) {
  const payload = await apiRequest('/jobs/createTask', {
    method: 'POST',
    body: { model: model.kieModel, input },
  });

  const taskId = payload?.data?.taskId;
  if (!taskId) {
    throw new ProviderError('kie.ai не вернул идентификатор задачи.', {
      detail: JSON.stringify(payload).slice(0, 300),
    });
  }
  return { taskId };
}

export async function fetchTask(taskId) {
  const payload = await apiRequest(`/jobs/recordInfo?taskId=${encodeURIComponent(taskId)}`);
  return payload?.data ?? {};
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Health/credit probe: `/chat/credit` is free and reports the real balance,
 * so /status can show why a generation would fail.
 */
let healthCache = { at: 0, value: null };

export async function checkProvider({ ttlMs = 60_000 } = {}) {
  if (!config.kieKey) {
    return { state: 'no-key', ok: false, message: 'KIE_API_KEY не задан' };
  }
  if (healthCache.value && Date.now() - healthCache.at < ttlMs) {
    return healthCache.value;
  }

  let result;
  try {
    const payload = await apiRequest('/chat/credit');
    const credits = Number(payload?.data ?? 0);
    if (!Number.isFinite(credits) || credits <= 0) {
      result = {
        state: 'no-balance',
        ok: false,
        credits: 0,
        message: 'Кредиты kie.ai закончились — пополни на kie.ai/pricing',
      };
    } else {
      result = {
        state: 'ok',
        ok: true,
        credits,
        message: `Ключ активен, кредитов: ${credits.toFixed(2)}`,
      };
    }
  } catch (error) {
    const state = error?.status === 401 ? 'bad-key' : 'unreachable';
    result = { state, ok: false, message: error.message };
  }

  healthCache = { at: Date.now(), value: result };
  return result;
}

/**
 * Submit a generation job, poll it until completion and return the video URL.
 * `onProgress` receives { requestId, status, elapsedMs } on every poll.
 */
export async function generate(model, params, options = {}) {
  const {
    onProgress = null,
    pollIntervalMs = config.pollIntervalMs,
    timeoutMs = config.generationTimeoutMs,
  } = options;

  const job = await submit(model, buildInput(model, params));
  const startedAt = Date.now();

  for (;;) {
    await sleep(pollIntervalMs);
    const elapsedMs = Date.now() - startedAt;

    if (elapsedMs > timeoutMs) {
      const timeoutError = new ProviderError('Превышено время ожидания генерации.', { status: 504 });
      timeoutError.requestId = job.taskId;
      throw timeoutError;
    }

    let task;
    try {
      task = await fetchTask(job.taskId);
    } catch (error) {
      onProgress?.({ requestId: job.taskId, elapsedMs, status: 'IN_PROGRESS', transientError: error });
      continue;
    }

    const state = task.state ?? 'waiting';
    onProgress?.({
      requestId: job.taskId,
      elapsedMs,
      status: state === 'waiting' || state === 'queuing' ? 'IN_QUEUE' : 'IN_PROGRESS',
    });

    if (state === 'success') {
      let parsed = null;
      try {
        parsed = task.resultJson ? JSON.parse(task.resultJson) : null;
      } catch {
        parsed = null;
      }
      const videoUrl = parsed?.resultUrls?.[0];
      if (!videoUrl) {
        throw new ProviderError('kie.ai вернул ответ без ссылки на видео.', {
          detail: String(task.resultJson ?? '').slice(0, 300),
        });
      }
      return {
        videoUrl,
        requestId: job.taskId,
        elapsedMs,
        credits: task.creditsConsumed ?? null,
        result: parsed,
      };
    }

    if (state === 'fail') {
      throw new ProviderError(
        `kie.ai не смог сгенерировать видео${task.failMsg ? `: ${task.failMsg}` : '.'}`,
        { status: Number(task.failCode) || 501, detail: task.failMsg ?? null },
      );
    }
  }
}
