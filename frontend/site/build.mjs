// 사이트맵으로 public/ 아래 HTML을 생성·갱신한다.
//
//   node site/build.mjs           생성 (npm run build, npm run dev 전에 자동 실행)
//   node site/build.mjs --check   파일을 쓰지 않고 최신 상태인지만 검사. 다르면 종료 코드 1 (커밋 전 확인용)
//
// 규칙
// - status: 'stub' 페이지와 메뉴 홈은 파일 전체를 생성한다. 단, 자동 생성 표시가 없는 파일(사람이 만든 파일)은 덮어쓰지 않고 오류를 낸다.
// - status: 'live' 페이지는 사람이 작성한다. <!-- layout:이름 --> ~ <!-- /layout:이름 --> 구간만 교체하고 나머지는 건드리지 않는다.

import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  allPages, stubPage, GENERATED_MARK, href,
  headRegion, headerRegion, lnbRegion, pageHeadRegion, footerRegion, homeNoticeRegion,
} from './templates.mjs';
import { ROUTES } from '../public/assets/js/routes.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
const CHECK = process.argv.includes('--check');

const REGIONS = {
  head: headRegion,
  header: headerRegion,
  lnb: lnbRegion,
  'page-head': pageHeadRegion,
  footer: footerRegion,
  'home-notice': homeNoticeRegion,
};
const REQUIRED = {
  home: ['head', 'header', 'footer'],
  plain: ['head', 'header', 'page-head', 'footer'],
  sub: ['head', 'header', 'lnb', 'page-head', 'footer'],
};

const fileOf = (path) => join(ROOT, path === '/' ? '' : path, 'index.html');

function fillRegions(html, page) {
  const found = new Set();
  const out = html.replace(/<!-- layout:([\w-]+) -->[\s\S]*?<!-- \/layout:\1 -->/g, (_, name) => {
    if (!REGIONS[name]) throw new Error(`알 수 없는 구간 layout:${name}`);
    if (found.has(name)) throw new Error(`구간 layout:${name}이 두 번 이상 있습니다`);
    found.add(name);
    return `<!-- layout:${name} -->\n${REGIONS[name](page)}\n<!-- /layout:${name} -->`;
  });
  const missing = REQUIRED[page.layout].filter((name) => !found.has(name));
  if (missing.length) throw new Error(`필수 구간이 없습니다: ${missing.map((n) => `layout:${n}`).join(', ')}`);
  return out;
}

async function expectedHtml(page, file) {
  const current = existsSync(file) ? await readFile(file, 'utf8') : null;
  if (page.status === 'stub') {
    if (current !== null && !current.includes(GENERATED_MARK)) {
      throw new Error('직접 작성한 파일로 보여 덮어쓰지 않았습니다. 이 페이지를 직접 관리하려면 사이트맵에서 status를 live로 바꾸세요');
    }
    return { current, next: fillRegions(stubPage(page), page) };
  }
  if (current === null) throw new Error('status가 live인데 파일이 없습니다');
  if (current.includes(GENERATED_MARK)) {
    throw new Error('status가 live인데 자동 생성 표시가 남아 있습니다. 파일 첫 부분의 자동 생성 주석을 지우세요');
  }
  return { current, next: fillRegions(current, page) };
}

// public/ 아래 index.html 중 사이트맵에 없는 것 (자산·목 폴더 제외)
async function findOrphans(known) {
  const orphans = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!['assets', 'mock'].includes(entry.name) || dir !== ROOT) await walk(full);
      } else if (entry.name.endsWith('.html') && !known.has(full)) {
        orphans.push(relative(ROOT, full));
      }
    }
  }
  await walk(ROOT);
  return orphans;
}

async function main() {
  const pages = allPages();
  const errors = [];
  const changed = [];

  // 경로 중복
  const seen = new Set();
  for (const page of pages) {
    if (seen.has(page.path)) errors.push(`${page.path}: 경로가 중복됩니다`);
    seen.add(page.path);
  }

  // 화면 코드(routes.js)가 쓰는 경로가 사이트맵에 있는지
  const hrefs = new Set(pages.map((p) => href(p.path)));
  for (const [name, value] of Object.entries(ROUTES)) {
    if (!hrefs.has(value)) errors.push(`routes.js ROUTES.${name} = "${value}": 사이트맵에 없는 경로입니다`);
  }

  for (const page of pages) {
    const file = fileOf(page.path);
    try {
      const { current, next } = await expectedHtml(page, file);
      if (current === next) continue;
      changed.push(relative(ROOT, file));
      if (!CHECK) {
        await mkdir(dirname(file), { recursive: true });
        await writeFile(file, next);
      }
    } catch (err) {
      errors.push(`${page.path} (${relative(ROOT, file)}): ${err.message}`);
    }
  }

  const orphans = await findOrphans(new Set(pages.map((p) => fileOf(p.path))));
  for (const orphan of orphans) console.warn(`경고: 사이트맵에 없는 HTML 파일입니다: public/${orphan}`);

  if (errors.length) {
    console.error(`오류 ${errors.length}건:\n${errors.map((e) => `  - ${e}`).join('\n')}`);
    process.exit(1);
  }
  if (CHECK) {
    if (changed.length) {
      console.error(`최신 상태가 아닌 파일 ${changed.length}개. npm run build를 실행하세요:\n${changed.map((f) => `  - public/${f}`).join('\n')}`);
      process.exit(1);
    }
    console.log(`페이지 ${pages.length}개 모두 최신 상태입니다.`);
    return;
  }
  console.log(`페이지 ${pages.length}개 중 ${changed.length}개 갱신.`);
}

main();
