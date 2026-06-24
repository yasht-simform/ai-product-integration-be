import { AsyncLocalStorage } from 'async_hooks';

export interface RequestContext {
  requestId: string;
}

// Single AsyncLocalStorage instance shared between the middleware (writer)
// and the logger (reader) so requestId flows through the async call chain
// without being threaded through every function signature.
export const requestContext = new AsyncLocalStorage<RequestContext>();
