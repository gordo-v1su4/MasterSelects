import { loadUserFromSession } from './lib/auth';
import { buildRequestId } from './lib/db';
import type { AppContext, AppRouteHandler } from './lib/env';

function withHeaders(response: Response, request: Request): Response {
  const headers = new Headers(response.headers);
  const { pathname } = new URL(request.url);

  headers.set('X-MasterSelects-Edge', 'pages-functions');

  if (pathname.startsWith('/api/')) {
    headers.set('Cache-Control', 'no-store');
  }

  return new Response(response.body, {
    headers,
    status: response.status,
    statusText: response.statusText,
  });
}

export const onRequest: AppRouteHandler = async (context: AppContext): Promise<Response> => {
  context.data.requestId = buildRequestId(context.request);
  context.data.user = null;

  try {
    context.data.user = await loadUserFromSession(context.request, context.env);
  } catch {
    context.data.user = null;
  }

  if (context.request.method === 'OPTIONS' && new URL(context.request.url).pathname.startsWith('/api/')) {
    return new Response(null, {
      headers: {
        Allow: 'GET, POST, OPTIONS',
        'Cache-Control': 'no-store',
      },
      status: 204,
    });
  }

  const response = await context.next();
  return withHeaders(response, context.request);
};
