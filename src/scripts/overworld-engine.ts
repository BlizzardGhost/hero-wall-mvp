/**
 * Path: src/scripts/overworld-engine.ts
 * Purpose: PixiJS v8 WebGPU (with WebGL2/Canvas fallback) 16-bit RPG Overworld
 *          engine featuring a WGSL dynamic day/night sky shader, celestial
 *          Sun/Moon arc, procedural 16-bit pixel-art sprites for Boris, White Dog
 *          (Emy, Kiba, and Yue memorial), RASS, and Ms. Devil, 5 zone landmarks,
 *          an interactive roast chest, dual-engine keyboard + fast-travel
 *          navigation, IntersectionObserver scroll sync, and WCAG 2.2.2 motion toggle.
 * Spec Reference: SPEC-020 (020-hero-wall-16bit-overworld-implementation)
 */

import {
  Application,
  CanvasSource,
  Container,
  Graphics,
  Mesh,
  MeshGeometry,
  RendererType,
  Shader,
  Sprite,
  Text,
  Texture,
  TextureStyle,
  UniformGroup,
} from 'pixi.js';
import { chiptuneAudio } from './chiptune-audio';

export type ZoneId = 'sanctuary' | 'eras' | 'relics' | 'trophies' | 'beacon';

export interface OverworldZoneConfig {
  id: ZoneId;
  index: number;
  name: string;
  shortLabel: string;
  worldX: number;
  accentHex: number;
  subtitle: string;
}

export interface HeroWallModalPayload {
  title: string;
  body?: string | string[];
  html?: string;
  eyebrow?: string;
  tag?: string;
}

declare global {
  interface Window {
    __RASS_OVERWORLD_DEBUG__?: boolean;
    HeroWallModal?: {
      open: (payload: HeroWallModalPayload) => void;
      close: () => void;
    };
    HeroWallRoasts?: string[];
  }
}

/**
 * WGSL dynamic sky shader source compiled for WebGPU (`GpuProgram` via `Shader.from`).
 * Uses 16-byte aligned vec4<f32> uniforms in @group(2) to drive quantized 16-bit
 * sky gradient bands, solar/lunar arc aura, dawn/dusk twilight warmth, and night stars.
 */
export const WGSL_SKY_VERTEX = `
struct GlobalUniforms {
  uProjectionMatrix: mat3x3<f32>,
  uWorldTransformMatrix: mat3x3<f32>,
  uWorldColorAlpha: vec4<f32>,
  uResolution: vec2<f32>,
};
@group(0) @binding(0) var<uniform> globalUniforms : GlobalUniforms;

struct LocalUniforms {
  uTransformMatrix: mat3x3<f32>,
  uColor: vec4<f32>,
  uRound: f32,
};
@group(1) @binding(0) var<uniform> localUniforms : LocalUniforms;

struct SkyVertexOut {
  @builtin(position) position: vec4<f32>,
  @location(0) uv: vec2<f32>,
};

@vertex
fn main(
  @location(0) aPosition: vec2<f32>,
  @location(1) aUV: vec2<f32>,
) -> SkyVertexOut {
  var out: SkyVertexOut;
  let mvp = globalUniforms.uProjectionMatrix * globalUniforms.uWorldTransformMatrix * localUniforms.uTransformMatrix;
  out.position = vec4<f32>((mvp * vec3<f32>(aPosition, 1.0)).xy, 0.0, 1.0);
  out.uv = aUV;
  return out;
}
`.trim();

export const WGSL_SKY_SHADER = `
struct SkyUniforms {
  uSkyState: vec4<f32>, // x = dayFactor (0..1), y = timeSec, z = celestialNormX, w = celestialNormY
};
@group(2) @binding(0) var<uniform> skyUniforms : SkyUniforms;

@fragment
fn main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  let day = clamp(skyUniforms.uSkyState.x, 0.0, 1.0);
  let t = skyUniforms.uSkyState.y;
  let sunPos = skyUniforms.uSkyState.zw;

  // Quantize vertical coordinate into 24 crisp 16-bit sky bands.
  let qY = floor(uv.y * 24.0) / 24.0;

  // Night palette: Deep Void (#0a1218) -> Armor Blue (#1C3B54)
  let nightZenith = vec3<f32>(0.039, 0.071, 0.094);
  let nightHorizon = vec3<f32>(0.110, 0.231, 0.329);

  // Day palette: Armor Blue (#1C3B54) -> Sky Blue (#4DB6E2)
  let dayZenith = vec3<f32>(0.110, 0.231, 0.329);
  let dayHorizon = vec3<f32>(0.302, 0.714, 0.886);

  let zenith = mix(nightZenith, dayZenith, day);
  let horizon = mix(nightHorizon, dayHorizon, day);
  var col = mix(zenith, horizon, pow(qY, 1.15));

  // Celestial glow halo around active Sun or Moon position
  let distToBody = distance(uv, sunPos);
  let halo = smoothstep(0.42, 0.0, distToBody);
  col = col + vec3<f32>(1.0, 0.82, 0.40) * halo * 0.28 * day;
  col = col + vec3<f32>(0.22, 0.78, 0.91) * halo * 0.22 * (1.0 - day);

  // Dawn/dusk crimson-gold horizon band peaking near day=0.5
  let twilight = sin(day * 3.14159265);
  col = col + vec3<f32>(0.757, 0.180, 0.157) * twilight * smoothstep(0.45, 0.98, qY) * 0.22;

  // Quantized pixel starfield visible during night hours
  let starCell = floor(uv * vec2<f32>(64.0, 28.0));
  let hash = fract(sin(dot(starCell, vec2<f32>(127.1, 311.7))) * 43758.5453);
  if (hash > 0.985 && uv.y < 0.65) {
    let twinkle = 0.55 + 0.45 * sin(t * 2.1 + hash * 37.0);
    col = col + vec3<f32>(0.957, 0.890, 0.765) * (1.0 - day) * twinkle * 0.7;
  }

  return vec4<f32>(col, 1.0);
}
`.trim();

/**
 * Equivalent GLSL ES 3.00 sky shader for browsers falling back to WebGL2.
 */
const GLSL_SKY_VERTEX = `
#version 300 es
in vec2 aPosition;
in vec2 aUV;
out vec2 vUV;

uniform mat3 uProjectionMatrix;
uniform mat3 uWorldTransformMatrix;
uniform mat3 uTransformMatrix;

void main() {
  mat3 mvp = uProjectionMatrix * uWorldTransformMatrix * uTransformMatrix;
  gl_Position = vec4((mvp * vec3(aPosition, 1.0)).xy, 0.0, 1.0);
  vUV = aUV;
}
`.trim();

