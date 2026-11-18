#!/usr/bin/env node
/**
 * Path: scripts/validate-overworld.mjs
 * Purpose: Headless source and build-artifact validator for SPEC-022 (Hero Wall Studio Cozy
 *          Rebuild: Cozy Campfire Sanctuary & 3 Techno-Organic Alien Frontiers). Enforces
 *          zero-scroll 100dvh fixed viewport shell, sleek single-row mobile/desktop
 *          .overworld-bezel-top, 16:9 CRT letterboxing & scanlines, mobile 58dvh/42dvh GBA
 *          deck, 4 discrete rooms + 3 alien portals + return portals + Trophy Armory Lodge,
 *          24-color sprites (Boris w/ idleMug, sleeping dog w/ zero former names, RASS,
 *          Ms. Devil), unified Pokémon #pokemonStartMenu, contained #snesDialogueBox w/
 *          speaker nameplates, 7-state FSM w/ PORTAL_WARP iris/dissolve, hw_studio_state_v1
 *          localStorage persistence, Gamepad API, 16-bit Web Audio synthesis, native
 *          <dialog id="characterDossierModal" closedby="any"> & modern-web-guidance
 *          Baseline compliance, and built HTML/JS artifacts.
 * Spec Reference: SPEC-022 (specs/022-hero-wall-studio-cozy-rebuild/spec.md)
 *
 * Operator Notes:
 * - Supports `--root <dir>` or `--root=<dir>` (defaults to `process.env.HERO_WALL_ROOT`,
 *   else `process.cwd()` when `package.json` exists there, else parent of `scripts/`).
 * - Automatically validates `dist/` and `.vercel/output/static/` HTML/JS when present.
 * - Pass `--require-build` to fail if no built HTML files exist yet.
 * - Pass `--verbose` or set `OVERWORLD_VALIDATE_VERBOSE=1` to log every passing check.
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
 * Find the opening tag of an HTML element by exact id attribute after stripping Astro
 * frontmatter and HTML comments so doc comments never shadow real markup.
 * @param {string} html
 * @param {string} id
 * @returns {string | null}
 */
function findElementTagById(html, id) {
  const withoutFrontmatter = html.replace(/^---[\r\n][\s\S]*?[\r\n]---/m, '');
  const withoutComments = withoutFrontmatter.replace(/<!--[\s\S]*?-->/g, '');
  const re = new RegExp(`<([a-zA-Z0-9-]+)\\b[^>]*\\bid=["']${id}["'][^>]*>`, 'i');
  const match = withoutComments.match(re);
  return match ? match[0] : null;
}

/**
 * Extract balanced `@media (...) { ... }` blocks by brace depth so regex matches never
 * bleed across adjacent CSS rules.
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
 * Strip JS/TS/CSS comments before static pattern checks so old comments do not trigger false hits.
 * @param {string} src
 * @returns {string}
 */
function stripCodeComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1 ');
}

console.log(`Running SPEC-022 Overworld Validator against: ${ROOT}`);

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
    notes.push('node_modules/pixi.js not present in validation root (expected for staged deliverables before sync/install).');
  }
}

// ============================================================================
// 2. Global Styles: Zero Scroll 100dvh, Single-Row Mobile Bezel, CRT Letterbox & GBA Deck
// ============================================================================
const cssSrc = readRel('src/styles/global.css');
const dossierSrc = readRel('src/components/CharacterDossier.astro');
const dialogueBoxSrc = readRel('src/components/SnesDialogueBox.astro');
const combinedCssSurface = `${cssSrc ?? ''}\n${dossierSrc ?? ''}\n${dialogueBoxSrc ?? ''}`;

