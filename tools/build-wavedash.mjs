// 为 Wavedash 构建 dist-wavedash/：three.js r128 由本地提供（宿主是跨源隔离的），
// 并追加 tools/wavedash-hooks.js。index.html 本身不会被修改。
import fs from 'node:fs';

const CDN = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
const out = 'dist-wavedash';
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out);

let html = fs.readFileSync('index.html', 'utf8');
if (!html.includes(CDN)) throw new Error('未找到 three.js 的 CDN 标签');
html = html.replace(CDN, './three.min.js');
const hooks = fs.readFileSync('tools/wavedash-hooks.js', 'utf8');
html = html.replace(/<\/body>\s*<\/html>\s*$/, `<script>\n${hooks}</script>\n</body>\n</html>\n`);
fs.writeFileSync(`${out}/index.html`, html);

const res = await fetch(CDN);
if (!res.ok) throw new Error(`three.js download failed: ${res.status}`);
fs.writeFileSync(`${out}/three.min.js`, Buffer.from(await res.arrayBuffer()));
console.log('已构建', out);
