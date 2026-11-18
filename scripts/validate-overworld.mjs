#!/usr/bin/env node
/**
 * Path: scripts/validate-overworld.mjs
 * Purpose: Headless source and build-artifact validator for SPEC-020 (Hero Wall 16-bit RPG Overworld).
 *          Verifies PixiJS v8 WebGPU + WGSL sky shader, 4-member party + Emy/Kiba/Yue memorial tribute,
 *          zero-KB Web Audio chiptune synthesizer, 5 World Zones, Baseline top-layer <dialog>,
 *          accessible focusgroup tablist, WCAG 2.2.2 #motionToggle without aria-pressed,
 *          humanizer prose hygiene, mobile Game Boy sticky CSS, and built dist/ or .vercel/output HTML.
 * Spec Reference: SPEC-020 (specs/020-hero-wall-16bit-overworld-implementation/spec.md)
 *
 * Operator Notes:
 * - Supports `--root <dir>` or `--root=<dir>` (defaults to `process.env.HERO_WALL_ROOT`, else `process.cwd()`
 *   when `package.json` is present there, else parent directory of `scripts/`).
 * - Validates built HTML in `dist/` and `.vercel/output/static/` automatically when present.
 * - Pass `--require-build` to fail if no built HTML files exist yet.
 * - Pass `--verbose` or set `OVERWORLD_VALIDATE_VERBOSE=1` to print every passing assertion.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Parse CLI arguments (`--root <dir>`, `--root=<dir>`, `--require-build`, `--verbose`).
 * @param {string[]} argv
 */
function parseArgs(argv) {
  let rootArg = '';
  let requireBuild = false;
  let verbose = process.env.OVERWORLD_VALIDATE_VERBOSE === '1';

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--require-build') {
      requireBuild = true;
    } else if (arg === '--verbose') {
      verbose = true;
    } else if (arg.startsWith('--root=')) {
      rootArg = arg.slice('--root='.length);
    } else if (arg === '--root' && i + 1 < argv.length) {
      rootArg = argv[i + 1];
      i += 1;
    }
  }

  let rootDir;
  if (rootArg) {
    rootDir = path.resolve(rootArg);
  } else if (process.env.HERO_WALL_ROOT) {
    rootDir = path.resolve(process.env.HERO_WALL_ROOT);
  } else if (fs.existsSync(path.join(process.cwd(), 'package.json'))) {
    rootDir = process.cwd();
  } else {
    rootDir = path.resolve(__dirname, '..');
  }

  return { rootDir, requireBuild, verbose };
}

const { rootDir: ROOT, requireBuild: REQUIRE_BUILD, verbose: VERBOSE } = parseArgs(process.argv.slice(2));

const failures = [];
const passes = [];
const notes = [];

/**
 * Record a passing assertion with optional verbose stdout logging.
 * @param {string} label
 */
function pass(label) {
  passes.push(label);
  if (VERBOSE) {
    console.log(`[PASS] ${label}`);
  }
}

/**
 * Record a failing assertion with diagnostic details.
 * @param {string} label
 * @param {string} [detail]
 */
function fail(label, detail = '') {
  const msg = detail ? `${label} -- ${detail}` : label;
  failures.push(msg);
  console.error(`[FAIL] ${msg}`);
}

/**
 * Read a UTF-8 file relative to ROOT, returning null when missing.
 * @param {string} relPath
 * @returns {string | null}
 */
function readRel(relPath) {
  const abs = path.join(ROOT, relPath);
  if (!fs.existsSync(abs)) {
    return null;
  }
  return fs.readFileSync(abs, 'utf8');
}

/**
 * Recursively collect files matching a predicate under dirAbs.
 * @param {string} dirAbs
 * @param {(absPath: string) => boolean} predicate
 * @returns {string[]}
 */
function walkFiles(dirAbs, predicate) {
  if (!fs.existsSync(dirAbs)) return [];
  const results = [];
  for (const entry of fs.readdirSync(dirAbs, { withFileTypes: true })) {
    const full = path.join(dirAbs, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkFiles(full, predicate));
    } else if (entry.isFile() && predicate(full)) {
      results.push(full);
    }
  }
  return results;
}

/**
 * Find the opening tag of an HTML element by exact id attribute.
 * @param {string} html
 * @param {string} id
 * @returns {string | null}
 */
