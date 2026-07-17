import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const root = path.join(process.cwd(), "public");
const types = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".json": "application/json" };
const server = createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
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
