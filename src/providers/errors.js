/** Error thrown by every video provider adapter. */
export class ProviderError extends Error {
  constructor(message, { status = null, detail = null, retryable = false } = {}) {
    super(message);
    this.name = 'ProviderError';
    this.status = status;
    this.detail = detail;
    this.retryable = retryable;
  }
}
