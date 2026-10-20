#!/usr/bin/env node
/*
 * 把站点发布到 GitHub Pages。
 *
 * 发布方式是 GitHub Pages 原生的「从分支发布」：gh-pages 分支的根目录就是站点根。
 * 之所以不用 GitHub Actions：推 .github/workflows/ 下的文件要求 token 带 workflow
 * 权限，而仓库凭据通常只有 repo 权限；分支发布只用得上 repo 权限，一次推送就完成，
 * 也不占 Actions 额度。
 *
 * 这个脚本不切换分支、不动工作区：它用 git 底层命令把 .pages-dist/ 里的文件写成
 * 一棵 tree、造一个没有父提交的 commit，直接更新 gh-pages 的 ref 再强推。
 * 好处是发布失败也不会把仓库留在半路，主分支的工作副本更不会被打扰。
 *
 * 用法：
 *   node tools/deploy-pages.mjs              # 组装并发布
 *   node tools/deploy-pages.mjs --dry-run    # 只组装并打印将发布的内容
 *   node tools/deploy-pages.mjs --keep       # 复用已有的 .pages-dist/，不重新组装
 *
 * 前置条件：gh-pages 分支已存在，且仓库 Settings → Pages 的 Source 指向它。
 * 首次启用见 README 的「部署」一节。
 */
import { execFileSync } from 'node:child_process';
import { readdir, stat } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from './build-pages.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BRANCH = 'gh-pages';

const argv = new Set(process.argv.slice(2));
const dryRun = argv.has('--dry-run');
const keep = argv.has('--keep');

/** 在仓库根执行 git，返回标准输出的字符串。 */
function git(args, input) {
  return execFileSync('git', args, {
    cwd: root,
    input,
    encoding: 'utf8',
    stdio: input === undefined ? ['ignore', 'pipe', 'pipe'] : ['pipe', 'pipe', 'pipe'],
  }).trim();
}

/** 递归列出发布目录里的文件，返回以 / 分隔的相对路径。 */
async function walk(dir, base = dir, out = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      await walk(full, base, out);
    } else if (entry.isFile()) {
      out.push(relative(base, full).split(sep).join('/'));
    }
  }
  return out;
}

/**
 * 按目录层级把文件写进 git 对象库，返回根 tree 的哈希。
 * mktree 的输入格式：<mode> <type> <sha>\t<name>
 */
async function writeTree(outDir) {
  const files = await walk(outDir);
  /** path -> { sha, mode } */
  const blobs = new Map();

  for (const rel of files) {
    const sha = git(['hash-object', '-w', '--no-filters', join(outDir, rel)]);
    blobs.set(rel, sha);
  }

  /* 先按一级目录分组，逐个造子树；根上直接放文件。只支持一层子目录，
     对单文件站点足够，多了也没必要。 */
  const rootEntries = [];
  const dirs = new Map();

  for (const [rel, sha] of blobs) {
    const parts = rel.split('/');
    if (parts.length === 1) {
      rootEntries.push(`100644 blob ${sha}\t${rel}`);
    } else {
      const [head, ...rest] = parts;
      if (!dirs.has(head)) dirs.set(head, []);
      dirs.get(head).push(`100644 blob ${sha}\t${rest.join('/')}`);
    }
  }

  for (const [name, entries] of dirs) {
    const sub = git(['mktree'], entries.join('\n') + '\n');
    rootEntries.push(`040000 tree ${sub}\t${name}`);
  }

  return { tree: git(['mktree'], rootEntries.join('\n') + '\n'), count: files.length };
}

async function main() {
  let info;
  if (keep) {
    const outDir = join(root, '.pages-dist');
    const files = await walk(outDir).catch(() => {
      throw new Error('.pages-dist/ 不存在，去掉 --keep 重新组装');
    });
    let bytes = 0;
    for (const rel of files) bytes += (await stat(join(outDir, rel))).size;
    info = { outDir, files: files.filter((f) => !f.includes('/')), bytes };
    console.log(`复用已有发布目录：${outDir}（${files.length} 个文件）`);
  } else {
    info = await build();
  }

  const { tree, count } = await writeTree(info.outDir);
  const source = git(['rev-parse', '--short', 'HEAD']);
  const stamp = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  const message = `发布站点：${count} 个文件，源提交 ${source}\n\n构建时间：${stamp}\n由 tools/deploy-pages.mjs 生成，请勿手工编辑本分支。`;

  if (dryRun) {
    console.log('\n[dry-run] 将发布到 ' + BRANCH + '：');
    console.log(`  tree ${tree.slice(0, 10)}，${count} 个文件，源提交 ${source}`);
    console.log('  未推送。去掉 --dry-run 即真正发布。');
    return;
  }

  const commit = git(['commit-tree', tree, '-m', message]);
  git(['update-ref', `refs/heads/${BRANCH}`, commit]);
  git(['push', 'origin', `refs/heads/${BRANCH}:refs/heads/${BRANCH}`, '--force']);

  console.log('');
  console.log(`已发布到 ${BRANCH}：${commit.slice(0, 7)}（${count} 个文件）`);
  console.log('  GitHub Pages 通常在一分钟内生效：');
  console.log('  https://a369096433.github.io/operation-ironhold/');
}

main().catch((err) => {
  const detail = err.stderr ? String(err.stderr).trim() : '';
  console.error(err.message || err);
  if (detail) console.error(detail);
  process.exit(1);
});