function findElementTagById(html, id) {
  const re = new RegExp(`<([a-zA-Z0-9-]+)\\b[^>]*\\bid=["']${id}["'][^>]*>`, 'i');
  const match = html.match(re);
  return match ? match[0] : null;
}

/**
 * Extract all balanced `@media (...) { ... }` blocks matching `mediaPattern` using brace depth,
 * preventing regex over-greedy matches across unrelated rules.
 * @param {string} css
 * @param {RegExp} mediaPattern
 * @returns {string[]}
 */
function extractMediaBlocks(css, mediaPattern) {
  const blocks = [];
  const globalRe = new RegExp(mediaPattern.source, 'gi');
  let m;
  while ((m = globalRe.exec(css)) !== null) {
    const openBraceIdx = css.indexOf('{', m.index);
    if (openBraceIdx === -1) continue;
    let depth = 1;
    let i = openBraceIdx + 1;
    while (i < css.length && depth > 0) {
      if (css[i] === '{') depth += 1;
      else if (css[i] === '}') depth -= 1;
      i += 1;
    }
    if (depth === 0) {
      blocks.push(css.slice(openBraceIdx + 1, i - 1));
    }
  }
  return blocks;
}

/**
 * Extract user-facing prose from an Astro component or TS data module while stripping comments,
 * style rules, and code identifiers so CSS tokens (--cyan) or code comments do not trigger false positives.
 * @param {string} relPath
 * @param {string} content
 * @returns {string}
 */
function extractProseForHumanizer(relPath, content) {
  const chunks = [];

  if (relPath.endsWith('.ts')) {
    const noComments = content
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:])\/\/.*$/gm, '$1 ');
    const strRe = /(['"`])((?:\\.|(?!\1)[\s\S])*)\1/g;
    let m;
    while ((m = strRe.exec(noComments)) !== null) {
      if (/\s/.test(m[2])) {
        chunks.push(m[2]);
      }
    }
    return chunks.join('\n');
  }

  let working = content;
  const fmMatch = working.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (fmMatch) {
    const fmNoComments = fmMatch[1]
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:])\/\/.*$/gm, '$1 ');
    const strRe = /(['"`])((?:\\.|(?!\1)[\s\S])*)\1/g;
    let m;
    while ((m = strRe.exec(fmNoComments)) !== null) {
      // Skip module import paths and CSS/URL fragments
      if (/\s/.test(m[2]) && !m[2].startsWith('.') && !m[2].startsWith('http')) {
        chunks.push(m[2]);
      }
    }
    working = working.slice(fmMatch[0].length);
  }

  // Inspect multi-word user-facing copy literals inside <script> blocks (e.g., modal roasts/tributes)
  const scriptRe = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
  let sm;
  while ((sm = scriptRe.exec(working)) !== null) {
    const scriptBody = sm[1]
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:])\/\/.*$/gm, '$1 ');
    const strRe = /(['"`])((?:\\.|(?!\1)[\s\S])*)\1/g;
    let lit;
    while ((lit = strRe.exec(scriptBody)) !== null) {
      if (/\s/.test(lit[2]) && !lit[2].includes('=>')) {
        chunks.push(lit[2]);
      }
    }
  }

  const htmlWithoutCommentsAndBlocks = working
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ');

  // Capture user-facing HTML attribute copy (meta content, alt, aria-label, data-html, data-title, data-tip)
  const attrRe = /\b(?:content|alt|aria-label|data-html|data-title|data-caption|data-tip)=["']([^"']*)["']/gi;
  let am;
  while ((am = attrRe.exec(htmlWithoutCommentsAndBlocks)) !== null) {
    chunks.push(am[1]);
  }

  // Capture visible HTML text content outside tags
  chunks.push(htmlWithoutCommentsAndBlocks.replace(/<[^>]+>/g, ' '));
  return chunks.join('\n');
}

console.log(`Running SPEC-020 Overworld Validator against: ${ROOT}`);

