import type { APIRoute } from "astro";
export const prerender = false;
export const GET: APIRoute = () =>
  new Response("pong", { headers: { "content-type": "text/plain" } });