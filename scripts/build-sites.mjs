import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const dist = path.join(root, 'dist');
const serverDir = path.join(dist, 'server');
const clientDir = path.join(dist, 'client');

const readUtf8 = (file) => readFile(path.join(root, file), 'utf8');
const readBase64 = async (file) => (await readFile(path.join(root, file))).toString('base64');

function jsString(value) {
  return JSON.stringify(value);
}

await rm(dist, { recursive: true, force: true });
await mkdir(serverDir, { recursive: true });
await mkdir(clientDir, { recursive: true });

const [html, css, js, heroPng] = await Promise.all([
  readUtf8('index.html'),
  readUtf8('css/styles.css'),
  readUtf8('js/app.js'),
  readBase64('assets/context-layers-hero.png')
]);

const worker = `const assets = {
  "/": { body: ${jsString(html)}, type: "text/html; charset=utf-8" },
  "/index.html": { body: ${jsString(html)}, type: "text/html; charset=utf-8" },
  "/css/styles.css": { body: ${jsString(css)}, type: "text/css; charset=utf-8" },
  "/js/app.js": { body: ${jsString(js)}, type: "application/javascript; charset=utf-8" },
  "/assets/context-layers-hero.png": { body: ${jsString(heroPng)}, type: "image/png", binary: true }
};

function decodeBase64(value) {
  const raw = atob(value);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

function assetResponse(asset) {
  const body = asset.binary ? decodeBase64(asset.body) : asset.body;
  return new Response(body, {
    headers: {
      "content-type": asset.type,
      "cache-control": asset.binary ? "public, max-age=31536000, immutable" : "public, max-age=300"
    }
  });
}

export default {
  async fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return Response.json({ ok: true, service: "context-cop" });
    }

    const asset = assets[url.pathname] || assets["/"];
    return assetResponse(asset);
  }
};
`;

await writeFile(path.join(serverDir, 'index.js'), worker);

await writeFile(path.join(clientDir, 'index.html'), html);
await mkdir(path.join(clientDir, 'css'), { recursive: true });
await mkdir(path.join(clientDir, 'js'), { recursive: true });
await mkdir(path.join(clientDir, 'assets'), { recursive: true });
await writeFile(path.join(clientDir, 'css', 'styles.css'), css);
await writeFile(path.join(clientDir, 'js', 'app.js'), js);
await copyFile(path.join(root, 'assets', 'context-layers-hero.png'), path.join(clientDir, 'assets', 'context-layers-hero.png'));

await mkdir(path.join(dist, '.openai'), { recursive: true });
await copyFile(path.join(root, '.openai', 'hosting.json'), path.join(dist, '.openai', 'hosting.json'));

console.log('Built Sites artifact in dist/');