// ============================================================================
// 1. Package & PixiJS v8 Dependency Contract
// ============================================================================
const pkgRaw = readRel('package.json');
if (!pkgRaw) {
  fail('package.json exists', `Missing package.json under ${ROOT}`);
} else {
  const pkg = JSON.parse(pkgRaw);
  const pixiSpec = pkg.dependencies?.['pixi.js'] ?? pkg.devDependencies?.['pixi.js'];
  if (!pixiSpec) {
    fail('pixi.js declared in package.json', 'Missing pixi.js dependency');
  } else if (!/(?:^|[~^>=<\s])8(?:\.|$)/.test(String(pixiSpec))) {
    fail('pixi.js v8 declared in package.json', `Expected v8, found "${pixiSpec}"`);
  } else {
    pass(`package.json declares pixi.js (${pixiSpec})`);
  }

  const installedPixiPkg = readRel('node_modules/pixi.js/package.json');
  if (installedPixiPkg) {
    const installedVersion = JSON.parse(installedPixiPkg).version;
    if (String(installedVersion).startsWith('8.')) {
      pass(`node_modules/pixi.js installed at v${installedVersion}`);
    } else {
      fail('node_modules/pixi.js is v8', `Installed version is ${installedVersion}`);
    }
  } else {
    notes.push('node_modules/pixi.js not present in validation root (normal for staged deliverables before sync/install).');
  }
}

