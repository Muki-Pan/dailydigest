import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const root = path.join(process.cwd(), "public");
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json" };
const now = Date.now();
const sampleBodies = [
  "很喜欢这一期。",
  "“图像不是被动的记录，而是一种持续发生的关系”这句话让我停了很久。文章没有急着给出结论，而是把观看、记忆和权力之间那些不容易被察觉的联系慢慢展开。",
  "这组作品让我想到私人档案里的旧照片：画面看似普通，但时间久了，每一个模糊的角落都会获得新的重量。",
  "想继续了解艺术家的其他项目。",
  "读到中段时，我一直在想：当一张图像离开它原本的语境，被收藏、复制、裁切并重新展示之后，我们面对的还是同一张图像吗？或许变化的不只是意义，也包括观看者和图像之间的伦理关系。文章对这种不确定性的保留很好，没有把复杂的问题压缩成一句漂亮但空洞的判断。",
  "蓝色眼睛的描述很有画面感。",
  "这里关于“修复”和“再次占有”的区分特别重要。很多时候，我们以为让消失的图像重新可见就是一种补偿，却忽略了展示本身也可能重复原来的权力结构。怎样让观看成为照料，而不只是消费，是我读完后仍然在想的问题。",
  "谢谢分享，已经收藏。",
  "我喜欢文章里那种克制的语气。它没有替作品解释一切，而是给材料、历史与观看者之间留出了空白。尤其是把女性形象从单纯的受害叙事中移开，转而讨论图像如何流通、如何被命名、如何在不同制度中获得价值，这个角度让我重新理解了档案实践。",
  "期待下一期，也希望之后可以加入更多摄影书内页的细读。",
  "这是一条专门用来测试极长内容的评论。读完这篇文章之后，我不断回到一个问题：我们究竟是在观看一张图像，还是在观看它一路经过的制度、语言和权力关系？一张照片从私人抽屉进入档案馆，从档案馆进入展览，再从展览进入书籍和网络，每一次移动都会带来新的标题、新的排列方式和新的观看距离。原本属于某个人的生活片段，可能因此成为艺术史中的证据，也可能成为市场里的商品，还可能在没有获得充分说明的情况下被反复复制。文章最打动我的地方，是它没有把重新展示简单理解为拯救，也没有把隐藏或沉默浪漫化。真正困难的工作或许是持续追问：谁有权决定图像何时出现、以什么方式出现、与哪些文字并置，又由谁承担再次公开所造成的影响？如果观看可以是一种照料，那么这种照料就不应只发生在我们被画面感动的瞬间，还应体现在作品说明、授权方式、展示尺度、保存条件和观众反馈之中。与此同时，我也在想，面对已经失去原始语境的材料，策展人和写作者是否有可能承认知识的缺口，而不是急于用一个完整故事把空白填满。保留不确定性并不意味着放弃判断，反而可能是一种更诚实的责任：让我们看见材料能够告诉我们的，也看见它拒绝告诉我们的。这篇文章给我的启发正是在这里——它把图像当作一段仍在变化的关系，而不是一个等待被解释完毕的对象。为了继续测试截断效果，这段评论还会再延伸一些：当屏幕变窄、字号变大、来源标题占据两行时，正文末尾仍然应该出现清晰的省略号，日期、来源和箭头也都应完整保留在卡片之内；点击卡片之后，则应该进入对应杂志条目并自动展开评论区，让读者能够看到这里被隐藏的全部文字，而不是在列表页失去后半段内容。"
];
let localComments = sampleBodies.map((body, index) => ({
  id: index + 1,
  story_id: `2026-07-25:${String((index % 5) + 1).padStart(2, "0")}`,
  issue_date: "2026-07-25",
  body,
  created_at: new Date(now - index * 37 * 60 * 1000).toISOString()
}));

const sendJson = (response, value, status = 200) => {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(JSON.stringify(value));
};

async function readJson(request) {
  let body = "";
  for await (const chunk of request) body += chunk;
  return JSON.parse(body);
}

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, "http://localhost");
    const pathname = decodeURIComponent(url.pathname);
    if (pathname === "/api/comments" && request.method === "GET") {
      const storyId = url.searchParams.get("story_id");
      const comments = storyId
        ? localComments.filter((comment) => comment.story_id === storyId).reverse()
        : localComments;
      return sendJson(response, { comments });
    }
    if (pathname === "/api/comments" && request.method === "POST") {
      const input = await readJson(request);
      const body = String(input.body || "").trim();
      if (!body || body.length > 1200) return sendJson(response, { error: "Comment must be 1–1200 characters." }, 400);
      const comment = {
        id: localComments.length + 1,
        story_id: String(input.story_id),
        issue_date: String(input.issue_date),
        body,
        created_at: new Date().toISOString()
      };
      localComments = [comment, ...localComments];
      return sendJson(response, { comment }, 201);
    }
    let file = path.join(root, pathname === "/" ? "index.html" : pathname);
    if ((await stat(file)).isDirectory()) file = path.join(file, "index.html");
    response.setHeader("content-type", types[path.extname(file)] || "application/octet-stream");
    response.end(await readFile(file));
  } catch { response.writeHead(404); response.end("Not found"); }
});
server.on("error", (error) => {
  if (error.code === "EADDRINUSE") {
    console.error("http://127.0.0.1:4324 is already running; open or refresh that page instead.");
    process.exit(1);
  }
  throw error;
});
server.listen(4324, "127.0.0.1", () => console.log("http://127.0.0.1:4324"));
