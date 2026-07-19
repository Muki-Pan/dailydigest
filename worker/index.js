const json = (value, status = 200) => new Response(JSON.stringify(value), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
});

async function ensureSchema(db) {
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS comments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      story_id TEXT NOT NULL,
      issue_date TEXT NOT NULL,
      body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 1200),
      created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
      status TEXT NOT NULL DEFAULT 'visible' CHECK(status IN ('visible', 'hidden', 'deleted'))
    )`),
    db.prepare("CREATE INDEX IF NOT EXISTS comments_story_created_idx ON comments(story_id, status, created_at DESC)"),
    db.prepare("CREATE INDEX IF NOT EXISTS comments_feed_idx ON comments(status, created_at DESC)")
  ]);
}

async function commentsApi(request, env) {
  if (!env.DB) return json({ error: "Comments database is not configured." }, 503);
  await ensureSchema(env.DB);
  const url = new URL(request.url);

  if (request.method === "GET") {
    const storyId = url.searchParams.get("story_id")?.slice(0, 80);
    if (!storyId) {
      const { results } = await env.DB.prepare(
        "SELECT id, story_id, issue_date, body, created_at FROM comments WHERE status = 'visible' ORDER BY created_at DESC LIMIT 500"
      ).all();
      return json({ comments: results });
    }
    const { results } = await env.DB.prepare(
      "SELECT id, body, created_at FROM comments WHERE story_id = ? AND status = 'visible' ORDER BY created_at ASC LIMIT 200"
    ).bind(storyId).all();
    return json({ comments: results });
  }

  if (request.method === "POST") {
    if (!request.headers.get("content-type")?.includes("application/json")) return json({ error: "Expected JSON." }, 415);
    const origin = request.headers.get("origin");
    if (origin && new URL(origin).host !== url.host) return json({ error: "Invalid origin." }, 403);
    let input;
    try { input = await request.json(); } catch { return json({ error: "Invalid JSON." }, 400); }
    if (input.website) return json({ error: "Could not post comment." }, 400);
    if (!Number.isFinite(input.started_at) || Date.now() - input.started_at < 2500) return json({ error: "Please wait a moment before posting." }, 429);
    const storyId = String(input.story_id || "").trim();
    const issueDate = String(input.issue_date || "").trim();
    const body = String(input.body || "").trim();
    if (!/^\d{4}-\d{2}-\d{2}:\d{2}$/.test(storyId) || !/^\d{4}-\d{2}-\d{2}$/.test(issueDate)) return json({ error: "Invalid story." }, 400);
    if (!body || body.length > 1200) return json({ error: "Comment must be 1–1200 characters." }, 400);
    const result = await env.DB.prepare(
      "INSERT INTO comments (story_id, issue_date, body) VALUES (?, ?, ?) RETURNING id, body, created_at"
    ).bind(storyId, issueDate, body).first();
    return json({ comment: result }, 201);
  }

  return json({ error: "Method not allowed." }, 405);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/comments") return commentsApi(request, env);
    return env.ASSETS.fetch(request);
  }
};