// ============================================================================
// 2. Overworld Engine (PixiJS v8 WebGPU + WGSL Sky + 4 Party Members + Zones)
// ============================================================================
const engineSrc = readRel('src/scripts/overworld-engine.ts');
if (!engineSrc) {
  fail('src/scripts/overworld-engine.ts exists', 'File not found');
} else {
  pass('src/scripts/overworld-engine.ts exists');

  if (/from\s+['"]pixi\.js['"]/.test(engineSrc)) {
    pass('overworld-engine.ts imports pixi.js');
  } else {
    fail('overworld-engine.ts imports pixi.js', 'Missing pixi.js ES import');
  }

  if (/preference\s*:\s*['"]webgpu['"]/.test(engineSrc)) {
    pass("overworld-engine.ts configures preference: 'webgpu'");
  } else {
    fail("overworld-engine.ts configures preference: 'webgpu'", "Missing preference: 'webgpu'");
  }

  if (/export\s+const\s+WGSL_SKY_SHADER\b/.test(engineSrc) && /@vertex|@fragment|fn\s+\w+/.test(engineSrc)) {
    pass('overworld-engine.ts exports WGSL_SKY_SHADER with WGSL shader entrypoints');
  } else {
    fail('overworld-engine.ts exports WGSL_SKY_SHADER', 'Missing WGSL_SKY_SHADER or WGSL syntax');
  }

  if (/getHours\s*\(\)/.test(engineSrc) && /celestialToggle/.test(engineSrc)) {
    pass('overworld-engine.ts syncs Sun/Moon arc to local time + #celestialToggle');
  } else {
    fail('overworld-engine.ts Sun/Moon arc + #celestialToggle', 'Missing getHours() or celestialToggle wiring');
  }

  // All 4 traveling party members + memorial dog tribute names (Emy, Kiba, Yue)
  const partyChecks = [
    ['Boris', /\bBoris\b/],
    ['White Dog', /White\s*Dog/i],
    ['Emy', /\bEmy\b/],
    ['Kiba', /\bKiba\b/],
    ['Yue', /\bYue\b/],
    ['RASS', /\bRASS\b/],
    ['Ms. Devil', /Ms\.?\s*Devil/i],
  ];
  for (const [name, re] of partyChecks) {
    if (re.test(engineSrc)) {
      pass(`overworld-engine.ts includes party/tribute member ${name}`);
    } else {
      fail(`overworld-engine.ts includes party/tribute member ${name}`, `Pattern ${re} not found`);
    }
  }

  for (const zoneId of ['sanctuary', 'eras', 'relics', 'trophies', 'beacon']) {
    if (new RegExp(`['"]${zoneId}['"]`).test(engineSrc)) {
      pass(`overworld-engine.ts registers zone "${zoneId}"`);
    } else {
      fail(`overworld-engine.ts registers zone "${zoneId}"`, `Missing "${zoneId}"`);
    }
  }

  if (/roastChest/.test(engineSrc) && /playChestOpen/.test(engineSrc) && /playBarkChime/.test(engineSrc)) {
    pass('overworld-engine.ts wires roastChest + playChestOpen + playBarkChime');
  } else {
    fail('overworld-engine.ts interactive triggers', 'Missing roastChest, playChestOpen, or playBarkChime');
  }

  if (/IntersectionObserver/.test(engineSrc) && /prefers-reduced-motion/.test(engineSrc) && /__RASS_OVERWORLD_DEBUG__/.test(engineSrc)) {
    pass('overworld-engine.ts includes IntersectionObserver, reduced-motion, and opt-in debug hook');
  } else {
    fail('overworld-engine.ts observer/motion/debug hooks', 'Missing IntersectionObserver, prefers-reduced-motion, or __RASS_OVERWORLD_DEBUG__');
  }
}

// ============================================================================
// 3. Procedural Web Audio Chiptune Synthesizer (0 External Audio Assets)
// ============================================================================
const audioSrc = readRel('src/scripts/chiptune-audio.ts');
if (!audioSrc) {
  fail('src/scripts/chiptune-audio.ts exists', 'File not found');
} else {
  pass('src/scripts/chiptune-audio.ts exists');

  if (/AudioContext|webkitAudioContext/.test(audioSrc)) {
    pass('chiptune-audio.ts uses Web Audio API AudioContext');
  } else {
    fail('chiptune-audio.ts uses Web Audio API', 'Missing AudioContext');
  }

  if (/\.(mp3|wav|ogg|flac|m4a|aac)\b/i.test(audioSrc) || /new\s+Audio\s*\(/.test(audioSrc)) {
    fail('chiptune-audio.ts has 0 external audio files', 'Found external audio file reference or HTMLAudioElement');
  } else {
    pass('chiptune-audio.ts has 0 external audio files');
  }

  for (const method of ['playStep', 'playZoneChime', 'playBarkChime', 'playChestOpen', 'playToggle']) {
    if (new RegExp(`\\b${method}\\b`).test(audioSrc)) {
      pass(`chiptune-audio.ts defines ${method}()`);
    } else {
      fail(`chiptune-audio.ts defines ${method}()`, `Missing ${method}`);
    }
  }

  if (/resume\s*\(\)/.test(audioSrc)) {
    pass('chiptune-audio.ts enforces user-gesture AudioContext resume()');
  } else {
    fail('chiptune-audio.ts enforces user-gesture resume()', 'Missing ctx.resume() guard');
  }
}

// ============================================================================
// 4. OverworldStage.astro & WCAG 2.2.2 #motionToggle Check
// ============================================================================
const stageSrc = readRel('src/components/OverworldStage.astro');
if (!stageSrc) {
  fail('src/components/OverworldStage.astro exists', 'File not found');
} else {
  pass('src/components/OverworldStage.astro exists');

  for (const id of [
    'overworldStage',
    'overworldCanvasHost',
    'celestialToggle',
    'audioToggle',
    'motionToggle',
    'roastChestTrigger',
    'dogPetTrigger',
    'rendererBadge',
  ]) {
    if (findElementTagById(stageSrc, id)) {
      pass(`OverworldStage.astro renders #${id}`);
    } else {
      fail(`OverworldStage.astro renders #${id}`, `Missing element id="${id}"`);
    }
  }

  for (const zone of ['sanctuary', 'eras', 'relics', 'trophies', 'beacon']) {
    if (new RegExp(`data-travel-zone=["']${zone}["']`).test(stageSrc)) {
      pass(`OverworldStage.astro includes fast-travel button for "${zone}"`);
    } else {
      fail(`OverworldStage.astro includes fast-travel button for "${zone}"`, `Missing data-travel-zone="${zone}"`);
    }
  }

  const motionTag = findElementTagById(stageSrc, 'motionToggle');
  const engineNoComments = (engineSrc ?? '')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1 ');
  const setsAriaPressed = /setAttribute\s*\(\s*['"]aria-pressed['"]/i.test(engineNoComments);
  if (motionTag && !/aria-pressed/i.test(motionTag) && !setsAriaPressed) {
    pass('#motionToggle omits aria-pressed (WCAG 2.2.2 Pause/Play label toggle)');
  } else {
    fail('#motionToggle omits aria-pressed', 'Found aria-pressed on #motionToggle or setAttribute("aria-pressed") in overworld-engine.ts');
  }
}

// ============================================================================
// 5. BaseLayout.astro (Native Top-Layer <dialog> + Satirical Roasts)
// ============================================================================
const baseLayoutSrc = readRel('src/layouts/BaseLayout.astro');
if (!baseLayoutSrc) {
  fail('src/layouts/BaseLayout.astro exists', 'File not found');
} else {
  pass('src/layouts/BaseLayout.astro exists');

  const dialogTag = findElementTagById(baseLayoutSrc, 'heroWallModal');
  if (!dialogTag || !/^<dialog\b/i.test(dialogTag)) {
    fail('BaseLayout.astro uses native <dialog id="heroWallModal">', 'Missing <dialog id="heroWallModal">');
  } else {
    if (/closedby=["']any["']/i.test(dialogTag) && /aria-labelledby=["']modalTitle["']/i.test(dialogTag)) {
      pass('BaseLayout.astro <dialog id="heroWallModal"> uses closedby="any" and aria-labelledby="modalTitle"');
    } else {
      fail('BaseLayout.astro <dialog> required attributes', `Tag was: ${dialogTag}`);
    }
    if (/role=["']dialog["']/i.test(dialogTag) || /aria-modal/i.test(dialogTag)) {
      fail('BaseLayout.astro <dialog> omits redundant role/aria-modal', `Found forbidden attribute in: ${dialogTag}`);
    } else {
      pass('BaseLayout.astro <dialog> omits redundant role="dialog" and aria-modal');
    }
  }

  if (/id=["']modalOverlay["']/.test(baseLayoutSrc) || /document\.body\.classList\.add\(['"]no-scroll['"]\)/.test(baseLayoutSrc)) {
    fail('BaseLayout.astro removed legacy modalOverlay and body scroll lock', 'Found modalOverlay or no-scroll');
  } else {
    pass('BaseLayout.astro removed legacy modalOverlay and body scroll lock');
  }

  if (/showModal\s*\(/.test(baseLayoutSrc) && /'closedBy'\s+in\s+HTMLDialogElement\.prototype/.test(baseLayoutSrc)) {
    pass('BaseLayout.astro calls showModal() and includes closedBy fallback');
  } else {
    fail('BaseLayout.astro showModal() and closedBy fallback', 'Missing showModal() or HTMLDialogElement closedBy check');
  }

  const roastPhraseRe = /Prompt whisperer certificate:\s*burned/;
  if (roastPhraseRe.test(baseLayoutSrc) || roastPhraseRe.test(engineSrc ?? '')) {
    pass('Satirical roast "Prompt whisperer certificate: burned" present');
  } else {
    fail('Satirical roast "Prompt whisperer certificate: burned" present', 'Missing from BaseLayout.astro and overworld-engine.ts');
  }
}

// ============================================================================
// 6. All 5 Zones, Memorial Tribute, Relics (Camp David), Tablist & Contact
// ============================================================================
const indexSrc = readRel('src/pages/index.astro');
const aboutSrc = readRel('src/components/About.astro');
const timelineSrc = readRel('src/components/Timeline.astro');
const relicsSrc = readRel('src/components/Relics.astro');
const relicsDataSrc = readRel('src/data/relics.ts');
const badgeWallSrc = readRel('src/components/BadgeWall.astro');
const ctaSrc = readRel('src/components/CTA.astro');
const footerSrc = readRel('src/components/Footer.astro');
const cssSrc = readRel('src/styles/global.css');

const zoneSources = [
  aboutSrc ?? '',
  timelineSrc ?? '',
  relicsSrc ?? '',
  badgeWallSrc ?? '',
  ctaSrc ?? '',
].join('\n');

if (indexSrc && /<OverworldStage\b/.test(indexSrc)) {
  pass('src/pages/index.astro mounts <OverworldStage />');
} else {
  fail('src/pages/index.astro mounts <OverworldStage />', 'Missing <OverworldStage />');
}

for (const zone of ['sanctuary', 'eras', 'relics', 'trophies', 'beacon']) {
  const hasId = new RegExp(`id=["']${zone}["']`).test(zoneSources);
  const hasDataZone = new RegExp(`data-zone=["']${zone}["']`).test(zoneSources);
  if (hasId && hasDataZone) {
    pass(`Zone #${zone} wired with id="${zone}" and data-zone="${zone}"`);
  } else {
    fail(`Zone #${zone} attributes`, `hasId=${hasId}, hasDataZone=${hasDataZone}`);
  }
}

for (const legacyId of ['about', 'timeline', 'work', 'contact']) {
  if (new RegExp(`id=["']${legacyId}["']`).test(zoneSources)) {
    pass(`Legacy hash anchor #${legacyId} preserved`);
  } else {
    fail(`Legacy hash anchor #${legacyId} preserved`, `Missing id="${legacyId}"`);
  }
}

if (aboutSrc && /\bEmy\b/.test(aboutSrc) && /\bKiba\b/.test(aboutSrc) && /\bYue\b/.test(aboutSrc)) {
  pass('About.astro (#sanctuary) includes memorial tribute to Emy, Kiba, and Yue');
} else {
  fail('About.astro (#sanctuary) memorial tribute', 'Missing Emy, Kiba, or Yue in About.astro');
}

const combinedRelics = `${relicsSrc ?? ''}\n${relicsDataSrc ?? ''}`;
if (/KidsLab 3\.0/.test(combinedRelics) && /Infusio/.test(combinedRelics) && /Camp David/.test(combinedRelics)) {
  pass('Relic Vault (#relics) features KidsLab 3.0, Infusio, and Camp David');
} else {
  fail('Relic Vault (#relics) featured projects', 'Missing KidsLab 3.0, Infusio, or Camp David');
}

if (/Esencia Branding|esenciabranding\.com/i.test(combinedRelics)) {
  fail('Relic Vault (#relics) removes Esencia Branding', 'Found Esencia Branding / esenciabranding.com');
} else {
  pass('Relic Vault (#relics) removed retired Esencia Branding');
}

const allSrcFiles = walkFiles(path.join(ROOT, 'src'), (f) => /\.(astro|ts|js|mjs|json|css)$/.test(f));
const protonHits = allSrcFiles
  .filter((f) => /borisqj\+hero@proton\.me/i.test(fs.readFileSync(f, 'utf8')))
  .map((f) => path.relative(ROOT, f));

if (protonHits.length > 0) {
  fail('Retired email borisqj+hero@proton.me scrubbed from src/', `Found in: ${protonHits.join(', ')}`);
} else {
  pass('Retired email borisqj+hero@proton.me scrubbed from src/');
}

const contactBundle = `${indexSrc ?? ''}\n${ctaSrc ?? ''}\n${footerSrc ?? ''}`;
if (/boris\.quijano@live\.com/.test(contactBundle) && /\+503\s*7118\s*0568/.test(contactBundle)) {
  pass('Signal Beacon (#beacon / CTA / Footer) displays boris.quijano@live.com and +503 7118 0568');
} else {
  fail('Signal Beacon contact info', 'Missing boris.quijano@live.com or +503 7118 0568');
}

const combinedCss = `${baseLayoutSrc ?? ''}\n${badgeWallSrc ?? ''}\n${cssSrc ?? ''}`;

if (!badgeWallSrc) {
  fail('src/components/BadgeWall.astro exists', 'File not found');
} else {
  const filterTag = findElementTagById(badgeWallSrc, 'badgeFilters');
  if (filterTag && /focusgroup=["']tablist nomemory["']/.test(filterTag) && /aria-label=/.test(filterTag)) {
    pass('BadgeWall.astro #badgeFilters uses focusgroup="tablist nomemory" with aria-label');
  } else {
    fail('BadgeWall.astro #badgeFilters focusgroup', `Tag was: ${filterTag}`);
  }

  const hasSelectedAfter = /\[aria-selected=["']true["']\]::after[^{]*\{[^}]*border-block-end\s*:\s*3px\s+solid\s+var\(--cyan/i.test(combinedCss);
  if (
    /role=["']tab["']/.test(badgeWallSrc) &&
    /aria-selected=/.test(badgeWallSrc) &&
    /focusgroupstart/.test(badgeWallSrc) &&
    hasSelectedAfter &&
    /'focusGroup'\s+in\s+HTMLElement\.prototype/.test(badgeWallSrc)
  ) {
    pass('BadgeWall.astro implements accessible tab buttons, ::after indicator, and focusGroup fallback');
  } else {
    fail('BadgeWall.astro tablist accessibility & fallback', `Missing role="tab", aria-selected, focusgroupstart, ::after border-block-end (${hasSelectedAfter}), or focusGroup fallback`);
  }
}

// ============================================================================
// 7. CSS Checks: Top-Layer Dialog Containment & Mobile Game Boy Dual-Screen
// ============================================================================
if (
  /(?:dialog|\.hw-modal|#heroWallModal):modal[^{]*\{[^}]*overscroll-behavior\s*:\s*contain/i.test(combinedCss) &&
  /(?:dialog|\.hw-modal|#heroWallModal)::backdrop[^{]*\{[^}]*(?:overflow\s*:\s*hidden[\s\S]*?overscroll-behavior\s*:\s*contain|overscroll-behavior\s*:\s*contain[\s\S]*?overflow\s*:\s*hidden)/i.test(combinedCss)
) {
  pass('Dialog modal & backdrop enforce overscroll-behavior: contain');
} else {
  fail('Dialog overscroll containment CSS', 'Missing dialog:modal or dialog::backdrop overscroll-behavior: contain');
}

if (!cssSrc) {
  fail('src/styles/global.css exists', 'File not found');
} else {
  const mobileBlocks = extractMediaBlocks(cssSrc, /@media\s*\(\s*max-width\s*:\s*900px\s*\)/);
  const mobileCombined = mobileBlocks.join('\n');
  const hasStickyOverworld =
    /(?:\.overworld-shell|\.overworld-stage|#overworldStage)[^{]*\{[^}]*position\s*:\s*sticky[^}]*top\s*:\s*0/i.test(mobileCombined) ||
    /(?:\.overworld-shell|\.overworld-stage|#overworldStage)[^{]*\{[^}]*top\s*:\s*0[^}]*position\s*:\s*sticky/i.test(mobileCombined);

  if (mobileBlocks.length > 0 && hasStickyOverworld) {
    pass('global.css implements @media (max-width: 900px) sticky Game Boy dual-screen layout');
  } else {
    fail('global.css mobile Game Boy dual-screen CSS', 'Missing @media (max-width: 900px) sticky top: 0 rule on .overworld-shell or #overworldStage');
  }

  if (/\.no-scroll\s*\{\s*overflow\s*:\s*hidden/.test(cssSrc)) {
    fail('global.css removes legacy .no-scroll modal body lock', 'Found .no-scroll { overflow: hidden }');
  } else {
    pass('global.css removed legacy .no-scroll modal body lock');
  }
}

// ============================================================================
// 8. Humanizer Prose Hygiene Check (Owned Components & Data Copy)
// ============================================================================
const proseTargets = [
  'src/layouts/BaseLayout.astro',
  'src/pages/index.astro',
  'src/components/OverworldStage.astro',
  'src/components/Hero.astro',
  'src/components/About.astro',
  'src/components/Timeline.astro',
  'src/components/Relics.astro',
  'src/components/BadgeWall.astro',
  'src/components/CTA.astro',
  'src/components/Footer.astro',
  'src/data/relics.ts',
  'src/data/badges.ts',
];

const BANNED_AI_RE = /\b(showcase|showcasing|leverage|leveraging|seamless|seamlessly|crucial)\b/i;
const NOT_X_BUT_Y_RE = /\bnot\s+[^.!?\n]{1,35},\s+but\b/i;

for (const relPath of proseTargets) {
  const raw = readRel(relPath);
  if (!raw) continue;
  const prose = extractProseForHumanizer(relPath, raw);
  const hasDash = /[—–]/.test(prose);
  const bannedMatch = prose.match(BANNED_AI_RE);
  const notButMatch = prose.match(NOT_X_BUT_Y_RE);
  if (hasDash || bannedMatch || notButMatch) {
    const reasons = [];
    if (hasDash) reasons.push('em/en dash (—/–)');
    if (bannedMatch) reasons.push(`banned AI word "${bannedMatch[0]}"`);
    if (notButMatch) reasons.push(`"not X, but Y" contrast "${notButMatch[0]}"`);
    fail(`humanizer prose hygiene in ${relPath}`, reasons.join('; '));
  } else {
    pass(`humanizer prose hygiene clean in ${relPath}`);
  }
}

// ============================================================================
// 9. Built Output Validation (dist/ and .vercel/output/static/ when present)
// ============================================================================
const distHtmlFiles = walkFiles(path.join(ROOT, 'dist'), (f) => f.endsWith('.html'));
const vercelStaticHtmlFiles = walkFiles(path.join(ROOT, '.vercel/output/static'), (f) => f.endsWith('.html'));
const builtHtmlFiles = [...distHtmlFiles, ...vercelStaticHtmlFiles];

if (builtHtmlFiles.length === 0) {
  if (REQUIRE_BUILD) {
    fail('Built HTML present (--require-build)', 'Neither dist/*.html nor .vercel/output/static/*.html exists');
  } else {
    notes.push('No dist/*.html or .vercel/output/static/*.html found yet; build HTML checks will run automatically once built.');
  }
} else {
  const htmlCombined = builtHtmlFiles.map((f) => fs.readFileSync(f, 'utf8')).join('\n');
  const builtJsFiles = [
    ...walkFiles(path.join(ROOT, 'dist'), (f) => f.endsWith('.js') || f.endsWith('.mjs')),
    ...walkFiles(path.join(ROOT, '.vercel/output/static'), (f) => f.endsWith('.js') || f.endsWith('.mjs')),
  ];
  const jsCombined = builtJsFiles.map((f) => fs.readFileSync(f, 'utf8')).join('\n');
  const artifactCombined = `${htmlCombined}\n${jsCombined}`;

  pass(`Validating ${builtHtmlFiles.length} built HTML file(s): ${builtHtmlFiles.map((f) => path.relative(ROOT, f)).join(', ')}`);

  const requiredInHtml = [
    ['Overworld stage (#overworldStage)', /id=["']overworldStage["']/],
    ['Celestial toggle (#celestialToggle)', /id=["']celestialToggle["']/],
    ['Audio toggle (#audioToggle)', /id=["']audioToggle["']/],
    ['Motion toggle (#motionToggle)', /id=["']motionToggle["']/],
    ['Zone 1: Sanctuary Citadel', /Sanctuary Citadel/],
    ['Zone 2: Hall of Eras', /Hall of Eras/],
    ['Zone 3: Relic Vault', /Relic Vault/],
    ['Zone 4: Trophy Armory', /Trophy Armory/],
    ['Zone 5: Signal Beacon', /Signal Beacon/],
    ['Relic: KidsLab 3.0', /KidsLab 3\.0/],
    ['Relic: Infusio', /Infusio/],
    ['Relic: Camp David', /Camp David/],
    ['Memorial companion Emy', /\bEmy\b/],
    ['Memorial companion Kiba', /\bKiba\b/],
    ['Memorial companion Yue', /\bYue\b/],
    ['focusgroup="tablist nomemory"', /focusgroup=["']tablist\s+nomemory["']/],
    ['boris.quijano@live.com', /boris\.quijano@live\.com/],
    ['+503 7118 0568', /\+503\s*7118\s*0568/],
  ];

  for (const [label, re] of requiredInHtml) {
    if (re.test(htmlCombined)) {
      pass(`Built HTML contains ${label}`);
    } else {
      fail(`Built HTML contains ${label}`, `Pattern ${re} not found`);
    }
  }

  const builtDialog = findElementTagById(htmlCombined, 'heroWallModal');
  if (builtDialog && /^<dialog\b/i.test(builtDialog) && /closedby=["']any["']/i.test(builtDialog) && !/role=["']dialog["']|aria-modal/i.test(builtDialog)) {
    pass('Built HTML renders clean native <dialog id="heroWallModal" closedby="any">');
  } else {
    fail('Built HTML native <dialog id="heroWallModal">', `Tag was: ${builtDialog}`);
  }

  const builtMotionTag = findElementTagById(htmlCombined, 'motionToggle');
  if (builtMotionTag && !/aria-pressed/i.test(builtMotionTag)) {
    pass('Built HTML #motionToggle omits aria-pressed');
  } else {
    fail('Built HTML #motionToggle omits aria-pressed', `Tag was: ${builtMotionTag}`);
  }

  if (/Prompt whisperer certificate:\s*burned/.test(artifactCombined)) {
    pass('Built artifacts include roast "Prompt whisperer certificate: burned"');
  } else {
    fail('Built artifacts include roast "Prompt whisperer certificate: burned"', 'Not found in built HTML or JS');
  }

  if (/Esencia Branding|esenciabranding\.com|borisqj\+hero@proton\.me/i.test(htmlCombined)) {
    fail('Built HTML free of retired Esencia Branding / proton.me', 'Found retired domain or email in built HTML');
  } else {
    pass('Built HTML free of retired Esencia Branding and proton.me');
  }
}

// ============================================================================
// Summary
// ============================================================================
console.log(`\nOverworld Validation Summary: ${passes.length} passed, ${failures.length} failed.`);
for (const note of notes) {
  console.log(`[INFO] ${note}`);
}

if (failures.length > 0) {
  process.exit(1);
}
