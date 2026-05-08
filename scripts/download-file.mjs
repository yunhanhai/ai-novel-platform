import { createWriteStream } from "node:fs";
import { mkdir, stat } from "node:fs/promises";
import { dirname } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const [url, outputPath] = process.argv.slice(2);

if (!url || !outputPath) {
  console.error("Usage: node scripts/download-file.mjs <url> <outputPath>");
  process.exit(2);
}

await mkdir(dirname(outputPath), { recursive: true });

const response = await fetch(url);
if (!response.ok || !response.body) {
  throw new Error(`Download failed: ${response.status} ${response.statusText}`);
}

const total = Number(response.headers.get("content-length") ?? 0);
let downloaded = 0;
let lastLogged = 0;

const progress = new TransformStream({
  transform(chunk, controller) {
    downloaded += chunk.byteLength;
    if (total > 0) {
      const percent = Math.floor((downloaded / total) * 100);
      if (percent >= lastLogged + 10) {
        lastLogged = percent;
        console.log(`downloaded ${percent}%`);
      }
    }
    controller.enqueue(chunk);
  }
});

await pipeline(
  Readable.fromWeb(response.body.pipeThrough(progress)),
  createWriteStream(outputPath)
);

const file = await stat(outputPath);
console.log(`saved ${outputPath}`);
console.log(`bytes ${file.size}`);
