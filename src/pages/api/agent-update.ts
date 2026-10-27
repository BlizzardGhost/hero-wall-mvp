import type { APIRoute } from 'astro';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const SECRET = (import.meta as any).env?.AGENT_SECRET ?? process.env.AGENT_SECRET;

function hmacHex(body: string) {
  return crypto.createHmac('sha256', SECRET as string).update(body).digest('hex');
}
function hmacB64(body: string) {
  return crypto.createHmac('sha256', SECRET as string).update(body).digest('base64');
}

export const GET: APIRoute = async () => new Response('pong');

export const POST: APIRoute = async ({ request }) => {
  if (!SECRET) {
    console.error('[agent] Missing AGENT_SECRET');
    return new Response(JSON.stringify({ error: 'Server misconfigured' }), { status: 500 });
  }

  const raw = await request.text();
  const got = (request.headers.get('x-signature') || '').trim();

  const header = got.startsWith('sha256=') ? got.slice(7) : got;

  const sigHex = hmacHex(raw);
  const sigB64 = hmacB64(raw);

  if (header !== sigHex && header !== sigB64) {
    console.warn('[agent] signature mismatch', { header, sigHex, sigB64 });
    return new Response(JSON.stringify({ error: 'Invalid signature' }), { status: 401 });
  }

  try {
    const dest = path.resolve(process.cwd(), 'src/data/hero.json');
    await fs.writeFile(dest, raw, 'utf8');

    return new Response(JSON.stringify({ ok: true, updated: dest }), { status: 200 });
  } catch (err: any) {
    console.error('[agent] write error', err);
    return new Response(JSON.stringify({ error: 'Write failed' }), { status: 500 });
  }
};