const GLSL_SKY_FRAGMENT = `
#version 300 es
precision mediump float;
in vec2 vUV;
out vec4 fragColor;

uniform vec4 uSkyState;

void main() {
  float day = clamp(uSkyState.x, 0.0, 1.0);
  float t = uSkyState.y;
  vec2 sunPos = uSkyState.zw;

  float qY = floor(vUV.y * 24.0) / 24.0;

  vec3 nightZenith = vec3(0.039, 0.071, 0.094);
  vec3 nightHorizon = vec3(0.110, 0.231, 0.329);
  vec3 dayZenith = vec3(0.110, 0.231, 0.329);
  vec3 dayHorizon = vec3(0.302, 0.714, 0.886);

  vec3 zenith = mix(nightZenith, dayZenith, day);
  vec3 horizon = mix(nightHorizon, dayHorizon, day);
  vec3 col = mix(zenith, horizon, pow(qY, 1.15));

  float distToBody = distance(vUV, sunPos);
  float halo = smoothstep(0.42, 0.0, distToBody);
  col += vec3(1.0, 0.82, 0.40) * halo * 0.28 * day;
  col += vec3(0.22, 0.78, 0.91) * halo * 0.22 * (1.0 - day);

  float twilight = sin(day * 3.14159265);
  col += vec3(0.757, 0.180, 0.157) * twilight * smoothstep(0.45, 0.98, qY) * 0.22;

  vec2 starCell = floor(vUV * vec2(64.0, 28.0));
  float hash = fract(sin(dot(starCell, vec2(127.1, 311.7))) * 43758.5453);
  if (hash > 0.985 && vUV.y < 0.65) {
    float twinkle = 0.55 + 0.45 * sin(t * 2.1 + hash * 37.0);
    col += vec3(0.957, 0.890, 0.765) * (1.0 - day) * twinkle * 0.7;
  }

  fragColor = vec4(col, 1.0);
}
`.trim();

/**
 * Five Overworld regions paired 1-to-1 with semantic World Zone sections in the DOM.
 */
export const OVERWORLD_ZONES: OverworldZoneConfig[] = [
  {
    id: 'sanctuary',
    index: 0,
    name: 'Sanctuary Citadel',
    shortLabel: 'Sanctuary',
    worldX: 180,
    accentHex: 0x38c7e7,
    subtitle: 'Bio, Dossier & Level 39 Sherpa Loadout',
  },
  {
    id: 'eras',
    index: 1,
    name: 'Hall of Eras',
    shortLabel: 'Eras',
    worldX: 480,
    accentHex: 0xffd166,
    subtitle: '5-Age Timeline through the Sovereign Age',
  },
  {
    id: 'relics',
    index: 2,
    name: 'Relic Vault',
    shortLabel: 'Relics',
    worldX: 790,
    accentHex: 0x4db6e2,
    subtitle: 'KidsLab 3.0, Infusio & Camp David',
  },
  {
    id: 'trophies',
    index: 3,
    name: 'Trophy Armory',
    shortLabel: 'Trophies',
    worldX: 1110,
    accentHex: 0xffd166,
    subtitle: 'Holographic TCG Badges & Lore Mode',
  },
  {
    id: 'beacon',
    index: 4,
    name: 'Signal Beacon',
    shortLabel: 'Beacon',
    worldX: 1410,
    accentHex: 0xc12e28,
    subtitle: 'Direct Contact & Dispatch Line',
  },
];

/**
 * Grounded satirical AI hype roasts emitted by the Overworld roast chest monolith.
 */
export const OVERWORLD_ROASTS: string[] = [
  'Prompt whisperer certificate: burned.',
  'AI strategy deck detected: 42 slides, zero working prototypes, one lonely spinner.',
  'Thought-leader alert: someone wrapped a system prompt around a form and called it an operating system.',
  'Synergy audit complete: your agent swarm spent 900 tokens greeting each other politely.',
  'Builder rule: if it cannot survive one week of real client traffic, put it back in the sandbox.',
  'No wrappers pretending to be products. Ship real systems, keep the proof, burn the fluff.',
];

/**
 * Memorial tribute opened when petting or clicking the White Dog companion (or pressing B).
 */
export const MEMORIAL_TRIBUTE = {
  title: 'Memorial Companion: Emy, Kiba & Yue',
  tag: 'COMPANION TRIBUTE',
  body: [
    'Walking beside Boris on the trail is the White Dog sprite, keeping memory alive for Emy, Kiba, and Yue.',
    'Strength in this world is measured by endurance without losing warmth: builders remember who walked beside them through hard miles.',
  ],
};

const WORLD_WIDTH = 1600;
const ROAST_CHEST_X = 635;

/**
 * Opt-in operator logging gated by `window.__RASS_OVERWORLD_DEBUG__`.
 */
function debugLog(message: string, detail?: unknown): void {
  if (typeof window !== 'undefined' && window.__RASS_OVERWORLD_DEBUG__) {
    console.info(`[OverworldEngine] ${message}`, detail ?? '');
  }
}

/**
 * Check whether a keyboard event originates from an editable form element or
 * includes OS/browser modifiers so we never hijack typing or shortcuts.
 */
function isEditableOrModified(event: KeyboardEvent): boolean {
  if (event.metaKey || event.ctrlKey || event.altKey) return true;
  const target = event.target as HTMLElement | null;
  if (!target) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return Boolean(target.isContentEditable);
}

/**
 * Compile an ASCII pixel-art matrix into a crisp nearest-neighbor PixiJS Texture
 * with 0 external PNG asset requests.
 */
function createPixelSpriteTexture(
  rows: string[],
  palette: Record<string, string>,
  pixelSize = 3,
): Texture {
  const height = rows.length;
  const width = rows[0]?.length ?? 1;
  const canvas = document.createElement('canvas');
  canvas.width = width * pixelSize;
  canvas.height = height * pixelSize;

  const ctx = canvas.getContext('2d');
  if (ctx) {
    for (let y = 0; y < height; y++) {
      const row = rows[y];
      for (let x = 0; x < row.length; x++) {
        const key = row[x];
        if (key === '.' || !palette[key]) continue;
        ctx.fillStyle = palette[key];
        ctx.fillRect(x * pixelSize, y * pixelSize, pixelSize, pixelSize);
      }
    }
  }

  const source = new CanvasSource({
    resource: canvas,
    scaleMode: 'nearest',
  });
  return Texture.from(source);
}

/**
 * Build two walk/trot pixel frames for each of the 4 traveling party members.
 */
