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

const stories = [...document.querySelectorAll("[data-story-id]")];
const commentsByStory = new Map();

function renderComments(storyId, list, count) {
  const comments = commentsByStory.get(storyId) || [];
  list.replaceChildren(...comments.map(commentNode));
  if (!comments.length) list.textContent = "还没有评论。";
  count.textContent = comments.length ? `(${comments.length})` : "";
}

async function preloadComments() {
  try {
    const response = await fetch("/api/comments");
    if (!response.ok) throw new Error("Comments are not available yet.");
    const payload = await response.json();
    for (const comment of payload.comments) {
      const comments = commentsByStory.get(comment.story_id) || [];
      comments.push(comment);
      commentsByStory.set(comment.story_id, comments);
    }
    for (const story of stories) {
      renderComments(
        story.dataset.storyId,
        story.querySelector(".comments-list"),
        story.querySelector(".comments-count")
      );
    }
    return true;
  } catch {
    return false;
  }
}

const preloadPromise = preloadComments();

for (const story of stories) {
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
      commentsByStory.set(storyId, payload.comments);
      renderComments(storyId, list, count);
      loaded = true;
    } catch (error) {
      list.textContent = error.message;
    }
  }

  toggle.addEventListener("click", async () => {
    panel.hidden = !panel.hidden;
    toggle.setAttribute("aria-expanded", String(!panel.hidden));
    if (!panel.hidden && !loaded) {
      loaded = await preloadPromise;
      if (!loaded) await loadComments();
    }
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
      await loadComments();
    } catch (error) {
      status.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });
}

async function openLinkedComments() {
  const target = document.querySelector(location.hash);
  if (!target?.matches("[data-story-id]")) return;
  await preloadPromise;
  const panel = target.querySelector(".comments-panel");
  const toggle = target.querySelector(".comments-toggle");
  panel.hidden = false;
  toggle.setAttribute("aria-expanded", "true");
}

openLinkedComments();
