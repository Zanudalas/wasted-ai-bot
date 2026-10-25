import { config } from '../config.js';
import * as fal from './fal.js';
import * as kie from './kie.js';

/**
 * Provider selection.
 * - KIE_API_KEY set  -> kie.ai (accepts Seedance 2.5 + Gemini Omni 1.1 Flash)
 * - otherwise FAL_KEY -> fal.ai
 * An explicit PROVIDER=kie|fal in .env wins over auto-detection.
 */
const forced = (process.env.PROVIDER ?? '').trim().toLowerCase();

export function currentProvider() {
  if (forced === 'kie') return kie;
  if (forced === 'fal') return fal;
  return config.kieKey ? kie : fal;
}

export function providerName() {
  return currentProvider().name;
}

export function keyName() {
  return currentProvider().keyName;
}

export function hasKey() {
  return currentProvider().hasKey();
}

export function generate(model, params, options) {
  return currentProvider().generate(model, params, options);
}

export function checkProvider(options) {
  return currentProvider().checkProvider(options);
}

export function buildInput(model, params) {
  return currentProvider().buildInput(model, params);
}

export { ProviderError } from './errors.js';
