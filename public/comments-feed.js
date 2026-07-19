const feed = document.querySelector("#comments-feed");
const count = document.querySelector("#feed-count");

const timeFormatter = new Intl.DateTimeFormat("zh-CN", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Shanghai"
});

function makeCard(comment, issuesByDate) {
  const storyNumber = Number(comment.story_id.split(":").at(-1));
  const story = issuesByDate.get(comment.issue_date)?.stories?.[storyNumber - 1];
  const link = document.createElement("a");
  link.className = "comment-card";
  link.href = `issues/${comment.issue_date}.html#story-${String(storyNumber).padStart(2, "0")}`;

  const body = document.createElement("p");
  body.className = "comment-card-body";
  body.textContent = comment.body;

  const meta = document.createElement("time");
  meta.className = "comment-card-meta";
  meta.dateTime = comment.created_at;
  meta.textContent = timeFormatter.format(new Date(comment.created_at));

  const source = document.createElement("blockquote");
  source.className = "comment-card-source";
  source.textContent = story?.title || `${comment.issue_date} · Story ${String(storyNumber).padStart(2, "0")}`;

  const arrow = document.createElement("span");
  arrow.className = "comment-card-arrow";
  arrow.textContent = "↗";
  arrow.setAttribute("aria-hidden", "true");

  link.setAttribute("aria-label", `查看原报道：${source.textContent}`);
  link.append(body, meta, source, arrow);
  return link;
}

async function loadFeed() {
  try {
    const [commentsResponse, issuesResponse] = await Promise.all([
      fetch("/api/comments"),
      fetch("data/issues.json")
    ]);
    if (!commentsResponse.ok || !issuesResponse.ok) throw new Error("Comments are not available yet.");
    const [{ comments }, issues] = await Promise.all([commentsResponse.json(), issuesResponse.json()]);
    const issuesByDate = new Map(issues.map((issue) => [issue.date, issue]));
    count.textContent = `(${comments.length})`;
    if (!comments.length) {
      feed.innerHTML = '<p class="feed-state">还没有评论。第一条文字会从这里开始。</p>';
      return;
    }
    feed.replaceChildren(...comments.map((comment) => makeCard(comment, issuesByDate)));
  } catch (error) {
    feed.innerHTML = `<p class="feed-state">${error.message}</p>`;
  }
}

loadFeed();