function buildPartyTextures() {
  const palette: Record<string, string> = {
    B: '#1C3B54', // Armor Blue
    C: '#38C7E7', // Hologram Cyan
    R: '#C12E28', // Ms. Devil Crimson
    F: '#F4E3C3', // Dog Fur Cream / Warm Skin
    S: '#4DB6E2', // Sky Trim
    G: '#FFD166', // Arcade Gold
    K: '#2B2B2B', // Charcoal Outline / Boots
    W: '#FFFFFF', // Highlight White
    D: '#0d151c', // Deep Shadow
  };

  // 1. Boris: Level 39 LATAM Sherpa in pixel armor (#1C3B54 & #FFD166)
  const borisRowsA = [
    '....GGGG....',
    '...GBBBBG...',
    '..KBBCCBBK..',
    '..KBFFFFBK..',
    '..KBFKKFBK..',
    '...KFFFFK...',
    '..GGBBBBGG..',
    '.KBBBBBBBBK.',
    '.KBBGGBBBBK.',
    '.KFBGGBBBFK.',
    '..KBBBBBBK..',
    '..KBB..BBK..',
    '..KKK..KKK..',
    '.KKKK..KKKK.',
  ];
  const borisRowsB = [
    '....GGGG....',
    '...GBBBBG...',
    '..KBBCCBBK..',
    '..KBFFFFBK..',
    '..KBFKKFBK..',
    '...KFFFFK...',
    '..GGBBBBGG..',
    '.KBBBBBBBBK.',
    '.KBBGGBBBBK.',
    '.KFBGGBBBFK.',
    '..KBBBBBBK..',
    '...KBB.BBK..',
    '..KKK...KKK.',
    '..KKKK..KK..',
  ];

  // 2. White Dog: Memorial companion (#F4E3C3) honoring Emy, Kiba & Yue
  const dogRowsA = [
    '........KK..KK.',
    '.......KFFKKFFK',
    '......KFFFFFFFK',
    '..KK..KFFKFFKFK',
    '.KFFKKFFFFFFFFK',
    'KFFFFFFFFRRRRK.',
    'KFFFWFFFFFKKK..',
    '.KFFFFFFFFK....',
    '.KFFKKKKFFK....',
    '.KFK....KFK....',
    '.KKK....KKK....',
  ];
  const dogRowsB = [
    '........KK..KK.',
    '.......KFFKKFFK',
    '......KFFFFFFFK',
    '...KK.KFFKFFKFK',
    '..KFFKFFFFFFFFK',
    '.KFFFFFFFRRRRK.',
    'KFFFWFFFFFKKK..',
    '.KFFFFFFFFK....',
    '..KFFKKKKFFK...',
    '..KFK....KFK...',
    '..KK......KKK..',
  ];

  // 3. RASS: Floating kinetic cyan drone (#38C7E7)
  const rassRowsA = [
    '.....CC.....',
    '....CSSC....',
    '..KKBBBBKK..',
    '.KBCCCCCCBK.',
    '.KBCGGGGCBK.',
    '.KBCCCCCCBK.',
    '..KKBBBBKK..',
    '....C..C....',
    '...S....S...',
  ];
  const rassRowsB = [
    '.....GG.....',
    '....CSSC....',
    '..KKBBBBKK..',
    '.KBCCCCCCBK.',
    '.KBCWWWWCBK.',
    '.KBCCCCCCBK.',
    '..KKBBBBKK..',
    '...C....C...',
    '....S..S....',
  ];

  // 4. Ms. Devil: Agile crimson familiar (#C12E28)
  const devilRowsA = [
    '..K......K..',
    '..RK....KR..',
    '..KRRRRRRK..',
    '.KRRRRRRRRK.',
    '.KRFGRRGRFK.',
    '..KRRRRRRK..',
    '..KRRRRRRK..',
    '.KRRRRRRRRK.',
    'KRRKRRRRKRRK',
    '.KK..RR..KK.',
    '....KR.RK...',
    '...KK...KK..',
  ];
  const devilRowsB = [
    '..G......G..',
    '..RK....KR..',
    '..KRRRRRRK..',
    '.KRRRRRRRRK.',
    '.KRFGRRGRFK.',
    '..KRRRRRRK..',
    '..KRRRRRRK..',
    '.KRRRRRRRRK.',
    '.KKRRRRRRKK.',
    '..KR.RR.RK..',
    '..KK....KK..',
    '............',
  ];

  // Pixel Heart bubble for petting the White Dog
  const heartRows = [
    '.KK..KK.',
    'KRRKKRRK',
    'KRWRRRRK',
    'KRRRRRRK',
    '.KRRRRK.',
    '..KRRK..',
    '...KK...',
  ];

  // Interactive Roast Chest / Monolith
  const chestRowsClosed = [
    '..KKKKKKKK..',
    '.KGGGGGGGGK.',
    'KGBBBBBBBBGK',
    'KGCCCCCCCCGK',
    'KGGGGRRGGGGK',
    'KBBBBGGBBBBK',
    'KBBBBBBBBBBK',
    '.KKKKKKKKKK.',
  ];
  const chestRowsOpen = [
    '.KKKKKKKKKK.',
    'KGGGGGGGGGGK',
    'KGGGGGGGGGGK',
    '.KKKKKKKKKK.',
    'KGBBGGGGGBGK',
    'KGCCGRRGGCGK',
    'KBBBBBBBBBBK',
    '.KKKKKKKKKK.',
  ];

  return {
    boris: [
      createPixelSpriteTexture(borisRowsA, palette, 3),
      createPixelSpriteTexture(borisRowsB, palette, 3),
    ],
    whiteDog: [
      createPixelSpriteTexture(dogRowsA, palette, 3),
      createPixelSpriteTexture(dogRowsB, palette, 3),
    ],
    rass: [
      createPixelSpriteTexture(rassRowsA, palette, 3),
      createPixelSpriteTexture(rassRowsB, palette, 3),
    ],
    msDevil: [
      createPixelSpriteTexture(devilRowsA, palette, 3),
      createPixelSpriteTexture(devilRowsB, palette, 3),
    ],
    heart: createPixelSpriteTexture(heartRows, palette, 3),
    chestClosed: createPixelSpriteTexture(chestRowsClosed, palette, 4),
    chestOpen: createPixelSpriteTexture(chestRowsOpen, palette, 4),
  };
}

/**
 * Compute celestial day factor (0 = midnight, 1 = noon) and normalized arc
 * coordinates from a decimal hour (0..24) or manual day/night override.
 */
function computeCelestialState(
  override: 'auto' | 'day' | 'night',
  now: Date = new Date(),
): {
  dayFactor: number;
  isDaytime: boolean;
  normX: number;
  normY: number;
} {
  const hour = now.getHours() + now.getMinutes() / 60;

  if (override === 'day') {
    const arcT = 0.5;
    return {
      dayFactor: 1.0,
      isDaytime: true,
      normX: 0.14 + arcT * 0.72,
      normY: 0.56 - Math.sin(arcT * Math.PI) * 0.36,
    };
  }
  if (override === 'night') {
    const arcT = 0.5;
    return {
      dayFactor: 0.0,
      isDaytime: false,
      normX: 0.14 + arcT * 0.72,
      normY: 0.56 - Math.sin(arcT * Math.PI) * 0.36,
    };
  }

  // Daytime window: 06:00 to 18:00; smooth twilight ramp over 1 hour around edges.
  const isDaytime = hour >= 6 && hour < 18;
  let dayFactor: number;
  if (hour >= 7 && hour <= 17) {
    dayFactor = 1.0;
  } else if (hour >= 5 && hour < 7) {
    dayFactor = (hour - 5) / 2;
  } else if (hour > 17 && hour <= 19) {
    dayFactor = 1 - (hour - 17) / 2;
  } else {
    dayFactor = 0.0;
  }

  // Parabolic arc from east (x=0.14) to west (x=0.86) over 12-hour day or night shift.
  const arcT = isDaytime
    ? (hour - 6) / 12
    : ((hour >= 18 ? hour - 18 : hour + 6) / 12);

  const normX = 0.14 + Math.max(0, Math.min(1, arcT)) * 0.72;
  const normY = 0.58 - Math.sin(Math.max(0, Math.min(1, arcT)) * Math.PI) * 0.38;

  return { dayFactor, isDaytime, normX, normY };
}

/**
 * Controller managing the PixiJS v8 stage, celestial cycle, party movement,
 * fast-travel synchronization, and accessible fallback controls.
 */
export class OverworldController {
  private stageRoot: HTMLElement;
  private canvasHost: HTMLElement;
  private fallbackEl: HTMLElement | null;
  private rendererBadge: HTMLElement | null;
  private zoneLabelEl: HTMLElement | null;
  private celestialBtn: HTMLButtonElement | null;
  private audioBtn: HTMLButtonElement | null;
  private motionBtn: HTMLButtonElement | null;
  private roastTriggerBtn: HTMLButtonElement | null;
  private dogTriggerBtn: HTMLButtonElement | null;
  private travelButtons: HTMLButtonElement[] = [];

  private app: Application | null = null;
  private skyMesh: Mesh<MeshGeometry, Shader> | null = null;
  private skyFallbackGfx: Graphics | null = null;
  private skyUniforms: UniformGroup | null = null;
  private sunGfx: Graphics | null = null;
  private moonGfx: Graphics | null = null;
  private mountainLayer: Graphics | null = null;
  private worldContainer: Container | null = null;

