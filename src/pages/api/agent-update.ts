import type { APIRoute } from "astro";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export const prerender = false;

const HERO_JSON_PATH = resolve(process.cwd(), "src/data/hero.json");

export const GET: APIRoute = async () => {
  console.log("[agent-update] GET hit");
  return new Response(
    JSON.stringify({ ok: true, route: "/api/agent-update", writePath: HERO_JSON_PATH }),
    { headers: { "content-type": "application/json" } }
  );
};

export const POST: APIRoute = async ({ request }) => {
  console.log("[agent-update] POST hit");
  try {
    const incoming = await request.json();
    const required = ["hero", "abstract", "badges"];
    const missing = required.filter((k) => !(k in incoming));
    if (missing.length) {
      console.log("[agent-update] missing keys:", missing);
      return new Response(JSON.stringify({ ok: false, error: "missing keys", missing }), {
        status: 400,
        headers: { "content-type": "application/json" }
      });
    }
    await writeFile(HERO_JSON_PATH, JSON.stringify(incoming, null, 2), "utf8");
    console.log("[agent-update] wrote", HERO_JSON_PATH);
    return new Response(JSON.stringify({ ok: true, updated: HERO_JSON_PATH }), {
      headers: { "content-type": "application/json" }
    });
  } catch (err: any) {
    console.error("[agent-update] ERROR:", err?.message || err);
    return new Response(
      typeof err?.message === "string" ? err.message : "Server error",
      { status: 500, headers: { "content-type": "text/plain" } }
    );
  }
};