if (!cssSrc) {
  fail('src/styles/global.css exists', 'File not found');
} else {
  pass('src/styles/global.css exists');

  if (/100dvh/i.test(cssSrc) && /overflow\s*:\s*hidden/i.test(cssSrc)) {
    pass('global.css locks root viewport with 100dvh and overflow: hidden');
  } else {
    fail('global.css zero-scroll 100dvh + overflow: hidden', 'Missing 100dvh or overflow: hidden');
  }

  if (/\.crt-bezel-frame\b/.test(cssSrc) && /aspect-ratio\s*:\s*16\s*\/\s*9/i.test(cssSrc)) {
    pass('global.css defines responsive 16:9 letterboxed .crt-bezel-frame');
  } else {
    fail('global.css .crt-bezel-frame letterboxing', 'Missing .crt-bezel-frame or aspect-ratio: 16 / 9');
  }

  if (/\.crt-scanlines\b/.test(cssSrc) && /html\[data-crt=["']on["']\]/i.test(cssSrc)) {
    pass('global.css supports CRT scanline toggle via html[data-crt="on"] .crt-scanlines');
  } else {
    fail('global.css CRT scanline toggle', 'Missing .crt-scanlines or html[data-crt="on"]');
  }

  const mobileBlocks = extractMediaBlocks(cssSrc, /@media\s*\(\s*max-width\s*:\s*900px\s*\)/);
  const mobileCombined = mobileBlocks.join('\n');
  if (
    mobileBlocks.length > 0 &&
    /\.gba-controller-deck\b/.test(mobileCombined) &&
    /58dvh/i.test(mobileCombined) &&
    /42dvh/i.test(mobileCombined)
  ) {
    pass('global.css enforces @media (max-width: 900px) 58dvh/42dvh .gba-controller-deck dual-stage split');
  } else {
    fail('global.css mobile 58dvh/42dvh dual-stage layout', 'Missing 58dvh/42dvh or .gba-controller-deck inside @media (max-width: 900px)');
  }

  if (
    /\.overworld-bezel-top\b/.test(mobileCombined) &&
    /flex-wrap\s*:\s*nowrap/i.test(mobileCombined) &&
    /(?:max-block-size|max-height)\s*:\s*(?:3[6-9]|4[0-4])px/i.test(mobileCombined)
  ) {
    pass('global.css locks mobile .overworld-bezel-top to single unclipped row <= 44px');
  } else {
    fail('global.css mobile single-row bezel <= 44px', 'Missing flex-wrap: nowrap or <= 44px max height on .overworld-bezel-top inside mobile query');
  }

  for (const hex of ['#f97316', '#15803d', '#a855f7', '#ea580c', '#06b6d4', '#1C3B54', '#38C7E7']) {
    if (new RegExp(hex, 'i').test(cssSrc)) {
      pass(`global.css defines SPEC-022 palette color ${hex}`);
    } else {
      fail(`global.css defines SPEC-022 palette color ${hex}`, `Missing ${hex}`);
    }
  }

  if (
    /dialog[^{]*:modal[^{]*\{[^}]*overscroll-behavior\s*:\s*contain/is.test(cssSrc) &&
    /dialog[^{]*::backdrop[^{]*\{[^}]*overscroll-behavior\s*:\s*contain/is.test(cssSrc)
  ) {
    pass('global.css enforces dialog:modal and dialog::backdrop overscroll-behavior: contain');
  } else {
    fail('global.css dialog scroll containment', 'Missing dialog:modal or dialog::backdrop overscroll-behavior: contain');
  }

  if (/html\[data-motion=["']paused["']\]/i.test(cssSrc)) {
    pass('global.css supports html[data-motion="paused"] motion pause');
  } else {
    fail('global.css supports html[data-motion="paused"]', 'Missing html[data-motion="paused"] selector');
  }
}

// ============================================================================
// 3. BaseLayout.astro & index.astro (Pure Game Viewport, Zero Vertical Sections)
// ============================================================================
const baseLayoutSrc = readRel('src/layouts/BaseLayout.astro');
if (!baseLayoutSrc) {
  fail('src/layouts/BaseLayout.astro exists', 'File not found');
} else {
  pass('src/layouts/BaseLayout.astro exists');

  if (/<html\b[^>]*\blang=["']en["'][^>]*>/i.test(baseLayoutSrc) && /\.\.\/styles\/global\.css/.test(baseLayoutSrc)) {
    pass('BaseLayout.astro uses <html lang="en"> and loads ../styles/global.css');
  } else {
    fail('BaseLayout.astro html lang and global.css import', 'Missing <html lang="en"> or ../styles/global.css');
  }

  if (/viewport-fit=cover/i.test(baseLayoutSrc) && !/user-scalable\s*=\s*no|maximum-scale\s*=\s*1\b/i.test(baseLayoutSrc)) {
    pass('BaseLayout.astro sets viewport-fit=cover without disabling pinch zoom');
  } else {
    fail('BaseLayout.astro viewport meta', 'Missing viewport-fit=cover or disables pinch zoom');
  }

  if (/Press\+Start\+2P|Press Start 2P/.test(baseLayoutSrc) && /Inter/.test(baseLayoutSrc)) {
    pass('BaseLayout.astro loads Press Start 2P and Inter fonts');
  } else {
    fail('BaseLayout.astro font loading', 'Missing Press Start 2P or Inter font link');
  }

  if (
    /<link\b[^>]*rel=["']preload["'][^>]*href=["']\/img\/boris-portrait\.png["'][^>]*fetchpriority=["']high["'][^>]*>/i.test(baseLayoutSrc) ||
    /<link\b[^>]*href=["']\/img\/boris-portrait\.png["'][^>]*rel=["']preload["'][^>]*fetchpriority=["']high["'][^>]*>/i.test(baseLayoutSrc)
  ) {
    pass('BaseLayout.astro preloads /img/boris-portrait.png with fetchpriority="high"');
  } else {
    fail('BaseLayout.astro portrait preload', 'Missing <link rel="preload" href="/img/boris-portrait.png" ... fetchpriority="high">');
  }

  if (
    /<slot\s*\/>/.test(baseLayoutSrc) &&
    !/class=["'][^"']*parallax/i.test(baseLayoutSrc) &&
    !/id=["']heroWallModal["']/i.test(baseLayoutSrc) &&
    !/<nav\b/i.test(baseLayoutSrc)
  ) {
    pass('BaseLayout.astro renders <slot /> with zero navbar, parallax, or heroWallModal residue');
  } else {
    fail('BaseLayout.astro clean shell', 'Found navbar, parallax class, heroWallModal, or missing <slot />');
  }
}

const indexSrc = readRel('src/pages/index.astro');
if (!indexSrc) {
  fail('src/pages/index.astro exists', 'File not found');
} else {
  pass('src/pages/index.astro exists');

  if (
    /<OverworldStage\b/.test(indexSrc) &&
    /<CharacterDossier\b/.test(indexSrc) &&
    /<main\b[^>]*\bid=["']main["'][^>]*\bclass=["'][^"']*\bgame-viewport-root\b[^"']*["'][^>]*>/i.test(indexSrc)
  ) {
    pass('index.astro mounts <OverworldStage /> and <CharacterDossier /> inside <main id="main" class="game-viewport-root">');
  } else {
    fail('index.astro game viewport mount', 'Missing <main id="main" class="game-viewport-root">, <OverworldStage />, or <CharacterDossier />');
  }

  const forbiddenLegacy = ['About', 'Timeline', 'Relics', 'BadgeWall', 'CTA', 'Hero', 'Footer', 'Header', 'Skills', 'Work'];
  const legacyHits = forbiddenLegacy.filter((comp) =>
    new RegExp(`<${comp}\\b|components/${comp}\\.astro`, 'i').test(indexSrc)
  );
  if (legacyHits.length === 0) {
    pass('index.astro omits all legacy static vertical sections');
  } else {
    fail('index.astro omits legacy vertical sections', `Found forbidden component reference(s): ${legacyHits.join(', ')}`);
  }
}

// ============================================================================
// 4. OverworldStage.astro & SnesDialogueBox.astro (Single-Row Bezel, CRT, GBA Deck, START Menu)
// ============================================================================
const stageSrc = readRel('src/components/OverworldStage.astro');
const engineSrc = readRel('src/scripts/overworld-engine.ts');

if (!stageSrc) {
  fail('src/components/OverworldStage.astro exists', 'File not found');
} else {
  pass('src/components/OverworldStage.astro exists');

  const stageTag = findElementTagById(stageSrc, 'overworldStage');
  if (
    stageTag &&
    /\boverworld-stage\b/.test(stageTag) &&
    /\boverworld-shell\b/.test(stageTag) &&
    /data-zone-active=["']campfire["']/.test(stageTag)
  ) {
    pass('OverworldStage.astro renders #overworldStage.overworld-stage.overworld-shell[data-zone-active="campfire"]');
  } else {
    fail('OverworldStage.astro root #overworldStage', `Tag was: ${stageTag}`);
  }

  for (const textToken of ['BORIS', 'LVL 39', 'Campfire Sanctuary', 'EXPLORING', '[START]', '[C] Open Dossier']) {
    if (stageSrc.includes(textToken)) {
      pass(`OverworldStage.astro displays "${textToken}"`);
    } else {
      fail(`OverworldStage.astro displays "${textToken}"`, `Missing "${textToken}"`);
    }
  }

  if (!/ow-travel-nav|data-travel-zone/i.test(stageSrc)) {
    pass('OverworldStage.astro eliminates overlapping multi-button header fast-travel strip');
  } else {
    fail('OverworldStage.astro clean single-row bezel', 'Found legacy .ow-travel-nav or data-travel-zone in top bezel');
  }

  for (const id of [
    'overworldZoneLabel',
    'gameStateBadge',
    'btnOpenStartMenu',
    'motionToggle',
    'rendererBadge',
    'overworldCanvasHost',
    'overworldFallback',
    'fallbackOpenDossier',
    'dpadUp',
    'dpadDown',
    'dpadLeft',
    'dpadRight',
    'btnActionA',
    'btnActionB',
    'btnStartDossier',
    'btnSelectRoast',
    'dogPetTrigger',
    'roastChestTrigger',
    'btnOpenDossier',
  ]) {
    if (findElementTagById(stageSrc, id)) {
      pass(`OverworldStage.astro renders #${id}`);
    } else {
      fail(`OverworldStage.astro renders #${id}`, `Missing element id="${id}"`);
    }
  }

  const stageMarkupOnly = stageSrc
    .replace(/^---[\r\n][\s\S]*?[\r\n]---/m, '')
    .replace(/<!--[\s\S]*?-->/g, '');
  if (
    /<SnesDialogueBox\b/.test(stageMarkupOnly) &&
    /class=["'][^"']*\boverworld-bezel-top\b/.test(stageMarkupOnly) &&
    /class=["'][^"']*\boverworld-viewport\b/.test(stageMarkupOnly) &&
    /class=["'][^"']*\bcrt-bezel-frame\b/.test(stageMarkupOnly) &&
    /class=["'][^"']*\bcrt-scanlines\b/.test(stageMarkupOnly) &&
    /class=["'][^"']*\bgba-controller-deck\b/.test(stageMarkupOnly) &&
    /\binitOverworld\s*\(/.test(stageSrc)
  ) {
    pass('OverworldStage.astro wires bezel, .crt-bezel-frame, .crt-scanlines, <SnesDialogueBox />, .gba-controller-deck, and initOverworld()');
  } else {
    fail('OverworldStage.astro structural sections & initOverworld', 'Missing required container or initOverworld() call');
  }

  const motionTag = findElementTagById(stageSrc, 'motionToggle');
  const engineNoComments = stripCodeComments(engineSrc ?? '');
  const setsAriaPressedOnMotion =
    /(?:motionToggle|settingMotionBtn)[^;\n]*setAttribute\s*\(\s*['"]aria-pressed['"]/i.test(engineNoComments);
  if (motionTag && !/aria-pressed/i.test(motionTag) && !setsAriaPressedOnMotion) {
    pass('#motionToggle omits aria-pressed across markup and overworld-engine.ts');
  } else {
    fail('#motionToggle omits aria-pressed', 'Found aria-pressed on #motionToggle or setAttribute("aria-pressed") on motion button');
  }
}

if (!dialogueBoxSrc) {
  fail('src/components/SnesDialogueBox.astro exists', 'File not found');
} else {
  pass('src/components/SnesDialogueBox.astro exists');

  for (const id of [
    'snesDialogueBox',
    'snesDialogueTitle',
    'snesSpeakerName',
    'snesStatePill',
    'snesDialogueText',
    'snesInspectorContent',
    'snesChoiceList',
    'snesContinueBtn',
    'snesCloseBtn',
    'interactionPrompt',
    'moraleToast',
    'overworldLiveRegion',
    'pokemonStartMenu',
    'startMenuCommandList',
    'startMenuResumeBtn',
    'settingAudioBtn',
    'settingCrackleBtn',
    'settingCrtBtn',
    'settingSkyBtn',
    'settingMotionBtn',
  ]) {
    if (findElementTagById(dialogueBoxSrc, id)) {
      pass(`SnesDialogueBox.astro renders #${id}`);
    } else {
      fail(`SnesDialogueBox.astro renders #${id}`, `Missing id="${id}"`);
    }
  }

  const settingMotionTag = findElementTagById(dialogueBoxSrc, 'settingMotionBtn');
  if (settingMotionTag && !/aria-pressed/i.test(settingMotionTag)) {
    pass('SnesDialogueBox.astro #settingMotionBtn omits aria-pressed');
  } else {
    fail('SnesDialogueBox.astro #settingMotionBtn omits aria-pressed', `Tag was: ${settingMotionTag}`);
  }

  for (const warpRoom of ['campfire', 'cyber_chasm', 'bio_forge', 'signal_beacon']) {
    if (/data-warp-room=\{room\.id\}/.test(dialogueBoxSrc) || new RegExp(`data-warp-room=["']${warpRoom}["']`).test(dialogueBoxSrc)) {
      pass(`SnesDialogueBox.astro wires Town Map warp for "${warpRoom}"`);
    } else {
      fail(`SnesDialogueBox.astro Town Map warp for "${warpRoom}"`, 'Missing [data-warp-room] binding');
    }
  }

  for (const menuAction of ['dossier', 'relics', 'town-map', 'badges', 'transmit', 'settings', 'credits']) {
    const gameContentForMenu = readRel('src/data/game-content.ts') ?? '';
    if (
      dialogueBoxSrc.includes(menuAction) ||
      (dialogueBoxSrc.includes('START_MENU_COMMANDS') && new RegExp(`action:\\s*['"]${menuAction}['"]`).test(gameContentForMenu))
    ) {
      pass(`SnesDialogueBox.astro exposes Start Menu command "${menuAction}"`);
    } else {
      fail(`SnesDialogueBox.astro exposes Start Menu command "${menuAction}"`, `Missing action "${menuAction}"`);
    }
  }

  if (/snes-advance-arrow/.test(dialogueBoxSrc) && /&#9660;|▼/.test(dialogueBoxSrc)) {
    pass('SnesDialogueBox.astro renders animated advance arrow (▼)');
  } else {
    fail('SnesDialogueBox.astro animated advance arrow', 'Missing .snes-advance-arrow or ▼ glyph');
  }
}

// ============================================================================
// 5. Pixel Sprites (pixel-sprites.ts) — 24-Color Cozy Hearth & Alien Props
// ============================================================================
const spritesSrc = readRel('src/scripts/pixel-sprites.ts');
if (!spritesSrc) {
  fail('src/scripts/pixel-sprites.ts exists', 'File not found');
} else {
  pass('src/scripts/pixel-sprites.ts exists');

  for (const sym of [
    'SPRITE_PALETTE',
    'BORIS_SPRITE_FRAMES',
    'SLEEPING_DOG_FRAMES',
    'DOG_WAKE_FRAMES',
    'RASS_DRONE_FRAMES',
    'MS_DEVIL_FRAMES',
    'WORLD_OBJECT_SPRITES',
    'createSpriteTextureSet',
    'drawMatrixFrame',
  ]) {
    if (new RegExp(`export\\s+(?:const|function)\\s+${sym}\\b`).test(spritesSrc)) {
      pass(`pixel-sprites.ts exports ${sym}`);
    } else {
      fail(`pixel-sprites.ts exports ${sym}`, `Missing export ${sym}`);
    }
  }

  const has4DirsAndMug =
    /\bdown\s*:/.test(spritesSrc) &&
    /\bup\s*:/.test(spritesSrc) &&
    /\bleft\s*:/.test(spritesSrc) &&
    /\bright\s*:/.test(spritesSrc) &&
    /\bidleMug\s*:/.test(spritesSrc);
  const hasBoris4Frames = /down\s*:\s*\[[^\]]*,[^\]]*,[^\]]*,[^\]]*\]/s.test(spritesSrc);
  if (has4DirsAndMug && hasBoris4Frames) {
    pass('pixel-sprites.ts defines 4-directional 4-frame Boris walk cycle + idleMug');
  } else {
    fail('pixel-sprites.ts Boris directional + idleMug frames', `has4DirsAndMug=${has4DirsAndMug}, has4Frames=${hasBoris4Frames}`);
  }

  if (
    /SLEEPING_DOG_FRAMES\b[^=]*=\s*\[[^\]]*,[^\]]*,[^\]]*,[^\]]*\]/s.test(spritesSrc) &&
    /RASS_DRONE_FRAMES\b[^=]*=\s*\[[^\]]*,[^\]]*\]/s.test(spritesSrc) &&
    /MS_DEVIL_FRAMES\b[^=]*=\s*\[[^\]]*,[^\]]*\]/s.test(spritesSrc)
  ) {
    pass('pixel-sprites.ts defines SLEEPING_DOG_FRAMES (4), RASS_DRONE_FRAMES (2), and MS_DEVIL_FRAMES (2)');
  } else {
    fail('pixel-sprites.ts companion frame definitions', 'Missing frame counts for sleeping dog, RASS, or Ms. Devil');
  }

  for (const propKey of ['campfire', 'shelter', 'armoryLodge', 'portalAlien', 'returnPortal', 'eraObelisk', 'bioPod', 'beaconDish', 'roastChest', 'wovenMat']) {
    if (new RegExp(`\\b${propKey}\\s*:`).test(spritesSrc)) {
      pass(`pixel-sprites.ts WORLD_OBJECT_SPRITES includes ${propKey}`);
    } else {
      fail(`pixel-sprites.ts WORLD_OBJECT_SPRITES includes ${propKey}`, `Missing ${propKey}`);
    }
  }

  if (/\.(png|webp|jpg|jpeg|gif)\b/i.test(stripCodeComments(spritesSrc))) {
    fail('pixel-sprites.ts has zero external sprite image assets', 'Found image extension in code');
  } else {
    pass('pixel-sprites.ts has zero external sprite image assets');
  }
}

// ============================================================================
// 6. Room Topologies & WGSL Shader (world-biomes.ts)
// ============================================================================
const biomesSrc = readRel('src/scripts/world-biomes.ts');
if (!biomesSrc) {
  fail('src/scripts/world-biomes.ts exists', 'File not found');
} else {
  pass('src/scripts/world-biomes.ts exists');

  for (const sym of [
    'ROOM_WIDTH',
    'ROOM_HEIGHT',
    'WALKABLE_BOUNDS',
    'ROOM_TOPOLOGIES',
    'ROOM_HOTSPOTS',
    'BIOME_DEFINITIONS',
    'WGSL_SKY_VERTEX',
    'WGSL_SKY_SHADER',
    'paintRoomBackdrop',
  ]) {
    if (new RegExp(`export\\s+(?:const|function)\\s+${sym}\\b`).test(biomesSrc)) {
      pass(`world-biomes.ts exports ${sym}`);
    } else {
      fail(`world-biomes.ts exports ${sym}`, `Missing export ${sym}`);
    }
  }

  if (/@vertex|@fragment|fn\s+\w+/.test(biomesSrc)) {
    pass('world-biomes.ts WGSL_SKY_SHADER contains valid WGSL shader syntax');
  } else {
    fail('world-biomes.ts WGSL shader syntax', 'Missing @vertex/@fragment/fn entrypoints');
  }

  for (const roomId of ['campfire', 'cyber_chasm', 'bio_forge', 'signal_beacon']) {
    if (new RegExp(`['"]${roomId}['"]`).test(biomesSrc)) {
      pass(`world-biomes.ts defines room topology "${roomId}"`);
    } else {
      fail(`world-biomes.ts defines room topology "${roomId}"`, `Missing "${roomId}"`);
    }
  }

  if (
    /portal-cyber-chasm/.test(biomesSrc) &&
    /portal-bio-forge/.test(biomesSrc) &&
    /portal-signal-beacon/.test(biomesSrc) &&
    /return-cyber-chasm/.test(biomesSrc) &&
    /return-bio-forge/.test(biomesSrc) &&
    /return-signal-beacon/.test(biomesSrc) &&
    /trophy-armory/.test(biomesSrc)
  ) {
    pass('world-biomes.ts wires 3 alien portals, 3 return portals, and Trophy Armory Lodge in campfire');
  } else {
    fail('world-biomes.ts portal & Trophy Armory hotspots', 'Missing one or more alien portals, return portals, or trophy-armory');
  }
}

// ============================================================================
// 7. Overworld Engine (PixiJS v8 WebGPU + 7-State FSM + PORTAL_WARP + Gamepad + Persistence)
// ============================================================================
if (!engineSrc) {
  fail('src/scripts/overworld-engine.ts exists', 'File not found');
} else {
  pass('src/scripts/overworld-engine.ts exists');

  if (/from\s+['"]pixi\.js['"]/.test(engineSrc) && /preference\s*:\s*['"]webgpu['"]/.test(engineSrc)) {
    pass("overworld-engine.ts imports pixi.js and configures preference: 'webgpu'");
  } else {
    fail("overworld-engine.ts PixiJS v8 WebGPU setup", "Missing pixi.js import or preference: 'webgpu'");
  }

  for (const fsmState of ['EXPLORING', 'PORTAL_WARP', 'DIALOGUE', 'START_MENU', 'INSPECT_RELIC', 'CHARACTER_SHEET', 'MIMIC_ROAST']) {
    if (new RegExp(`['"]${fsmState}['"]`).test(engineSrc)) {
      pass(`overworld-engine.ts handles FSM state "${fsmState}"`);
    } else {
      fail(`overworld-engine.ts handles FSM state "${fsmState}"`, `Missing "${fsmState}"`);
    }
  }

  for (const [label, pattern] of [
    ['PORTAL_WARP iris/dissolve transition', /(?:iris|dissolve)/i],
    ['localStorage persistence (hw_studio_state_v1 / STUDIO_STORAGE_KEY)', /hw_studio_state_v1|STUDIO_STORAGE_KEY/],
    ['Gamepad API polling (getGamepads)', /getGamepads/],
    ['Unified #pokemonStartMenu wiring', /pokemonStartMenu/],
    ['returnPortal handling', /return_portal|returnPortal/i],
    ['Boris idleMug sprite channel', /idleMug/],
    ['SLEEPING_DOG / sleepingDog sprite wiring', /sleepingDog|SLEEPING_DOG/],
    ['Debug & reduced-motion hooks', /__RASS_OVERWORLD_DEBUG__[\s\S]*prefers-reduced-motion|prefers-reduced-motion[\s\S]*__RASS_OVERWORLD_DEBUG__/],
  ]) {
    if (pattern.test(engineSrc)) {
      pass(`overworld-engine.ts implements ${label}`);
    } else {
      fail(`overworld-engine.ts implements ${label}`, `Pattern ${pattern} not found`);
    }
  }
}

// ============================================================================
// 8. 16-Bit Procedural Web Audio Synthesizer (chiptune-audio.ts)
// ============================================================================
const audioSrc = readRel('src/scripts/chiptune-audio.ts');
if (!audioSrc) {
  fail('src/scripts/chiptune-audio.ts exists', 'File not found');
} else {
  pass('src/scripts/chiptune-audio.ts exists');

  if (/\.(mp3|wav|ogg|flac|m4a|aac)\b/i.test(stripCodeComments(audioSrc)) || /new\s+Audio\s*\(/.test(audioSrc)) {
    fail('chiptune-audio.ts has 0 external audio files', 'Found audio file reference or new Audio()');
  } else {
    pass('chiptune-audio.ts has 0 external audio files');
  }

  if (/AudioContext|webkitAudioContext/.test(audioSrc) && /resume\s*\(\)/.test(audioSrc)) {
    pass('chiptune-audio.ts uses gesture-gated AudioContext + resume()');
  } else {
    fail('chiptune-audio.ts Web Audio gating', 'Missing AudioContext or resume()');
  }

  for (const method of [
    'playCampfireCrackle',
    'playPortalWarp',
    'playPortalHum',
    'playStep',
    'playBarkChime',
    'playTypewriterBlip',
    'playMenuBlip',
    'playChestOpen',
    'playConfirm',
    'playCancel',
    'playToggle',
    'playZoneChime',
  ]) {
    if (new RegExp(`\\b${method}\\b`).test(audioSrc)) {
      pass(`chiptune-audio.ts defines ${method}()`);
    } else {
      fail(`chiptune-audio.ts defines ${method}()`, `Missing ${method}`);
    }
  }
}

// ============================================================================
// 9. CharacterDossier.astro (Native <dialog>, Portrait Bezel, Focusgroup Tabs)
// ============================================================================
if (!dossierSrc) {
  fail('src/components/CharacterDossier.astro exists', 'File not found');
} else {
  pass('src/components/CharacterDossier.astro exists');

  const dialogTag = findElementTagById(dossierSrc, 'characterDossierModal');
  if (!dialogTag || !/^<dialog\b/i.test(dialogTag)) {
    fail('CharacterDossier.astro uses native <dialog id="characterDossierModal">', 'Missing <dialog id="characterDossierModal">');
  } else {
    if (/closedby=["']any["']/i.test(dialogTag) && /aria-labelledby=/i.test(dialogTag)) {
      pass('CharacterDossier.astro <dialog> sets closedby="any" and aria-labelledby');
    } else {
      fail('CharacterDossier.astro <dialog> attributes', `Tag was: ${dialogTag}`);
    }
    if (/role=["']dialog["']/i.test(dialogTag) || /aria-modal/i.test(dialogTag)) {
      fail('CharacterDossier.astro <dialog> omits role="dialog" and aria-modal', `Found forbidden attribute in: ${dialogTag}`);
    } else {
      pass('CharacterDossier.astro <dialog> omits role="dialog" and aria-modal');
    }
  }

  if (/showModal\s*\(/.test(dossierSrc) && /'closedBy'\s+in\s+HTMLDialogElement\.prototype/.test(dossierSrc)) {
    pass('CharacterDossier.astro calls showModal() and includes closedBy fallback');
  } else {
    fail('CharacterDossier.astro showModal / closedBy fallback', 'Missing showModal() or closedBy feature check');
  }

  const gameContentForPortrait = readRel('src/data/game-content.ts') ?? '';
  const hasPortrait =
    /\/img\/boris-portrait\.png/.test(dossierSrc) ||
    (/CHARACTER_DOSSIER\.image/.test(dossierSrc) && /\/img\/boris-portrait\.png/.test(gameContentForPortrait));
  if (hasPortrait && /\.pixel-gold-bezel\b|class=["'][^"']*pixel-gold-bezel/.test(dossierSrc)) {
    pass('CharacterDossier.astro preserves /img/boris-portrait.png inside .pixel-gold-bezel');
  } else {
    fail('CharacterDossier.astro portrait & pixel-gold-bezel', 'Missing /img/boris-portrait.png or .pixel-gold-bezel');
  }

  const hasSelectedAfter = /\[aria-selected=["']true["']\]::after[^{]*\{[^}]*border-block-end\s*:\s*3px\s+solid/i.test(combinedCssSurface);
  if (
    /focusgroup=["']tablist\s+nomemory["']/.test(dossierSrc) &&
    /role=["']tab["']/.test(dossierSrc) &&
    /aria-selected=/.test(dossierSrc) &&
    /focusgroupstart/.test(dossierSrc) &&
    /'focusGroup'\s+in\s+HTMLElement\.prototype/.test(dossierSrc) &&
    hasSelectedAfter
  ) {
    pass('CharacterDossier.astro implements focusgroup="tablist nomemory" + fallback + ::after indicator');
  } else {
    fail('CharacterDossier.astro focusgroup tablist & fallback', `Missing focusgroup, role="tab", focusgroupstart, focusGroup check, or ::after rule (${hasSelectedAfter})`);
  }

  if (/CharacterDossierTerminal/.test(dossierSrc) && /hw:dossier-close/.test(dossierSrc)) {
    pass('CharacterDossier.astro exposes CharacterDossierTerminal and hw:dossier-close');
  } else {
    fail('CharacterDossier.astro terminal API', 'Missing CharacterDossierTerminal or hw:dossier-close event');
  }
}

// ============================================================================
// 10. Game Content, Speaker Nameplates, 21 Trophy Cards, Hygiene & Headers
// ============================================================================
const gameContentSrc = readRel('src/data/game-content.ts');
const badgesSrc = readRel('src/data/badges.ts');

if (!gameContentSrc) {
  fail('src/data/game-content.ts exists', 'File not found');
} else {
  pass('src/data/game-content.ts exists');

  const requiredTokens = [
    'hw_studio_state_v1',
    '[BORIS]',
    '[RASS]',
    '[MS. DEVIL]',
    '[THE DOG]',
    '[TERMINAL]',
    'KidsLab 3.0 Core Matrix',
    'Infusio AI Studio Engine',
    'Camp David Field Compass',
    'boris.quijano@live.com',
    '50371180568',
    'Prompt whisperer certificate: burned',
    'Certified Prompt Engineer Diploma',
    '+10 Morale Restored',
    'https://kidslab.education',
    'https://infusio.pro',
    'https://cal.com/borisquijano',
    'Pull up a seat by the fire, traveler',
  ];

  for (const token of requiredTokens) {
    if (gameContentSrc.includes(token)) {
      pass(`game-content.ts contains "${token}"`);
    } else {
      fail(`game-content.ts contains "${token}"`, `Missing "${token}"`);
    }
  }

  if (/export\s+const\s+TROPHY_CARDS\b/.test(gameContentSrc) && /from\s+['"]\.\/badges(?:\.ts)?['"]/.test(gameContentSrc)) {
    pass('game-content.ts wraps TROPHY_CARDS from ./badges');
  } else {
    fail('game-content.ts wraps TROPHY_CARDS from ./badges', 'Missing TROPHY_CARDS or ./badges import');
  }
}

if (!badgesSrc) {
  fail('src/data/badges.ts exists', 'File not found');
} else {
  const arrayBody = badgesSrc.split(/export\s+const\s+badges\b/)[1] ?? badgesSrc;
  const badgeEntries = arrayBody.match(/\{\s*name\s*:\s*['"]/g) ?? [];
  if (badgeEntries.length === 21) {
    pass('src/data/badges.ts defines all 21 trophy cards');
  } else {
    fail('src/data/badges.ts defines 21 trophy cards', `Found ${badgeEntries.length} entries`);
  }
}

// Strict Hygiene Scrub across ALL src/ files:
// - ZERO occurrences of former dog names (Emy, Kiba, Yue — case-insensitive word check)
// - ZERO occurrences of borisqj+hero@proton.me or Esencia
const allSrcFiles = walkFiles(path.join(ROOT, 'src'), (f) => /\.(astro|ts|js|mjs|json|css)$/.test(f));

const dogNameHits = allSrcFiles
  .filter((f) => /\b(?:emy|kiba|yue)\b/i.test(fs.readFileSync(f, 'utf8')))
  .map((f) => path.relative(ROOT, f));

if (dogNameHits.length === 0) {
  pass('src/ contains ZERO occurrences of former dog names (Emy/Kiba/Yue)');
} else {
  fail('src/ zero former dog names check (Emy/Kiba/Yue)', `Found in: ${dogNameHits.join(', ')}`);
}

const retiredHits = allSrcFiles
  .filter((f) => /borisqj\+hero@proton\.me|\besencia\b|esenciabranding\.com/i.test(fs.readFileSync(f, 'utf8')))
  .map((f) => path.relative(ROOT, f));

if (retiredHits.length === 0) {
  pass('src/ contains ZERO retired proton.me email or Esencia references');
} else {
  fail('src/ retired email/brand scrub', `Found in: ${retiredHits.join(', ')}`);
}

// RULE[user_global] headers across SPEC-022 core authored files
const headerTargets = [
  'src/layouts/BaseLayout.astro',
  'src/pages/index.astro',
  'src/components/OverworldStage.astro',
  'src/components/SnesDialogueBox.astro',
  'src/components/CharacterDossier.astro',
  'src/styles/global.css',
  'src/data/game-content.ts',
  'src/scripts/pixel-sprites.ts',
  'src/scripts/world-biomes.ts',
  'src/scripts/chiptune-audio.ts',
  'src/scripts/overworld-engine.ts',
];
for (const rel of headerTargets) {
  const content = readRel(rel);
  if (!content) continue;
  const head = content.slice(0, 1400);
  if (/Path:/i.test(head) && /Purpose:/i.test(head) && /SPEC-022/i.test(head)) {
    pass(`RULE[user_global] header present in ${rel}`);
  } else {
    fail(`RULE[user_global] header present in ${rel}`, 'Missing Path/Purpose/SPEC-022 header');
  }
}

// ============================================================================
// 11. Built Output Validation (dist/ and .vercel/output/static/ when present)
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
    ['Top HUD character chip (BORIS · LVL 39)', /BORIS\s*·\s*LVL 39/],
    ['Zone readout (#overworldZoneLabel)', /id=["']overworldZoneLabel["']/],
    ['State badge (#gameStateBadge)', /id=["']gameStateBadge["']/],
    ['Start Menu button (#btnOpenStartMenu)', /id=["']btnOpenStartMenu["']/],
    ['Motion toggle (#motionToggle)', /id=["']motionToggle["']/],
    ['Renderer badge (#rendererBadge)', /id=["']rendererBadge["']/],
    ['CRT bezel frame (.crt-bezel-frame)', /class=["'][^"']*\bcrt-bezel-frame\b/],
    ['CRT scanlines layer (.crt-scanlines)', /class=["'][^"']*\bcrt-scanlines\b/],
    ['SNES dialogue box (#snesDialogueBox)', /id=["']snesDialogueBox["']/],
    ['Pokemon START menu (#pokemonStartMenu)', /id=["']pokemonStartMenu["']/],
    ['GBA controller deck (.gba-controller-deck)', /class=["'][^"']*\bgba-controller-deck\b/],
    ['D-Pad controls (#dpadUp)', /id=["']dpadUp["']/],
    ['Boris portrait (/img/boris-portrait.png)', /\/img\/boris-portrait\.png/],
    ['focusgroup="tablist nomemory"', /focusgroup=["']tablist\s+nomemory["']/],
    ['KidsLab 3.0 Core Matrix', /KidsLab 3\.0 Core Matrix/],
    ['Infusio AI Studio Engine', /Infusio AI Studio Engine/],
    ['Camp David Field Compass', /Camp David Field Compass/],
    ['boris.quijano@live.com', /boris\.quijano@live\.com/],
    ['50371180568', /50371180568/],
    ['+10 Morale Restored', /\+10 Morale Restored/],
  ];

  for (const [label, re] of requiredInHtml) {
    if (re.test(htmlCombined)) {
      pass(`Built HTML contains ${label}`);
    } else {
      fail(`Built HTML contains ${label}`, `Pattern ${re} not found`);
    }
  }

  const builtDialog = findElementTagById(htmlCombined, 'characterDossierModal');
  if (
    builtDialog &&
    /^<dialog\b/i.test(builtDialog) &&
    /closedby=["']any["']/i.test(builtDialog) &&
    !/role=["']dialog["']|aria-modal/i.test(builtDialog)
  ) {
    pass('Built HTML renders clean native <dialog id="characterDossierModal" closedby="any">');
  } else {
    fail('Built HTML native <dialog id="characterDossierModal">', `Tag was: ${builtDialog}`);
  }

  const builtMotionTag = findElementTagById(htmlCombined, 'motionToggle');
  if (builtMotionTag && !/aria-pressed/i.test(builtMotionTag)) {
    pass('Built HTML #motionToggle omits aria-pressed');
  } else {
    fail('Built HTML #motionToggle omits aria-pressed', `Tag was: ${builtMotionTag}`);
  }

  if (/<section\b[^>]*\bid=["'](?:about|timeline|work|contact)["']/i.test(htmlCombined)) {
    fail('Built HTML removes legacy static page sections', 'Found legacy <section id="about|timeline|work|contact">');
  } else {
    pass('Built HTML omits legacy vertical document sections');
  }

  if (
    /Prompt whisperer certificate:\s*burned/.test(artifactCombined) &&
    /Certified Prompt Engineer Diploma/.test(artifactCombined)
  ) {
    pass('Built artifacts include roast strings ("Prompt whisperer certificate: burned" & "Certified Prompt Engineer Diploma")');
  } else {
    fail('Built artifacts include roast strings', 'Missing roast strings in built HTML or JS');
  }

  if (/\b(?:emy|kiba|yue)\b/i.test(artifactCombined)) {
    fail('Built HTML/JS contains zero former dog names (Emy/Kiba/Yue)', 'Found retired dog name in built artifacts');
  } else {
    pass('Built HTML/JS contains zero former dog names (Emy/Kiba/Yue)');
  }

  if (/\besencia\b|esenciabranding\.com|borisqj\+hero@proton\.me/i.test(artifactCombined)) {
    fail('Built artifacts free of retired Esencia / proton.me', 'Found retired domain or email in built artifacts');
  } else {
    pass('Built artifacts free of retired Esencia and proton.me');
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
