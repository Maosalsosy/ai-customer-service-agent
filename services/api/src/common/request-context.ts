import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

const requestContext = new AsyncLocalStorage<{ requestId: string }>();
const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;

export function createRequestContext(requestId?: string) {
  const candidate = requestId?.trim();
  const id = candidate && SAFE_REQUEST_ID.test(candidate) ? candidate : randomUUID();
  return {
    id,
    run: (callback: () => void) =>
      requestContext.run({ requestId: id }, callback),
  };
}

export function currentRequestId(): string | undefined {
  return requestContext.getStore()?.requestId;
}
