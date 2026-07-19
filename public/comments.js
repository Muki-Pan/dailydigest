const escapeText = (value) => String(value ?? "");

function commentNode(comment) {
  const item = document.createElement("article");
  item.className = "comment";
  const body = document.createElement("p");
  body.textContent = escapeText(comment.body);
  const time = document.createElement("time");
  time.dateTime = comment.created_at;
  time.textContent = new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Shanghai"
  }).format(new Date(comment.created_at));
  item.append(body, time);
  return item;
}

for (const story of document.querySelectorAll("[data-story-id]")) {
  const storyId = story.dataset.storyId;
  const issueDate = story.dataset.issueDate;
  const toggle = story.querySelector(".comments-toggle");
  const panel = story.querySelector(".comments-panel");
  const list = story.querySelector(".comments-list");
  const count = story.querySelector(".comments-count");
  const form = story.querySelector(".comment-form");
  const status = story.querySelector(".comment-status");
  form.elements.started_at.value = String(Date.now());
  let loaded = false;

  async function loadComments() {
    list.textContent = "Loading…";
    try {
      const response = await fetch(`/api/comments?story_id=${encodeURIComponent(storyId)}`);
      if (!response.ok) throw new Error("Comments are not available yet.");
      const payload = await response.json();
      list.replaceChildren(...payload.comments.map(commentNode));
      if (!payload.comments.length) list.textContent = "还没有评论。";
      count.textContent = payload.comments.length ? `(${payload.comments.length})` : "";
      loaded = true;
    } catch (error) {
      list.textContent = error.message;
    }
  }

  toggle.addEventListener("click", async () => {
    panel.hidden = !panel.hidden;
    toggle.setAttribute("aria-expanded", String(!panel.hidden));
    if (!panel.hidden && !loaded) await loadComments();
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const button = form.querySelector("button[type=submit]");
    button.disabled = true;
    status.textContent = "Posting…";
    const data = new FormData(form);
    try {
      const response = await fetch("/api/comments", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          story_id: storyId,
          issue_date: issueDate,
          body: data.get("body"),
          website: data.get("website"),
          started_at: Number(data.get("started_at"))
        })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Could not post comment.");
      form.reset();
      form.elements.started_at.value = String(Date.now());
      status.textContent = "Posted anonymously.";
      loaded = false;
      await loadComments();
    } catch (error) {
      status.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });
}