  private borisSprite: Sprite | null = null;
  private dogSprite: Sprite | null = null;
  private rassSprite: Sprite | null = null;
  private devilSprite: Sprite | null = null;
  private chestSprite: Sprite | null = null;
  private heartContainer: Container | null = null;
  private landmarkGlows: Graphics[] = [];
  private textures: ReturnType<typeof buildPartyTextures> | null = null;

  private partyX = OVERWORLD_ZONES[0].worldX;
  private targetPartyX = OVERWORLD_ZONES[0].worldX;
  private facingDir: 1 | -1 = 1;
  private walkAnimPhase = 0;
  private hopOffset = 0;
  private hopVelocity = 0;
  private elapsedSec = 0;
  private roastIndex = 0;
  private chestOpenTimer = 0;

  private activeZoneIndex = 0;
  private celestialOverride: 'auto' | 'day' | 'night' = 'auto';
  private motionPaused = false;
  private autoScrollLockUntil = 0;
  private keysHeld = new Set<string>();
  private heartBubbles: Array<{ sprite: Sprite; age: number; startY: number }> = [];

  private viewWidth = 960;
  private viewHeight = 320;
  private resizeObserver: ResizeObserver | null = null;
  private intersectionObserver: IntersectionObserver | null = null;
  private reducedMotionQuery: MediaQueryList | null = null;
  private cleanups: Array<() => void> = [];

  constructor(stageRoot: HTMLElement) {
    this.stageRoot = stageRoot;
    this.canvasHost =
      stageRoot.querySelector<HTMLElement>('#overworldCanvasHost') || stageRoot;
    this.fallbackEl = stageRoot.querySelector<HTMLElement>('#overworldFallback');
    this.rendererBadge = stageRoot.querySelector<HTMLElement>('#rendererBadge');
    this.zoneLabelEl = stageRoot.querySelector<HTMLElement>('#overworldZoneLabel');
    this.celestialBtn = stageRoot.querySelector<HTMLButtonElement>('#celestialToggle');
    this.audioBtn = stageRoot.querySelector<HTMLButtonElement>('#audioToggle');
    this.motionBtn = stageRoot.querySelector<HTMLButtonElement>('#motionToggle');
    this.roastTriggerBtn =
      stageRoot.querySelector<HTMLButtonElement>('#roastChestTrigger');
    this.dogTriggerBtn =
      stageRoot.querySelector<HTMLButtonElement>('#dogPetTrigger');
    this.travelButtons = Array.from(
      stageRoot.querySelectorAll<HTMLButtonElement>('[data-travel-zone]'),
    );
  }

  public async mount(): Promise<void> {
    this.bindMotionPreference();
    this.bindDomControls();
    this.bindKeyboardControls();
    this.bindScrollObserver();
    this.syncZoneUI(0, false);
    this.syncCelestialButtonUI();

    await this.initPixiApplication();
    debugLog('OverworldController mounted', {
      viewWidth: this.viewWidth,
      viewHeight: this.viewHeight,
      motionPaused: this.motionPaused,
    });
  }

  /**
   * Initialize PixiJS v8 with `preference: 'webgpu'`, falling back gracefully to
   * WebGL2 or static accessible DOM mode if GPU initialization fails.
   */
  private async initPixiApplication(): Promise<void> {
    // Enforce crisp pixel-art sampling globally across PixiJS v8 TextureSources.
    TextureStyle.defaultOptions.scaleMode = 'nearest';

    const rect = this.canvasHost.getBoundingClientRect();
    this.viewWidth = Math.max(300, Math.round(rect.width || 960));
    this.viewHeight = Math.max(180, Math.round(rect.height || 300));

    let app: Application | null = null;
    try {
      app = new Application();
      await app.init({
        preference: 'webgpu',
        width: this.viewWidth,
        height: this.viewHeight,
        backgroundColor: 0x0a1218,
        backgroundAlpha: 1,
        antialias: false,
        roundPixels: true,
        resolution: Math.min(window.devicePixelRatio || 1, 2),
        autoDensity: true,
      });
    } catch (webgpuErr) {
      debugLog('WebGPU init fallback triggered; retrying WebGL preference', webgpuErr);
      try {
        app = new Application();
        await app.init({
          preference: 'webgl',
          width: this.viewWidth,
          height: this.viewHeight,
          backgroundColor: 0x0a1218,
          backgroundAlpha: 1,
          antialias: false,
          roundPixels: true,
          resolution: Math.min(window.devicePixelRatio || 1, 2),
          autoDensity: true,
        });
      } catch (webglErr) {
        debugLog('PixiJS renderer unavailable; keeping static accessible fallback', webglErr);
        this.updateRendererBadge('static');
        return;
      }
    }

    this.app = app;
    const canvas = app.canvas;
    canvas.className = 'overworld-canvas';
    canvas.setAttribute('aria-hidden', 'true');
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.imageRendering = 'pixelated';

    this.canvasHost.appendChild(canvas);
    this.stageRoot.classList.add('is-mounted');
    if (this.fallbackEl) {
      this.fallbackEl.hidden = true;
    }

    const backendName =
      app.renderer.type === RendererType.WEBGPU
        ? 'webgpu'
        : app.renderer.type === RendererType.WEBGL
          ? 'webgl'
          : 'canvas';
    this.updateRendererBadge(backendName);

    this.buildSceneGraph(app);
    this.layoutScene(this.viewWidth, this.viewHeight);
    this.startResizeObserver();

    app.ticker.add((ticker) => {
      // Clamp dt to 50ms so tab backgrounding never creates huge sprite jumps.
      const dtSec = Math.min(0.05, ticker.deltaMS / 1000);
      this.updateFrame(dtSec);
    });
  }

  private updateRendererBadge(backend: 'webgpu' | 'webgl' | 'canvas' | 'static'): void {
    if (!this.rendererBadge) return;
    this.rendererBadge.dataset.backend = backend;
    this.rendererBadge.textContent =
      backend === 'webgpu'
        ? 'webgpu'
        : backend === 'webgl'
          ? 'webgl'
          : backend;
  }

  /**
   * Build sky shader layer, celestial bodies, parallax mountains, 5 landmarks,
   * roast chest monolith, and the 4-member pixel-art traveling party.
   */
  private buildSceneGraph(app: Application): void {
    const initialCelestial = computeCelestialState(this.celestialOverride);

    // 1. Sky Shader Layer (WGSL for WebGPU + GLSL for WebGL2 + Graphics fallback)
    this.skyFallbackGfx = new Graphics();
    app.stage.addChild(this.skyFallbackGfx);

    try {
      this.skyUniforms = new UniformGroup({
        uSkyState: {
          value: new Float32Array([
            initialCelestial.dayFactor,
            0,
            initialCelestial.normX,
            initialCelestial.normY,
          ]),
          type: 'vec4<f32>',
        },
      });

      const skyGeometry = new MeshGeometry({
        positions: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
        uvs: new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]),
        indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
      });

      const skyShader = Shader.from({
        gpu: {
          vertex: { source: WGSL_SKY_VERTEX, entryPoint: 'main' },
          fragment: { source: WGSL_SKY_SHADER, entryPoint: 'main' },
        },
        gl: {
          vertex: GLSL_SKY_VERTEX,
          fragment: GLSL_SKY_FRAGMENT,
        },
        resources: {
          skyUniforms: this.skyUniforms,
        },
      });

