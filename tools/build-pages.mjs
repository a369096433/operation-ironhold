#!/usr/bin/env node
/*
 * 组装 GitHub Pages 的发布目录。
 *
 * 仓库根目录同时也是网站根目录（index.html 就在根上），但仓库里还有 README、
 * PROMPTS、tools/ 这些开发文件，它们不该出现在线上站点里。所以部署不以仓库根
 * 直接发布，而是由这个脚本挑出站点真正需要的文件，复制到 .pages-dist/ 之后
 * 再交给 tools/deploy-pages.mjs 推到 gh-pages 分支。
 *
 * 用法：
 *   node tools/build-pages.mjs
 *
 * 只依赖 Node 内置模块，不需要安装任何依赖。
 */
import { cp, mkdir, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, '.pages-dist');

/** 站点直接需要、且必须随 index.html 一起发布的文件。 */
const FILES = ['index.html', 'og.jpg'];

/** 目录整体复制（README 里的截图就靠它）。 */
const DIRS = ['screenshots'];

/** 缺了就是线上坏链，这里做一次存在性检查。 */
const REQUIRED = ['index.html'];

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * 生成 .pages-dist/，返回发布产物的摘要。
 * @param {{ quiet?: boolean }} options
 * @returns {Promise<{ outDir: string, files: string[], bytes: number, missing: string[] }>}
 */
export async function build({ quiet = false } = {}) {
  await rm(outDir, { recursive: true, force: true });
  await mkdir(outDir, { recursive: true });

  const missing = [];
  const files = [];
  let bytes = 0;

  for (const name of FILES) {
    const from = join(root, name);
    if (!(await exists(from))) {
      missing.push(name);
      continue;
    }
    await cp(from, join(outDir, name));
    bytes += (await stat(from)).size;
    files.push(name);
  }

  for (const name of DIRS) {
    const from = join(root, name);
    if (!(await exists(from))) {
      missing.push(name + '/');
      continue;
    }
    await cp(from, join(outDir, name), { recursive: true });
  }

  for (const name of REQUIRED) {
    if (missing.includes(name)) {
      throw new Error(`发布目录缺少必需文件：${name}`);
    }
  }

  /* 分支发布默认会走一遍 Jekyll。这里本来就是纯静态 HTML，关掉它可以少一次构建，
     也少一类意外（Jekyll 会跳过下划线开头的路径）。 */
  await writeFile(join(outDir, '.nojekyll'), '');

  if (!quiet) {
    const kb = (bytes / 1024).toFixed(0);
    console.log(`发布目录已生成：${outDir}`);
    console.log(`  必需文件：${FILES.join('、')}（共 ${kb} KB）`);
    if (DIRS.length) console.log(`  目录：${DIRS.map((d) => d + '/').join('、')}`);
    if (missing.length) console.log(`  跳过（不存在）：${missing.join('、')}`);
  }

  return { outDir, files, bytes, missing };
}

/* 直接运行（node tools/build-pages.mjs）时才执行；被 import 时只导出 build。 */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  build().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
}
