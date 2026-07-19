# Muki's Daily Digest

一个由 Gemini 自动研究、编辑并发布的私人文化信号杂志。旧刊继续支持 Markdown；新刊以 `data/issues/YYYY-MM-DD.json` 为事实来源，同时自动保留一份 Markdown 档案。

## 自动生产流程

每天北京时间 09:15，GitHub Actions 会：

1. 使用 Gemini 和 Google Search 检查五个编辑入口。
2. 读取最近七期，进行实体和主题查重。
3. 按 JSON Schema 生成 1–5 条高质量信号。
4. 要求每个来源 URL 必须来自 Google Search 返回的引用，并实际请求页面，检查失效链接。
5. 校验必要字段、栏目唯一性和 Editor's Pick；没有明确证据的发布日期留空。
6. 初稿校验失败时自动进行一次结构化修稿；仍失败则停止且不发布半成品。
7. 写入 JSON、Markdown 与 `data/research/` 来源审计记录，运行 `npm run build`。
8. 提交新一期；连接仓库的静态托管服务随后自动上线。

生成失败时不会写入半成品，也不会覆盖当天已有刊物。

## 首次配置

安装依赖：

```bash
npm install
```

从 [Google AI Studio](https://aistudio.google.com/apikey) 创建 Gemini API Key，然后：

```bash
cp .env.example .env
```

把 Key 写入本地 `.env`：

```bash
GEMINI_API_KEY=your-key
```

`.env` 已被 Git 忽略，不要把 Key 写入源代码。线上自动任务还需要在 GitHub 仓库的 **Settings → Secrets and variables → Actions** 中创建名为 `GEMINI_API_KEY` 的 Repository secret。

## 本地生成一期

```bash
npm run generate
npm run validate
npm run build
npm run dev
```

打开 `http://127.0.0.1:4324`。默认日期按 `Asia/Shanghai` 计算，生产模型是 `gemini-3.5-flash`。程序先进行 Google Search 研究，再通过第二次调用整理为严格 JSON。该模型的 API 搜索需要已启用 Billing 的项目。带搜索的研究请求默认允许运行 240 秒，可通过 `GEMINI_TIMEOUT_MS` 调整。

如果中国大陆网络环境无法连接 `generativelanguage.googleapis.com`，需要让 Node 使用可访问 Google API 的网络。Node 24 在已经设置代理环境变量时可以这样运行：

```bash
NODE_USE_ENV_PROXY=1 HTTPS_PROXY=http://你的代理地址 npm run generate
```

不要照抄代理地址；使用本机代理工具实际提供的 HTTP 代理地址。GitHub Actions 的海外运行环境通常不需要这一设置。

需要测试指定日期时：

```bash
DIGEST_DATE=2026-07-17 npm run generate
```

程序不会覆盖已存在的一期。只有明确需要重做时才使用：

```bash
npm run generate -- --force
```

## 项目结构

- `prompts/editorial-policy.md`：长期编辑原则，不包含排版指令。
- `schemas/digest.schema.json`：Gemini 必须遵守的数据契约。
- `scripts/generate.mjs`：通过 Gemini REST API 搜索、查重、生成以及写入。
- `scripts/validate.mjs`：独立内容校验。
- `scripts/build.mjs`：把结构化新刊和旧 Markdown 渲染到 `public/`。
- `data/issues/`：新刊的结构化事实来源。
- `data/research/`：每期 Google Search 研究文本与原始引用 URL，便于追溯来源。
- `chatgpt_output/`：自动生成及历史 Markdown 档案。
- `.github/workflows/daily-digest.yml`：每日定时任务。

## 内容与评论存储

刊物正文不是存储在数据库里。结构化正文位于 `data/issues/YYYY-MM-DD.json`，GitHub 是内容档案；每次部署时，`npm run build` 会把它们渲染为 `public/issues/` 下的静态页面。

匿名评论使用 Cloudflare D1。每条评论关联一个稳定的 `日期:序号` news ID；`comments` 表同时保留 `issue_date`、`created_at` 和可见状态，并建立了按 news 与全站时间线读取的索引。以后增加文字瀑布流页面时可以直接复用，不需要迁移现有评论。

首次启用评论：

1. 在 Cloudflare 控制台创建名为 `daily-digest-comments` 的 D1 数据库。
2. 复制数据库 ID，取消 `wrangler.jsonc` 中 `d1_databases` 配置的注释并填入 ID。
3. Cloudflare 构建命令使用 `npm run build`，部署命令使用 `npx wrangler deploy`。
4. 重新部署。Worker 会在第一次评论请求时安全地初始化表和索引；`migrations/0001_comments.sql` 也保留为数据库结构记录。

需要隐藏评论时，可以在 D1 控制台执行：

```sql
UPDATE comments SET status = 'deleted' WHERE id = 需要删除的评论ID;
```

## 常用命令

```bash
npm run generate   # 调用 Gemini 生成当天内容
npm run validate   # 校验所有结构化刊物
npm run build      # 生成 public/ 静态网站
npm test           # 运行数据与 Markdown 契约测试
npm run dev        # 本地预览
```
