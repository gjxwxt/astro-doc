export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method !== 'POST' || !url.pathname.endsWith('/chat/completions')) {
      return new Response('Not found', { status: 404 });
    }

    const auth = request.headers.get('authorization') || '';
    const expected = `Bearer ${env.PROXY_TOKEN || ''}`;
    if (!env.PROXY_TOKEN || auth !== expected) {
      return new Response(
        JSON.stringify({ error: { message: 'Unauthorized' } }),
        {
          status: 401,
          headers: { 'content-type': 'application/json' },
        },
      );
    }

    const target =
      'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';

    const headers = new Headers();
    headers.set('content-type', request.headers.get('content-type') || 'application/json');
    headers.set('accept', request.headers.get('accept') || 'application/json');
    headers.set('authorization', `Bearer ${env.GEMINI_API_KEY}`);
    headers.set('user-agent', 'Josh-AI-Proxy/1.0');

    const upstream = await fetch(target, {
      method: 'POST',
      headers,
      body: request.body,
    });

    const responseHeaders = new Headers();
    responseHeaders.set(
      'content-type',
      upstream.headers.get('content-type') || 'application/json',
    );
    responseHeaders.set('cache-control', 'no-store');

    return new Response(upstream.body, {
      status: upstream.status,
      headers: responseHeaders,
    });
  },
};