      this.skyMesh = new Mesh({
        geometry: skyGeometry,
        shader: skyShader,
      });
      app.stage.addChild(this.skyMesh);
    } catch (shaderErr) {
      debugLog('Sky Shader.from bypassed; using Graphics sky bands', shaderErr);
      this.skyMesh = null;
    }

    // 2. Celestial Sun & Moon sprites drawn with crisp pixel squares
    this.sunGfx = new Graphics();
    this.sunGfx.rect(-12, -12, 24, 24).fill(0xffd166);
    this.sunGfx.rect(-8, -16, 16, 32).fill({ color: 0xffd166, alpha: 0.45 });
    this.sunGfx.rect(-16, -8, 32, 16).fill({ color: 0xffd166, alpha: 0.45 });
    this.sunGfx.rect(-6, -6, 12, 12).fill(0xf4e3c3);
    app.stage.addChild(this.sunGfx);

    this.moonGfx = new Graphics();
    this.moonGfx.rect(-10, -10, 20, 20).fill(0xf4e3c3);
    this.moonGfx.rect(-4, -8, 12, 14).fill(0x1c3b54); // Crescent carve
    this.moonGfx.rect(-14, -4, 4, 4).fill({ color: 0x38c7e7, alpha: 0.7 });
    app.stage.addChild(this.moonGfx);

    // 3. Distant 16-bit Parallax Silhouette Peaks
    this.mountainLayer = new Graphics();
    app.stage.addChild(this.mountainLayer);

    // 4. Scrollable World Container (Ground, 5 Landmarks, Roast Chest, Party)
    this.worldContainer = new Container();
    app.stage.addChild(this.worldContainer);

    this.textures = buildPartyTextures();
    this.buildWorldTerrainAndLandmarks(this.worldContainer);
    this.buildRoastChest(this.worldContainer);
    this.buildPartySprites(this.worldContainer);

    this.heartContainer = new Container();
    this.worldContainer.addChild(this.heartContainer);
  }

  private buildWorldTerrainAndLandmarks(world: Container): void {
    const road = new Graphics();
    // Deep volcanic soil & pixel stone trail spanning full WORLD_WIDTH
    road.rect(0, 0, WORLD_WIDTH, 86).fill(0x0d151c);
    road.rect(0, 0, WORLD_WIDTH, 6).fill(0x1c3b54);
    road.rect(0, 6, WORLD_WIDTH, 4).fill(0x38c7e7);
    for (let x = 16; x < WORLD_WIDTH; x += 32) {
      road.rect(x, 18, 16, 4).fill({ color: 0x4db6e2, alpha: 0.28 });
      road.rect(x + 8, 34, 12, 4).fill({ color: 0x1c3b54, alpha: 0.85 });
    }
    road.label = 'overworldRoad';
    world.addChild(road);

    // 5 Zone Pixel Landmarks
    this.landmarkGlows = [];
    for (const zone of OVERWORLD_ZONES) {
      const lm = new Container();
      lm.x = zone.worldX;
      lm.y = 0;

      const glow = new Graphics();
      glow.rect(-28, -94, 56, 94).fill({ color: zone.accentHex, alpha: 0.14 });
      lm.addChild(glow);
      this.landmarkGlows.push(glow);

      const art = new Graphics();
      this.drawLandmarkArt(art, zone.id, zone.accentHex);
      lm.addChild(art);

      const tag = new Text({
        text: `${zone.index + 1}. ${zone.shortLabel.toUpperCase()}`,
        style: {
          fontFamily: '"Press Start 2P", monospace',
          fontSize: 9,
          fill: '#F4E3C3',
          stroke: { color: '#0a1218', width: 3 },
        },
      });
      tag.anchor.set(0.5, 1);
      tag.x = 0;
      tag.y = -98;
      lm.addChild(tag);

      lm.eventMode = 'static';
      lm.cursor = 'pointer';
      lm.on('pointertap', () => {
        chiptuneAudio.unlock();
        this.fastTravelTo(zone.index, true);
      });

      world.addChild(lm);
    }
  }

  private drawLandmarkArt(g: Graphics, id: ZoneId, accent: number): void {
    if (id === 'sanctuary') {
      // Sanctuary Citadel: stone keep + glowing cyan beacon crystal
      g.rect(-26, -64, 52, 64).fill(0x1c3b54);
      g.rect(-30, -72, 14, 10).fill(0x1c3b54);
      g.rect(-7, -76, 14, 14).fill(0x1c3b54);
      g.rect(16, -72, 14, 10).fill(0x1c3b54);
      g.rect(-10, -34, 20, 34).fill(0x0a1218);
      g.rect(-6, -28, 12, 24).fill(0xffd166);
      g.rect(-4, -92, 8, 12).fill(accent);
    } else if (id === 'eras') {
      // Hall of Eras: twin pillars + golden hourglass arch
      g.rect(-26, -66, 10, 66).fill(0x1c3b54);
      g.rect(16, -66, 10, 66).fill(0x1c3b54);
      g.rect(-30, -74, 60, 10).fill(0x4db6e2);
      g.rect(-10, -56, 20, 8).fill(accent);
      g.rect(-6, -48, 12, 12).fill(0xf4e3c3);
      g.rect(-10, -36, 20, 8).fill(accent);
    } else if (id === 'relics') {
      // Relic Vault: armored portal + cyan rune seal
      g.rect(-28, -68, 56, 68).fill(0x2b2b2b);
      g.rect(-22, -60, 44, 60).fill(0x1c3b54);
      g.rect(-12, -46, 24, 24).fill(accent);
      g.rect(-6, -40, 12, 12).fill(0x0a1218);
    } else if (id === 'trophies') {
      // Trophy Armory: stepped pedestal + golden crown/shield
      g.rect(-22, -20, 44, 20).fill(0x1c3b54);
      g.rect(-14, -36, 28, 16).fill(0x4db6e2);
      g.rect(-14, -68, 28, 24).fill(accent);
      g.rect(-18, -76, 8, 8).fill(accent);
      g.rect(-4, -78, 8, 10).fill(accent);
      g.rect(10, -76, 8, 8).fill(accent);
    } else {
      // Signal Beacon: crimson-cyan tower + broadcast dish
      g.rect(-14, -72, 28, 72).fill(0x1c3b54);
      g.rect(-8, -88, 16, 16).fill(accent);
      g.rect(-4, -96, 8, 8).fill(0x38c7e7);
      g.rect(-18, -44, 36, 6).fill(0x38c7e7);
    }
  }

  private buildRoastChest(world: Container): void {
    if (!this.textures) return;
    const chestWrap = new Container();
    chestWrap.x = ROAST_CHEST_X;
    chestWrap.y = -4;

    const chest = new Sprite(this.textures.chestClosed);
    chest.anchor.set(0.5, 1);
    chest.eventMode = 'static';
    chest.cursor = 'pointer';
    chest.on('pointertap', () => {
      this.triggerRoastChest();
    });
    chestWrap.addChild(chest);
    this.chestSprite = chest;

    const chestLabel = new Text({
      text: 'CHEST [R]',
      style: {
        fontFamily: '"Press Start 2P", monospace',
        fontSize: 8,
        fill: '#FFD166',
        stroke: { color: '#0a1218', width: 3 },
      },
    });
    chestLabel.anchor.set(0.5, 1);
    chestLabel.y = -40;
    chestWrap.addChild(chestLabel);

    world.addChild(chestWrap);
  }

  private buildPartySprites(world: Container): void {
    if (!this.textures) return;

    // 1. Boris (Lead)
    this.borisSprite = new Sprite(this.textures.boris[0]);
    this.borisSprite.anchor.set(0.5, 1);
    world.addChild(this.borisSprite);

    // 2. White Dog (Memorial companion: Emy, Kiba, Yue) — clickable!
    this.dogSprite = new Sprite(this.textures.whiteDog[0]);
    this.dogSprite.anchor.set(0.5, 1);
    this.dogSprite.eventMode = 'static';
    this.dogSprite.cursor = 'pointer';
    this.dogSprite.on('pointertap', () => {
      this.triggerWhiteDogMemorial();
    });
    world.addChild(this.dogSprite);

    // 3. RASS (Hovering kinetic cyan drone)
    this.rassSprite = new Sprite(this.textures.rass[0]);
    this.rassSprite.anchor.set(0.5, 1);
    world.addChild(this.rassSprite);

    // 4. Ms. Devil (Agile crimson familiar darting ahead)
    this.devilSprite = new Sprite(this.textures.msDevil[0]);
    this.devilSprite.anchor.set(0.5, 1);
    world.addChild(this.devilSprite);
  }

  private startResizeObserver(): void {
    if (typeof ResizeObserver === 'undefined') return;
    this.resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry || !this.app) return;
      const nextW = Math.max(300, Math.round(entry.contentRect.width));
      const nextH = Math.max(176, Math.round(entry.contentRect.height));
      if (nextW === this.viewWidth && nextH === this.viewHeight) return;
      this.viewWidth = nextW;
      this.viewHeight = nextH;
      this.app.renderer.resize(nextW, nextH);
      this.layoutScene(nextW, nextH);
    });
    this.resizeObserver.observe(this.canvasHost);
  }

  private layoutScene(width: number, height: number): void {
    const roadHeight = Math.max(48, Math.round(height * 0.24));
    const groundY = height - roadHeight;

    if (this.skyMesh) {
      this.skyMesh.scale.set(width, height);
    }

    if (this.mountainLayer) {
      this.mountainLayer.clear();
      // Step-quantized 16-bit mountain ridge silhouette behind the road
      const peakStep = 48;
      for (let x = 0; x < width + peakStep; x += peakStep) {
        const peakH = 26 + ((Math.sin(x * 0.023) + 1) * 0.5) * 44;
        this.mountainLayer
          .rect(x, groundY - peakH, peakStep + 2, peakH + 8)
          .fill({ color: 0x102231, alpha: 0.85 });
      }
    }

    if (this.worldContainer) {
      this.worldContainer.y = groundY;
      const road = this.worldContainer.getChildByLabel('overworldRoad');
      if (road) {
        road.y = 0;
      }
    }

    this.drawSkyFallbackBands(width, height);
    this.updateCameraAndPartyPositions();
  }

  private drawSkyFallbackBands(width: number, height: number): void {
    if (!this.skyFallbackGfx) return;
    const { dayFactor } = computeCelestialState(this.celestialOverride);
    const bands = 12;
    const bandH = Math.ceil(height / bands);
    this.skyFallbackGfx.clear();

    for (let i = 0; i < bands; i++) {
      const t = i / (bands - 1);
      // Blend Deep Void (#0a1218) -> Armor Blue (#1C3B54) -> Sky (#4DB6E2)
      const rNight = Math.round(10 + t * 18);
      const gNight = Math.round(18 + t * 41);
      const bNight = Math.round(24 + t * 60);

      const rDay = Math.round(28 + t * 49);
      const gDay = Math.round(59 + t * 123);
      const bDay = Math.round(84 + t * 142);

      const r = Math.round(rNight + (rDay - rNight) * dayFactor);
      const g = Math.round(gNight + (gDay - gNight) * dayFactor);
      const b = Math.round(bNight + (bDay - bNight) * dayFactor);
      const hex = (r << 16) | (g << 8) | b;

      this.skyFallbackGfx.rect(0, i * bandH, width, bandH + 1).fill(hex);
    }
  }

  /**
   * Per-frame simulation loop updating WGSL uniforms, Sun/Moon arc,
   * WASD/Arrow free walking, party sprite animations, and heart bubbles.
   */
  private updateFrame(dtSec: number): void {
    if (!this.motionPaused) {
      this.elapsedSec += dtSec;
    }

    // 1. Update WGSL sky uniforms & celestial Sun/Moon coordinates
    const celestial = computeCelestialState(this.celestialOverride);
    if (this.skyUniforms) {
      const state = this.skyUniforms.uniforms.uSkyState as Float32Array;
      state[0] = celestial.dayFactor;
      state[1] = this.elapsedSec;
      state[2] = celestial.normX;
      state[3] = celestial.normY;
      this.skyUniforms.update();
    }

    const cx = celestial.normX * this.viewWidth;
    const cy = celestial.normY * this.viewHeight;
    if (this.sunGfx) {
      this.sunGfx.visible = celestial.dayFactor > 0.25;
      this.sunGfx.alpha = Math.min(1, celestial.dayFactor * 1.25);
      this.sunGfx.x = cx;
      this.sunGfx.y = cy;
    }
    if (this.moonGfx) {
      this.moonGfx.visible = celestial.dayFactor < 0.75;
      this.moonGfx.alpha = Math.min(1, (1 - celestial.dayFactor) * 1.25);
      this.moonGfx.x = cx;
      this.moonGfx.y = cy;
    }

    // 2. Process keyboard free-walk input (WASD / ArrowLeft / ArrowRight)
    const moveLeft = this.keysHeld.has('ArrowLeft') || this.keysHeld.has('KeyA');
    const moveRight = this.keysHeld.has('ArrowRight') || this.keysHeld.has('KeyD');
    const moveAxis = (moveRight ? 1 : 0) - (moveLeft ? 1 : 0);

    if (moveAxis !== 0) {
      const walkSpeedPxPerSec = 230;
      this.facingDir = moveAxis > 0 ? 1 : -1;
      this.partyX = Math.max(
        70,
        Math.min(WORLD_WIDTH - 70, this.partyX + moveAxis * walkSpeedPxPerSec * dtSec),
      );
      this.targetPartyX = this.partyX;
      this.walkAnimPhase += dtSec * 8;
      chiptuneAudio.playStep();
      this.syncClosestZoneFromWalk();
    } else if (Math.abs(this.targetPartyX - this.partyX) > 1.5) {
      // Smooth camera/party glide when fast-traveling or scroll-syncing
      if (this.motionPaused) {
        this.partyX = this.targetPartyX;
      } else {
        const step = (this.targetPartyX - this.partyX) * Math.min(1, dtSec * 7.5);
        this.facingDir = step >= 0 ? 1 : -1;
        this.partyX += step;
        this.walkAnimPhase += dtSec * 7;
      }
    }

    // Vertical hop decay (triggered by W / ArrowUp or zone arrival)
    if (this.hopOffset < 0 || this.hopVelocity !== 0) {
      this.hopOffset += this.hopVelocity * dtSec;
      this.hopVelocity += 680 * dtSec;
      if (this.hopOffset >= 0) {
        this.hopOffset = 0;
        this.hopVelocity = 0;
      }
    }

    // 3. Chest open timer reset
    if (this.chestOpenTimer > 0 && this.chestSprite && this.textures) {
      this.chestOpenTimer -= dtSec;
      if (this.chestOpenTimer <= 0) {
        this.chestSprite.texture = this.textures.chestClosed;
      }
    }

    // 4. Update floating heart bubbles
    for (let i = this.heartBubbles.length - 1; i >= 0; i--) {
      const item = this.heartBubbles[i];
      item.age += dtSec;
      item.sprite.y = item.startY - item.age * 36;
      item.sprite.alpha = Math.max(0, 1 - item.age / 1.15);
      if (item.age >= 1.15) {
        item.sprite.destroy();
        this.heartBubbles.splice(i, 1);
      }
    }

    // 5. Landmark active glow pulse
    this.landmarkGlows.forEach((glow, idx) => {
      const isCurrent = idx === this.activeZoneIndex;
      const pulse = this.motionPaused
        ? 0.25
        : 0.18 + Math.sin(this.elapsedSec * 3 + idx) * 0.08;
      glow.alpha = isCurrent ? pulse + 0.32 : 0.08;
    });

    this.updateCameraAndPartyPositions();
  }

  private updateCameraAndPartyPositions(): void {
    const camX = Math.max(
      0,
      Math.min(
        Math.max(0, WORLD_WIDTH - this.viewWidth),
        this.partyX - this.viewWidth * 0.48,
      ),
    );

    if (this.worldContainer) {
      this.worldContainer.x = -Math.round(camX);
    }

    if (!this.textures) return;
    const frameIdx = Math.floor(this.walkAnimPhase) % 2;
    const idleBob = this.motionPaused ? 0 : Math.sin(this.elapsedSec * 3.4) * 3;
    const fastFloat = this.motionPaused ? 0 : Math.sin(this.elapsedSec * 4.6) * 5;

    if (this.borisSprite) {
      this.borisSprite.texture = this.textures.boris[frameIdx];
      this.borisSprite.x = Math.round(this.partyX);
      this.borisSprite.y = Math.round(this.hopOffset);
      this.borisSprite.scale.x = this.facingDir;
    }

    // White Dog trots faithfully behind Boris
    if (this.dogSprite) {
      this.dogSprite.texture = this.textures.whiteDog[frameIdx];
      this.dogSprite.x = Math.round(this.partyX - this.facingDir * 44);
      this.dogSprite.y = Math.round(
        this.motionPaused ? 0 : -Math.abs(Math.sin(this.walkAnimPhase * 0.8)) * 3,
      );
      this.dogSprite.scale.x = this.facingDir;
    }

    // RASS floats alongside above Boris's back shoulder
    if (this.rassSprite) {
      this.rassSprite.texture =
        this.textures.rass[this.motionPaused ? 0 : Math.floor(this.elapsedSec * 3) % 2];
      this.rassSprite.x = Math.round(this.partyX - this.facingDir * 24);
      this.rassSprite.y = Math.round(-44 + idleBob);
      this.rassSprite.scale.x = this.facingDir;
    }

    // Ms. Devil darts ahead on the trail
    if (this.devilSprite) {
      const dart = this.motionPaused ? 0 : Math.sin(this.elapsedSec * 2.4) * 8;
      this.devilSprite.texture =
        this.textures.msDevil[this.motionPaused ? 0 : Math.floor(this.elapsedSec * 4) % 2];
      this.devilSprite.x = Math.round(this.partyX + this.facingDir * (46 + dart));
      this.devilSprite.y = Math.round(-6 + fastFloat * 0.6);
      this.devilSprite.scale.x = this.facingDir;
    }
  }

  private syncClosestZoneFromWalk(): void {
    let bestIdx = 0;
    let bestDist = Infinity;
    for (const zone of OVERWORLD_ZONES) {
      const d = Math.abs(this.partyX - zone.worldX);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = zone.index;
      }
    }
    if (bestIdx !== this.activeZoneIndex) {
      this.syncZoneUI(bestIdx, true);
    }
  }

  public fastTravelTo(zoneIndex: number, playAudio: boolean): void {
    const safeIdx = Math.max(0, Math.min(OVERWORLD_ZONES.length - 1, zoneIndex));
    const zone = OVERWORLD_ZONES[safeIdx];
    this.targetPartyX = zone.worldX;
    this.facingDir = zone.worldX >= this.partyX ? 1 : -1;
    if (this.motionPaused) {
      this.partyX = zone.worldX;
    }
    this.syncZoneUI(safeIdx, playAudio);

    // Smoothly scroll corresponding World Zone section into view
    const targetEl =
      document.getElementById(zone.id) ||
      document.querySelector<HTMLElement>(`[data-zone="${zone.id}"]`);
    if (targetEl) {
      this.autoScrollLockUntil = performance.now() + 850;
      targetEl.scrollIntoView({
        behavior: this.motionPaused ? 'auto' : 'smooth',
        block: 'start',
      });
    }
    debugLog('Fast-travel activated', { zone: zone.id, worldX: zone.worldX });
  }

  private syncZoneUI(zoneIndex: number, playAudio: boolean): void {
    this.activeZoneIndex = zoneIndex;
    const zone = OVERWORLD_ZONES[zoneIndex];
    this.stageRoot.dataset.zoneActive = zone.id;

    if (this.zoneLabelEl) {
      this.zoneLabelEl.textContent = `${zone.index + 1}. ${zone.name}`;
    }

    for (const btn of this.travelButtons) {
      const isActive = btn.dataset.travelZone === zone.id;
      btn.classList.toggle('is-active', isActive);
      if (isActive) {
        btn.setAttribute('aria-current', 'true');
      } else {
        btn.removeAttribute('aria-current');
      }
    }

    if (playAudio) {
      chiptuneAudio.playZoneChime(zoneIndex);
    }
  }

  /**
   * Open the White Dog memorial tribute, emit a cheerful 8-bit bark chime,
   * and float a pixel heart bubble above the companion sprite.
   */
  public triggerWhiteDogMemorial(): void {
    chiptuneAudio.playBarkChime();
    this.spawnHeartBubble();

    window.HeroWallModal?.open({
      title: MEMORIAL_TRIBUTE.title,
      tag: MEMORIAL_TRIBUTE.tag,
      body: MEMORIAL_TRIBUTE.body,
      html: MEMORIAL_TRIBUTE.body.map((p) => `<p>${p}</p>`).join(''),
    });

    debugLog('White Dog memorial tribute triggered (Emy, Kiba, Yue).');
  }

  private spawnHeartBubble(): void {
    if (!this.heartContainer || !this.textures || !this.dogSprite) return;
    const heart = new Sprite(this.textures.heart);
    heart.anchor.set(0.5, 1);
    heart.x = this.dogSprite.x;
    heart.y = -40;
    this.heartContainer.addChild(heart);
    this.heartBubbles.push({ sprite: heart, age: 0, startY: -40 });
  }

  /**
   * Open the interactive roast chest monolith with fanfare + satirical AI hype roast.
   */
  public triggerRoastChest(): void {
    chiptuneAudio.playChestOpen();
    if (this.chestSprite && this.textures) {
      this.chestSprite.texture = this.textures.chestOpen;
      this.chestOpenTimer = 1.6;
    }

    const pool =
      Array.isArray(window.HeroWallRoasts) && window.HeroWallRoasts.length > 0
        ? Array.from(new Set([...OVERWORLD_ROASTS, ...window.HeroWallRoasts]))
        : OVERWORLD_ROASTS;

    const roast = pool[this.roastIndex % pool.length];
    this.roastIndex += 1;

    const lines = [
      roast,
      'Built by Boris, RASS, and Ms. Devil with zero external spritesheets and zero hype padding.',
    ];

    window.HeroWallModal?.open({
      title: 'Overworld Chest: AI Hype Roast',
      tag: 'MONOLITH DROP',
      body: lines,
      html: lines.map((p) => `<p>${p}</p>`).join(''),
    });

    debugLog('Roast chest opened', { roast });
  }

  private bindMotionPreference(): void {
    this.reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.setMotionPaused(this.reducedMotionQuery.matches, false);

    const onPrefChange = (e: MediaQueryListEvent) => {
      this.setMotionPaused(e.matches, false);
    };
    this.reducedMotionQuery.addEventListener('change', onPrefChange);
    this.cleanups.push(() =>
      this.reducedMotionQuery?.removeEventListener('change', onPrefChange),
    );
  }

  private setMotionPaused(paused: boolean, withChime: boolean): void {
    this.motionPaused = paused;
    document.documentElement.dataset.motion = paused ? 'paused' : 'on';
    if (this.motionBtn) {
      // WCAG 2.2.2: label switches between Pause/Play without aria-pressed.
      this.motionBtn.textContent = paused ? 'Play motion' : 'Pause motion';
      this.motionBtn.removeAttribute('aria-pressed');
      this.motionBtn.dataset.motionState = paused ? 'paused' : 'playing';
    }
    if (withChime) {
      chiptuneAudio.playToggle();
    }
  }

  private syncCelestialButtonUI(): void {
    if (!this.celestialBtn) return;
    const { isDaytime } = computeCelestialState(this.celestialOverride);
    this.celestialBtn.textContent = isDaytime ? '☀️ Day' : '🌙 Night';
    this.celestialBtn.setAttribute(
      'aria-label',
      isDaytime
        ? 'Sky mode: Day. Activate to switch to Night sky.'
        : 'Sky mode: Night. Activate to switch to Day sky.',
    );
  }

  private bindDomControls(): void {
    for (const btn of this.travelButtons) {
      const zoneId = btn.dataset.travelZone as ZoneId | undefined;
      const zone = OVERWORLD_ZONES.find((z) => z.id === zoneId);
      if (!zone) continue;

      const onClick = () => {
        chiptuneAudio.unlock();
        this.fastTravelTo(zone.index, true);
      };
      btn.addEventListener('click', onClick);
      this.cleanups.push(() => btn.removeEventListener('click', onClick));
    }

    if (this.celestialBtn) {
      const onCelestial = () => {
        const currentIsDay = computeCelestialState(this.celestialOverride).isDaytime;
        this.celestialOverride = currentIsDay ? 'night' : 'day';
        this.syncCelestialButtonUI();
        this.drawSkyFallbackBands(this.viewWidth, this.viewHeight);
        chiptuneAudio.playToggle();
        debugLog('Celestial sky toggled manually', { mode: this.celestialOverride });
      };
      this.celestialBtn.addEventListener('click', onCelestial);
      this.cleanups.push(() =>
        this.celestialBtn?.removeEventListener('click', onCelestial),
      );
    }

    if (this.audioBtn) {
      this.audioBtn.dataset.muted = 'false';
      const onAudio = () => {
        const nextMuted = chiptuneAudio.toggleMute();
        if (this.audioBtn) {
          this.audioBtn.dataset.muted = String(nextMuted);
          this.audioBtn.textContent = nextMuted ? 'Unmute SFX' : 'Mute SFX';
        }
      };
      this.audioBtn.addEventListener('click', onAudio);
      this.cleanups.push(() => this.audioBtn?.removeEventListener('click', onAudio));
    }

    if (this.motionBtn) {
      const onMotion = () => {
        this.setMotionPaused(!this.motionPaused, true);
      };
      this.motionBtn.addEventListener('click', onMotion);
      this.cleanups.push(() => this.motionBtn?.removeEventListener('click', onMotion));
    }

    if (this.roastTriggerBtn) {
      const onRoast = () => this.triggerRoastChest();
      this.roastTriggerBtn.addEventListener('click', onRoast);
      this.cleanups.push(() =>
        this.roastTriggerBtn?.removeEventListener('click', onRoast),
      );
    }

    if (this.dogTriggerBtn) {
      const onDog = () => this.triggerWhiteDogMemorial();
      this.dogTriggerBtn.addEventListener('click', onDog);
      this.cleanups.push(() => this.dogTriggerBtn?.removeEventListener('click', onDog));
    }
  }

  private bindKeyboardControls(): void {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableOrModified(event)) return;
      // Do not intercept keys while a native modal <dialog> is open.
      if (document.querySelector('dialog[open]')) return;

      const key = event.key.toLowerCase();

      // Free walk horizontal keys + gentle W hop
      if (
        event.code === 'ArrowLeft' ||
        event.code === 'ArrowRight' ||
        event.code === 'KeyA' ||
        event.code === 'KeyD'
      ) {
        this.keysHeld.add(event.code);
        chiptuneAudio.unlock();
        return;
      }

      if (event.code === 'KeyW' && this.hopOffset === 0) {
        this.hopVelocity = -170;
        chiptuneAudio.unlock();
        chiptuneAudio.playStep();
        return;
      }

      // Fast-travel hotkeys 1..5
      if (key >= '1' && key <= '5') {
        chiptuneAudio.unlock();
        this.fastTravelTo(Number(key) - 1, true);
        return;
      }

      // White Dog memorial shortcut [B]
      if (key === 'b') {
        (event as KeyboardEvent & { __hwHandled?: boolean }).__hwHandled = true;
        this.triggerWhiteDogMemorial();
        return;
      }

      // Roast chest shortcut [R] or [C]
      if (key === 'r' || key === 'c') {
        (event as KeyboardEvent & { __hwHandled?: boolean }).__hwHandled = true;
        this.triggerRoastChest();
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      this.keysHeld.delete(event.code);
    };

    const onBlur = () => {
      this.keysHeld.clear();
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);
    this.cleanups.push(() => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
    });
  }

  private bindScrollObserver(): void {
    if (typeof IntersectionObserver === 'undefined') return;

    const sections = OVERWORLD_ZONES.map(
      (z) =>
        document.getElementById(z.id) ||
        document.querySelector<HTMLElement>(`[data-zone="${z.id}"]`),
    ).filter((el): el is HTMLElement => Boolean(el));

    if (sections.length === 0) return;

    this.intersectionObserver = new IntersectionObserver(
      (entries) => {
        if (this.keysHeld.size > 0) return;
        if (performance.now() < this.autoScrollLockUntil) return;

        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          const el = entry.target as HTMLElement;
          const zoneId = el.dataset.zone || el.id;
          const zone = OVERWORLD_ZONES.find((z) => z.id === zoneId);
          if (!zone || zone.index === this.activeZoneIndex) continue;

          this.targetPartyX = zone.worldX;
          this.facingDir = zone.worldX >= this.partyX ? 1 : -1;
          this.syncZoneUI(zone.index, false);
        }
      },
      { rootMargin: '-35% 0px -45% 0px', threshold: 0 },
    );

    for (const section of sections) {
      this.intersectionObserver.observe(section);
    }
  }

  public destroy(): void {
    for (const cleanup of this.cleanups) cleanup();
    this.cleanups = [];
    this.resizeObserver?.disconnect();
    this.intersectionObserver?.disconnect();
    this.app?.destroy(true, { children: true, texture: true });
    this.app = null;
  }
}

let activeController: OverworldController | null = null;

/**
 * Mount and boot the 16-bit Overworld controller inside `#overworldStage`.
 */
export async function initOverworld(): Promise<OverworldController | null> {
  if (typeof window === 'undefined') return null;
  const stageRoot = document.getElementById('overworldStage');
  if (!stageRoot) return null;

  if (stageRoot.dataset.overworldMounted === '1' && activeController) {
    return activeController;
  }
  stageRoot.dataset.overworldMounted = '1';

  const controller = new OverworldController(stageRoot);
  activeController = controller;
  await controller.mount();
  return controller;
}
