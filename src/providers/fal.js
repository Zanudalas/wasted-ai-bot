import { config } from '../config.js';
import { ProviderError } from './errors.js';

const QUEUE_BASE = 'https://queue.fal.run';
const REQUEST_TIMEOUT_MS = 60_000;

export const name = 'fal.ai';
export const keyName = 'FAL_KEY';

/** Backwards-compatible alias. */
export const FalError = ProviderError;

export function hasKey() {
  return Boolean(config.falKey);
}

function describeStatus(status, detail = null) {
  if (status === 403 && /exhausted balance|locked/i.test(detail ?? '')) {
    return 'На балансе fal.ai закончились средства. Пополни баланс: https://fal.ai/dashboard/billing';
  }
  switch (status) {
    case 401:
      return 'Неверный FAL_KEY. Проверь ключ в файле .env.';
    case 403:
      return 'Доступ запрещён: ключ fal.ai не имеет прав или на балансе нет средств.';
    case 404:
      return 'Модель не найдена на fal.ai (возможно, изменился endpoint).';
    case 422:
      return 'Провайдер отклонил параметры запроса.';
    case 429:
      return 'Слишком много запросов к fal.ai. Попробуй чуть позже.';
    default:
      return status >= 500
        ? 'Сервис fal.ai временно недоступен. Попробуй позже.'
        : `Ошибка провайдера (HTTP ${status}).`;
  }
}

function extractDetail(payload, fallbackText) {
  const detail = payload?.detail;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    const parts = detail
      .map((item) => {
        if (typeof item === 'string') return item;
        const loc = Array.isArray(item?.loc) ? item.loc.join('.') : '';
        return [loc, item?.msg ?? item?.message ?? JSON.stringify(item)].filter(Boolean).join(': ');
      })
      .filter(Boolean);
    if (parts.length) return parts.join('; ');
  }
  if (payload?.message) return String(payload.message);
  return fallbackText?.slice(0, 500) ?? null;
}

async function requestJson(url, { method = 'GET', body } = {}) {
  if (!config.falKey) {
    throw new ProviderError('FAL_KEY не настроен.', { status: 401 });
  }

  let response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        Authorization: `Key ${config.falKey}`,
        'Content-Type': 'application/json',
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new ProviderError(`Не удалось связаться с fal.ai: ${error.message}`, { retryable: true });
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
    const detail = extractDetail(payload, text);
    throw new ProviderError(describeStatus(response.status, detail), {
      status: response.status,
      detail,
      retryable: response.status === 429 || response.status >= 500,
    });
  }

  return payload ?? {};
}

/** Translate semantic parameters into the fal payload. */
export function buildInput(model, params) {
  if (model.key === 'seedance') {
    return {
      prompt: params.prompt,
      duration: params.duration ?? 'auto',
      aspect_ratio: params.aspectRatio ?? 'auto',
      resolution: params.resolution ?? '720p',
      generate_audio: params.audio ?? true,
    };
  }

  return {
    prompt: params.prompt,
    duration: params.duration ?? 8,
    aspect_ratio: params.aspectRatio ?? '16:9',
  };
}

/** Queue a job and return { requestId, statusUrl, responseUrl }. */
export async function submit(endpoint, input) {
  const data = await requestJson(`${QUEUE_BASE}/${endpoint}`, { method: 'POST', body: input });
  if (!data.request_id) {
    throw new ProviderError('fal.ai не вернул идентификатор запроса.', {
      detail: JSON.stringify(data).slice(0, 300),
    });
  }
  return {
    requestId: data.request_id,
    statusUrl: data.status_url ?? `${QUEUE_BASE}/${endpoint}/requests/${data.request_id}/status`,
    responseUrl: data.response_url ?? `${QUEUE_BASE}/${endpoint}/requests/${data.request_id}`,
  };
}

export async function fetchStatus(statusUrl) {
  return requestJson(statusUrl);
}

export async function fetchResult(responseUrl) {
  return requestJson(responseUrl);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Cheap health probe for the configured key: posts an empty payload, so no job
 * is created and nothing is billed. 422 means "authorized and allowed to run",
 * 401 means bad key, 403 with "exhausted balance" means the account is locked.
 */
let healthCache = { at: 0, value: null };

export async function checkProvider({ ttlMs = 60_000 } = {}) {
  if (!config.falKey) {
    return { state: 'no-key', ok: false, message: 'FAL_KEY не задан' };
  }
  if (healthCache.value && Date.now() - healthCache.at < ttlMs) {
    return healthCache.value;
  }

  let result;
  try {
    const response = await fetch(`${QUEUE_BASE}/fal-ai/gemini-omni-flash`, {
      method: 'POST',
      headers: { Authorization: `Key ${config.falKey}`, 'Content-Type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(15_000),
    });
    const text = await response.text();

    if (response.status === 401) {
      result = { state: 'bad-key', ok: false, message: 'Неверный FAL_KEY' };
    } else if (response.status === 403) {
      result = /exhausted balance/i.test(text)
        ? {
            state: 'no-balance',
            ok: false,
            message: 'Баланс fal.ai исчерпан — пополни на fal.ai/dashboard/billing',
          }
        : { state: 'forbidden', ok: false, message: 'Ключ fal.ai без доступа (403)' };
    } else if (response.ok || response.status === 422) {
      result = { state: 'ok', ok: true, message: 'Ключ активен, баланс в порядке' };
    } else {
      result = { state: 'unknown', ok: false, message: `fal.ai ответил HTTP ${response.status}` };
    }
  } catch (error) {
    result = { state: 'unreachable', ok: false, message: `fal.ai недоступен: ${error.message}` };
  }

  healthCache = { at: Date.now(), value: result };
  return result;
}

/**
 * Submit a generation job, poll it until completion and return the video URL.
 * `onProgress` is called on every poll with { status, queuePosition, elapsedMs }.
 */
export async function generate(model, params, options = {}) {
  const {
    onProgress = null,
    pollIntervalMs = config.pollIntervalMs,
    timeoutMs = config.generationTimeoutMs,
  } = options;

  const input = buildInput(model, params);
  const job = await submit(model.falEndpoint, input);
  const startedAt = Date.now();

  for (;;) {
    await sleep(pollIntervalMs);
    const elapsedMs = Date.now() - startedAt;

    if (elapsedMs > timeoutMs) {
      const timeoutError = new ProviderError('Превышено время ожидания генерации.', { status: 504 });
      timeoutError.requestId = job.requestId;
      throw timeoutError;
    }

    let status;
    try {
      status = await fetchStatus(job.statusUrl);
    } catch (error) {
      onProgress?.({ requestId: job.requestId, elapsedMs, status: 'IN_PROGRESS', transientError: error });
      continue;
    }

    onProgress?.({
      requestId: job.requestId,
      elapsedMs,
      status: status.status ?? 'IN_PROGRESS',
      queuePosition: status.queue_position ?? null,
    });

    if (status.status === 'COMPLETED') {
      const result = await fetchResult(status.response_url ?? job.responseUrl);
      const videoUrl = result?.video?.url;
      if (!videoUrl) {
        throw new ProviderError('fal.ai вернул ответ без ссылки на видео.', {
          detail: JSON.stringify(result).slice(0, 300),
        });
      }
      return { videoUrl, requestId: job.requestId, elapsedMs, result };
    }
  }
}
