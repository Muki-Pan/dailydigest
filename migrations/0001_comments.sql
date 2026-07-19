CREATE TABLE IF NOT EXISTS comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  story_id TEXT NOT NULL,
  issue_date TEXT NOT NULL,
  body TEXT NOT NULL CHECK(length(body) BETWEEN 1 AND 1200),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  status TEXT NOT NULL DEFAULT 'visible' CHECK(status IN ('visible', 'hidden', 'deleted'))
);

CREATE INDEX IF NOT EXISTS comments_story_created_idx
  ON comments(story_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS comments_feed_idx
  ON comments(status, created_at DESC);
