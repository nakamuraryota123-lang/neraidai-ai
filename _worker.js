const UPSTREAM_API = "https://neraidai-ai-api.neraidai-ai-nakamuraryota.workers.dev/v1/analyze";
const UPSTREAM_ALLOWED_ORIGIN = "https://nakamuraryota123-lang.github.io";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname !== "/v1/analyze") return env.ASSETS.fetch(request);
    if (request.method !== "POST") {
      return new Response(JSON.stringify({ error: "Not found" }), {
        status: 404,
        headers: { "Content-Type": "application/json; charset=utf-8" }
      });
    }

    const upstream = await fetch(UPSTREAM_API, {
      method: "POST",
      headers: {
        "Content-Type": request.headers.get("Content-Type") || "application/json",
        Origin: UPSTREAM_ALLOWED_ORIGIN
      },
      body: request.body
    });

    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        "Content-Type": upstream.headers.get("Content-Type") || "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff"
      }
    });
  }
};
