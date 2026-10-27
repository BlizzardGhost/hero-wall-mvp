import type { APIRoute } from "astro";
import OpenAI from "openai";

export const prerender = false;

export const POST: APIRoute = async ({ request }) => {
  try {
    const { prompt, context } = await request.json();
    if (!prompt || typeof prompt !== "string") {
      return new Response(JSON.stringify({ error: "Missing prompt" }), { status: 400 });
    }

    const apiKey = process.env.OPENAI_API_KEY!;
    if (!apiKey) {
      return new Response(JSON.stringify({ error: "Missing OPENAI_API_KEY" }), { status: 500 });
    }

    const openai = new OpenAI({ apiKey });

    // Tiny system to keep it friendly + relevant to your site
    const messages: OpenAI.Chat.ChatCompletionMessageParam[] = [
      {
        role: "system",
        content:
          "You are RASS, a helpful, upbeat site guide for Boris Quijano’s Hero Wall. " +
          "Keep replies short and useful. If asked about services, offer a friendly next step."
      },
      ...(Array.isArray(context) ? context : []),
      { role: "user", content: prompt }
    ];

    const resp = await openai.chat.completions.create({
      model: "gpt-4o-mini",
      messages,
      temperature: 0.7,
      max_tokens: 220
    });

    const text = resp.choices?.[0]?.message?.content?.toString() ?? "I’m here!";
    return new Response(JSON.stringify({ text }), {
      headers: { "content-type": "application/json" }
    });
  } catch (e:any) {
    return new Response(JSON.stringify({ error: e?.message || "Server error" }), { status: 500 });
  }
};