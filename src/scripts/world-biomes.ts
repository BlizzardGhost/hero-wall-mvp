/**
 * Path: src/scripts/world-biomes.ts
 * Purpose: Panoramic 2400x540 5-biome SNES RPG world map, WGSL/GLSL celestial sky
 *          shaders (day, sunset/amber dusk, starry night, smooth biome atmosphere
 *          blending), hotspot definitions with collision radii, and unified
 *          PixiJS v8 Graphics + Canvas2D tilemap painters.
 * Spec Reference: SPEC-021 (021-hero-wall-full-game-overworld)
 *
 * Debug Operator Notes:
 * - Set `window.__RASS_OVERWORLD_DEBUG__ = true` to log biome transitions,
 *   collision pushouts, and tilemap rendering statistics.
 * - `WALKABLE_BOUNDS` keeps characters inside `y = 220..472` below the northern
 *   ruin/cliff rim (`HORIZON_Y = 188`) and above the southern highland edge (`y = 478`).
 */

export type BiomeId = 'sanctuary' | 'eras' | 'relics' | 'trophies' | 'beacon';

export type HotspotKind =
  | 'campfire'
  | 'companion'
  | 'advisors'
  | 'era'
  | 'relic'
  | 'trophy'
  | 'beacon'
  | 'chest';

export type HotspotTargetState = 'DIALOGUE' | 'INSPECT_RELIC' | 'MIMIC_ROAST';

export interface BiomeDefinition {
  id: BiomeId;
  index: number;
  name: string;
  shortLabel: string;
  xStart: number;
  xEnd: number;
  spawnX: number;
  spawnY: number;
  /** Legacy/convenience horizontal anchor alias matching spawnX. */
  worldX: number;
  primaryHex: string;
  accentHex: string;
  groundHex: string;
  pathHex: string;
  primaryColor: number;
  accentColor: number;
  groundColor: number;
  pathColor: number;
  /** Normalized RGB sky horizon tint (0..1) used by the WGSL/GLSL sky shader. */
  skyTintRgb: readonly [number, number, number];
  subtitle: string;
}

export interface WorldHotspot {
  id: string;
  biome: BiomeId;
  kind: HotspotKind;
  label: string;
  promptAction: string;
  x: number;
  y: number;
  /** Interaction proximity radius in world pixels. */
  radius: number;
  /** Solid obstacle radius in world pixels (0 for non-blocking companions). */
  collisionRadius: number;
  targetState: HotspotTargetState;
  /** Optional 0-based index for Hall of Eras (0..4) or Relic Vault (0..2). */
  itemIndex?: number;
}

export interface BiomeAtmosphereSample {
  primary: BiomeDefinition;
  secondary: BiomeDefinition;
  blend: number;
  tintRgb: [number, number, number];
}

export interface PixiGraphicsLike {
  clear?: () => unknown;
  rect: (x: number, y: number, w: number, h: number) => {
    fill: (style: number | { color: number; alpha?: number }) => unknown;
  };
}

declare global {
  interface Window {
    __RASS_OVERWORLD_DEBUG__?: boolean;
  }
}

export const WORLD_WIDTH = 2400;
export const WORLD_HEIGHT = 540;
export const HORIZON_Y = 188;

/**
 * Walkable ground rectangle keeping Boris and party safely below northern
 * architecture/cliffs and above the southern highland rim.
 */
export const WALKABLE_BOUNDS = {
  minX: 44,
  maxX: 2356,
  minY: 222,
  maxY: 472,
} as const;

/**
 * Transition band width (px) across biome borders so sky atmosphere tints
 * cross-fade smoothly rather than snapping abruptly at x = 480/960/1440/1920.
 */
const BIOME_TRANSITION_HALF_WIDTH = 96;

/**
 * Emit opt-in debug diagnostics when `window.__RASS_OVERWORLD_DEBUG__` is enabled.
 */
function debugLog(message: string, detail?: unknown): void {
  if (typeof window !== 'undefined' && window.__RASS_OVERWORLD_DEBUG__) {
    console.info(`[WorldBiomes] ${message}`, detail ?? '');
  }
}

/**
 * WGSL dynamic celestial sky vertex shader compiled for PixiJS v8 WebGPU.
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

/**
 * WGSL dynamic SNES celestial fragment shader supporting:
 * - Crisp quantized 28-band 16-bit sky gradients
 * - Daylight sky with drifting pixel cloud wisps
 * - Sunset / amber dusk bloom (#f97316 -> #facc15) near twilight transitions
 * - Starry night with twinkling pixel starfield and lunar glow
 * - Smooth per-biome horizon atmosphere blending via `uBiomeAtmosphere`
 */
export const WGSL_SKY_SHADER = `
struct SkyUniforms {
  uSkyState: vec4<f32>,        // x = dayFactor (0..1), y = timeSec, z = celestialNormX, w = celestialNormY
  uBiomeAtmosphere: vec4<f32>, // rgb = active biome tint, w = duskBoost (0..1)
};
@group(2) @binding(0) var<uniform> skyUniforms : SkyUniforms;

@fragment
fn main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  let day = clamp(skyUniforms.uSkyState.x, 0.0, 1.0);
  let t = skyUniforms.uSkyState.y;
  let sunPos = skyUniforms.uSkyState.zw;
  let biomeTint = skyUniforms.uBiomeAtmosphere.rgb;
  let duskBoost = clamp(skyUniforms.uBiomeAtmosphere.w, 0.0, 1.0);

  // Quantize vertical coordinate into 28 crisp SNES sky bands.
  let qY = floor(uv.y * 28.0) / 28.0;

  // Starry night palette (#090d16 obsidian -> #1e1b4b astral indigo)
  let nightZenith = vec3<f32>(0.035, 0.051, 0.086);
  let nightHorizon = vec3<f32>(0.106, 0.145, 0.275);

  // Daylight palette (#1d4ed8 cobalt -> #7dd3fc horizon sky)
  let dayZenith = vec3<f32>(0.114, 0.306, 0.549);
  let dayHorizon = vec3<f32>(0.420, 0.788, 0.949);

  // Sunset / amber dusk palette (#4c1d95 violet zenith -> #f97316 amber horizon)
  let sunsetZenith = vec3<f32>(0.235, 0.110, 0.365);
  let sunsetHorizon = vec3<f32>(0.976, 0.451, 0.086);

  let twilight = max(pow(sin(day * 3.14159265), 1.25), duskBoost);
  let baseZenith = mix(mix(nightZenith, dayZenith, day), sunsetZenith, twilight * 0.68);
  let baseHorizon = mix(mix(nightHorizon, dayHorizon, day), sunsetHorizon, twilight * 0.85);

  // Blend biome atmospheric color softly into the lower sky horizon.
  let horizonWithBiome = mix(baseHorizon, biomeTint, 0.38);
  var col = mix(baseZenith, horizonWithBiome, pow(qY, 1.12));

  // Solar / lunar corona glow
  let distToBody = distance(uv, sunPos);
  let halo = smoothstep(0.42, 0.0, distToBody);
  col = col + vec3<f32>(0.980, 0.800, 0.082) * halo * 0.32 * max(day, twilight * 0.65);
  col = col + vec3<f32>(0.024, 0.714, 0.831) * halo * 0.24 * (1.0 - day);

  // Warm gold ribbon right above the horizon during amber dusk
  let duskRibbon = smoothstep(0.55, 0.98, qY) * twilight;
  col = col + vec3<f32>(0.980, 0.620, 0.120) * duskRibbon * 0.24;

  // Quantized pixel cloud bands visible during day & sunset
  let cloudGrid = floor(vec2<f32>(uv.x * 48.0 + t * 0.45, uv.y * 18.0));
  let cloudNoise = fract(sin(dot(cloudGrid, vec2<f32>(91.7, 213.3))) * 19453.17);
  if (cloudNoise > 0.86 && qY > 0.14 && qY < 0.56) {
    let cloudColor = mix(vec3<f32>(0.98, 0.74, 0.46), vec3<f32>(0.96, 0.98, 1.0), day);
    col = mix(col, cloudColor, (0.18 + day * 0.24) * (1.0 - step(0.5, 1.0 - day - twilight)));
  }

  // Quantized pixel starfield visible during starry night & dusk zenith
  let starCell = floor(uv * vec2<f32>(72.0, 32.0));
  let starHash = fract(sin(dot(starCell, vec2<f32>(127.1, 311.7))) * 43758.5453);
  let nightVis = clamp(1.0 - day * 1.15, 0.0, 1.0);
  if (starHash > 0.982 && uv.y < 0.68) {
    let twinkle = 0.55 + 0.45 * sin(t * 2.4 + starHash * 41.0);
    col = col + vec3<f32>(0.957, 0.890, 0.765) * nightVis * twinkle * 0.85;
  }

  return vec4<f32>(col, 1.0);
}
`.trim();

/**
 * Equivalent GLSL ES 3.00 vertex shader for WebGL2 fallback.
 */
export const GLSL_SKY_VERTEX = `
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

/**
 * Equivalent GLSL ES 3.00 fragment shader mirroring WGSL_SKY_SHADER for WebGL2 fallback.
 */
export const GLSL_SKY_FRAGMENT = `
#version 300 es
precision mediump float;
in vec2 vUV;
out vec4 fragColor;

uniform vec4 uSkyState;
uniform vec4 uBiomeAtmosphere;

void main() {
  float day = clamp(uSkyState.x, 0.0, 1.0);
  float t = uSkyState.y;
  vec2 sunPos = uSkyState.zw;
  vec3 biomeTint = uBiomeAtmosphere.rgb;
  float duskBoost = clamp(uBiomeAtmosphere.w, 0.0, 1.0);

  float qY = floor(vUV.y * 28.0) / 28.0;

  vec3 nightZenith = vec3(0.035, 0.051, 0.086);
  vec3 nightHorizon = vec3(0.106, 0.145, 0.275);
  vec3 dayZenith = vec3(0.114, 0.306, 0.549);
  vec3 dayHorizon = vec3(0.420, 0.788, 0.949);
  vec3 sunsetZenith = vec3(0.235, 0.110, 0.365);
  vec3 sunsetHorizon = vec3(0.976, 0.451, 0.086);

  float twilight = max(pow(sin(day * 3.14159265), 1.25), duskBoost);
  vec3 baseZenith = mix(mix(nightZenith, dayZenith, day), sunsetZenith, twilight * 0.68);
  vec3 baseHorizon = mix(mix(nightHorizon, dayHorizon, day), sunsetHorizon, twilight * 0.85);

  vec3 horizonWithBiome = mix(baseHorizon, biomeTint, 0.38);
  vec3 col = mix(baseZenith, horizonWithBiome, pow(qY, 1.12));

  float distToBody = distance(vUV, sunPos);
  float halo = smoothstep(0.42, 0.0, distToBody);
  col += vec3(0.980, 0.800, 0.082) * halo * 0.32 * max(day, twilight * 0.65);
  col += vec3(0.024, 0.714, 0.831) * halo * 0.24 * (1.0 - day);

  float duskRibbon = smoothstep(0.55, 0.98, qY) * twilight;
  col += vec3(0.980, 0.620, 0.120) * duskRibbon * 0.24;

  vec2 cloudGrid = floor(vec2(vUV.x * 48.0 + t * 0.45, vUV.y * 18.0));
  float cloudNoise = fract(sin(dot(cloudGrid, vec2(91.7, 213.3))) * 19453.17);
  if (cloudNoise > 0.86 && qY > 0.14 && qY < 0.56) {
    vec3 cloudColor = mix(vec3(0.98, 0.74, 0.46), vec3(0.96, 0.98, 1.0), day);
    col = mix(col, cloudColor, (0.18 + day * 0.24) * (1.0 - step(0.5, 1.0 - day - twilight)));
  }

  vec2 starCell = floor(vUV * vec2(72.0, 32.0));
  float starHash = fract(sin(dot(starCell, vec2(127.1, 311.7))) * 43758.5453);
  float nightVis = clamp(1.0 - day * 1.15, 0.0, 1.0);
  if (starHash > 0.982 && vUV.y < 0.68) {
    float twinkle = 0.55 + 0.45 * sin(t * 2.4 + starHash * 41.0);
    col += vec3(0.957, 0.890, 0.765) * nightVis * twinkle * 0.85;
  }

  fragColor = vec4(col, 1.0);
}
`.trim();

/**
 * Five distinct SNES biomes spanning the 2400px panoramic RPG overworld.
 * Each region features dedicated ground tiles, paths, torches, and sky tints.
 */
export const BIOME_DEFINITIONS: readonly BiomeDefinition[] = [
  {
    id: 'sanctuary',
    index: 0,
    name: 'Sanctuary Campfire',
    shortLabel: 'Sanctuary',
    xStart: 0,
    xEnd: 480,
    spawnX: 220,
    spawnY: 368,
    worldX: 220,
    primaryHex: '#15803d',
    accentHex: '#f97316',
    groundHex: '#14532d',
    pathHex: '#926239',
    primaryColor: 0x15803d,
    accentColor: 0xf97316,
    groundColor: 0x14532d,
    pathColor: 0x926239,
    skyTintRgb: [0.976, 0.451, 0.086],
    subtitle: 'Campfire Clearing, Companions & Dossier Hearth',
  },
  {
    id: 'eras',
    index: 1,
    name: 'Hall of Eras',
    shortLabel: 'Eras',
    xStart: 480,
    xEnd: 960,
    spawnX: 720,
    spawnY: 326,
    worldX: 720,
    primaryHex: '#090d16',
    accentHex: '#a855f7',
    groundHex: '#111827',
    pathHex: '#334155',
    primaryColor: 0x090d16,
    accentColor: 0xa855f7,
    groundColor: 0x111827,
    pathColor: 0x334155,
    skyTintRgb: [0.659, 0.333, 0.969],
    subtitle: 'Obsidian Ruins & 5 Era Rune Obelisks',
  },
  {
    id: 'relics',
    index: 2,
    name: 'Cyber-Forge Relic Vault',
    shortLabel: 'Relics',
    xStart: 960,
    xEnd: 1440,
    spawnX: 1200,
    spawnY: 324,
    worldX: 1200,
    primaryHex: '#ea580c',
    accentHex: '#f97316',
    groundHex: '#292524',
    pathHex: '#78350f',
    primaryColor: 0xea580c,
    accentColor: 0xf97316,
    groundColor: 0x292524,
    pathColor: 0x78350f,
    skyTintRgb: [0.918, 0.345, 0.047],
    subtitle: 'KidsLab 3.0, Infusio & Camp David Pedestals',
  },
  {
    id: 'trophies',
    index: 3,
    name: 'Trophy Armory',
    shortLabel: 'Trophies',
    xStart: 1440,
    xEnd: 1920,
    spawnX: 1680,
    spawnY: 364,
    worldX: 1680,
    primaryHex: '#facc15',
    accentHex: '#ef4444',
    groundHex: '#1e1b2e',
    pathHex: '#991b1b',
    primaryColor: 0xfacc15,
    accentColor: 0xef4444,
    groundColor: 0x1e1b2e,
    pathColor: 0x991b1b,
    skyTintRgb: [0.980, 0.800, 0.082],
    subtitle: 'Gilded Hall, Crimson Runner & 21 Trophies',
  },
  {
    id: 'beacon',
    index: 4,
    name: 'Mountain Signal Beacon',
    shortLabel: 'Beacon',
    xStart: 1920,
    xEnd: 2400,
    spawnX: 2170,
    spawnY: 364,
    worldX: 2170,
    primaryHex: '#06b6d4',
    accentHex: '#67e8f9',
    groundHex: '#082f49',
    pathHex: '#164e63',
    primaryColor: 0x06b6d4,
    accentColor: 0x67e8f9,
    groundColor: 0x082f49,
    pathColor: 0x164e63,
    skyTintRgb: [0.024, 0.714, 0.831],
    subtitle: 'Starfield Summit & Transmission Antenna',
  },
] as const;

/**
 * Interactive world hotspots with proximity interaction radii and physical
 * collision radii across all 5 biomes.
 */
export const WORLD_HOTSPOTS: readonly WorldHotspot[] = [
  {
    id: 'campfire',
    biome: 'sanctuary',
    kind: 'campfire',
    label: 'Sanctuary Campfire',
    promptAction: 'Rest by Sanctuary Campfire',
    x: 220,
    y: 314,
    radius: 64,
    collisionRadius: 22,
    targetState: 'DIALOGUE',
  },
  {
    id: 'white-dog',
    biome: 'sanctuary',
    kind: 'companion',
    label: 'White Dog (Emy, Kiba & Yue)',
    promptAction: 'Pet White Dog [B]',
    x: 144,
    y: 356,
    radius: 56,
    collisionRadius: 0,
    targetState: 'DIALOGUE',
  },
  {
    id: 'advisors',
    biome: 'sanctuary',
    kind: 'advisors',
    label: 'RASS Drone & Ms. Devil',
    promptAction: 'Consult Cockpit Advisors',
    x: 322,
    y: 282,
    radius: 58,
    collisionRadius: 0,
    targetState: 'DIALOGUE',
  },
  {
    id: 'roast-chest',
    biome: 'sanctuary',
    kind: 'chest',
    label: 'Mimic Roast Chest',
    promptAction: 'Open Mimic Roast Chest [R]',
    x: 418,
    y: 382,
    radius: 56,
    collisionRadius: 18,
    targetState: 'MIMIC_ROAST',
  },
  {
    id: 'era-0',
    biome: 'eras',
    kind: 'era',
    label: 'Obelisk I: Stone Age (2010 - 2013)',
    promptAction: 'Read Stone Age Obelisk',
    x: 548,
    y: 274,
    radius: 54,
    collisionRadius: 18,
    targetState: 'INSPECT_RELIC',
    itemIndex: 0,
  },
  {
    id: 'era-1',
    biome: 'eras',
    kind: 'era',
    label: 'Obelisk II: Steel Age (2014 - 2018)',
    promptAction: 'Read Steel Age Obelisk',
    x: 634,
    y: 368,
    radius: 54,
    collisionRadius: 18,
    targetState: 'INSPECT_RELIC',
    itemIndex: 1,
  },
  {
    id: 'era-2',
    biome: 'eras',
    kind: 'era',
    label: 'Obelisk III: Crystal Age (2019 - 2022)',
    promptAction: 'Read Crystal Age Obelisk',
    x: 720,
    y: 274,
    radius: 54,
    collisionRadius: 18,
    targetState: 'INSPECT_RELIC',
    itemIndex: 2,
  },
  {
    id: 'era-3',
    biome: 'eras',
    kind: 'era',
    label: 'Obelisk IV: Graphene Age (2023 - 2025)',
    promptAction: 'Read Graphene Age Obelisk',
    x: 806,
    y: 368,
    radius: 54,
    collisionRadius: 18,
    targetState: 'INSPECT_RELIC',
    itemIndex: 3,
  },
  {
    id: 'era-4',
    biome: 'eras',
    kind: 'era',
    label: 'Obelisk V: Sovereign Age (2026 - Present)',
    promptAction: 'Read Sovereign Age Obelisk',
    x: 892,
    y: 274,
    radius: 54,
    collisionRadius: 18,
    targetState: 'INSPECT_RELIC',
    itemIndex: 4,
  },
  {
    id: 'relic-0',
    biome: 'relics',
    kind: 'relic',
    label: 'KidsLab 3.0 Core Matrix',
    promptAction: 'Inspect KidsLab 3.0 Pedestal',
    x: 1060,
    y: 286,
    radius: 58,
    collisionRadius: 22,
    targetState: 'INSPECT_RELIC',
    itemIndex: 0,
  },
  {
    id: 'relic-1',
    biome: 'relics',
    kind: 'relic',
    label: 'Infusio AI Studio Engine',
    promptAction: 'Inspect Infusio Pedestal',
    x: 1200,
    y: 366,
    radius: 58,
    collisionRadius: 22,
    targetState: 'INSPECT_RELIC',
    itemIndex: 1,
  },
  {
    id: 'relic-2',
    biome: 'relics',
    kind: 'relic',
    label: 'Camp David Field Compass',
    promptAction: 'Inspect Camp David Pedestal',
    x: 1340,
    y: 286,
    radius: 58,
    collisionRadius: 22,
    targetState: 'INSPECT_RELIC',
    itemIndex: 2,
  },
  {
    id: 'trophy-pedestal',
    biome: 'trophies',
    kind: 'trophy',
    label: 'Trophy Armory Pedestal (21 Cards)',
    promptAction: 'Inspect 21 Battle-Forged Trophies',
    x: 1680,
    y: 304,
    radius: 68,
    collisionRadius: 24,
    targetState: 'INSPECT_RELIC',
  },
  {
    id: 'signal-beacon',
    biome: 'beacon',
    kind: 'beacon',
    label: 'Signal Beacon Transmission Tower',
    promptAction: 'Open Signal Beacon Transceiver',
    x: 2170,
    y: 296,
    radius: 72,
    collisionRadius: 26,
    targetState: 'INSPECT_RELIC',
  },
] as const;

/**
 * Look up a biome definition by ID, defaulting to `sanctuary`.
 */
export function getBiomeById(id: BiomeId): BiomeDefinition {
  return BIOME_DEFINITIONS.find((b) => b.id === id) ?? BIOME_DEFINITIONS[0];
}

/**
 * Return the active biome covering horizontal world coordinate `x` (0..2400).
 */
export function getBiomeAtX(x: number): BiomeDefinition {
  const clampedX = Math.max(0, Math.min(WORLD_WIDTH - 1, x));
  for (const biome of BIOME_DEFINITIONS) {
    if (clampedX >= biome.xStart && clampedX < biome.xEnd) {
      return biome;
    }
  }
  return BIOME_DEFINITIONS[BIOME_DEFINITIONS.length - 1];
}

/**
 * Compute smooth sky atmosphere tint cross-faded across biome boundaries so
 * moving between biomes never produces abrupt sky color snaps.
 */
export function getBiomeAtmosphereAtX(x: number): BiomeAtmosphereSample {
  const primary = getBiomeAtX(x);
  const idx = primary.index;
  const distLeft = x - primary.xStart;
  const distRight = primary.xEnd - x;

  let secondary = primary;
  let blend = 0;

  if (distLeft < BIOME_TRANSITION_HALF_WIDTH && idx > 0) {
    secondary = BIOME_DEFINITIONS[idx - 1];
    blend = 0.5 * (1 - distLeft / BIOME_TRANSITION_HALF_WIDTH);
  } else if (distRight < BIOME_TRANSITION_HALF_WIDTH && idx < BIOME_DEFINITIONS.length - 1) {
    secondary = BIOME_DEFINITIONS[idx + 1];
    blend = 0.5 * (1 - distRight / BIOME_TRANSITION_HALF_WIDTH);
  }

  const tintRgb: [number, number, number] = [
    primary.skyTintRgb[0] + (secondary.skyTintRgb[0] - primary.skyTintRgb[0]) * blend,
    primary.skyTintRgb[1] + (secondary.skyTintRgb[1] - primary.skyTintRgb[1]) * blend,
    primary.skyTintRgb[2] + (secondary.skyTintRgb[2] - primary.skyTintRgb[2]) * blend,
  ];

  return { primary, secondary, blend, tintRgb };
}

/**
 * Find the closest interactive hotspot within its interaction radius of `(x, y)`.
 * Optional `dynamicCoords` allows mobile party members (e.g. `white-dog` or
 * `advisors`) to override their static anchor when following Boris.
 */
export function findNearestHotspot(
  x: number,
  y: number,
  dynamicCoords?: Partial<Record<string, { x: number; y: number }>>,
): { hotspot: WorldHotspot; distance: number } | null {
  let bestHotspot: WorldHotspot | null = null;
  let bestDist = Infinity;

  for (const hotspot of WORLD_HOTSPOTS) {
    const pos = dynamicCoords?.[hotspot.id] ?? hotspot;
    const dx = x - pos.x;
    const dy = y - pos.y;
    const dist = Math.hypot(dx, dy);
    if (dist <= hotspot.radius && dist < bestDist) {
      bestHotspot = hotspot;
      bestDist = dist;
    }
  }

  return bestHotspot ? { hotspot: bestHotspot, distance: bestDist } : null;
}

/**
 * Clamp `(x, y)` inside WALKABLE_BOUNDS and gently push Boris outside solid
 * monument collision circles (`collisionRadius > 0`).
 */
export function resolveWorldCollisions(
  x: number,
  y: number,
  playerRadius = 14,
): { x: number; y: number } {
  let nextX = Math.max(WALKABLE_BOUNDS.minX, Math.min(WALKABLE_BOUNDS.maxX, x));
  let nextY = Math.max(WALKABLE_BOUNDS.minY, Math.min(WALKABLE_BOUNDS.maxY, y));

  for (const hotspot of WORLD_HOTSPOTS) {
    if (hotspot.collisionRadius <= 0) continue;
    const minDist = hotspot.collisionRadius + playerRadius;
    const dx = nextX - hotspot.x;
    const dy = nextY - hotspot.y;
    const dist = Math.hypot(dx, dy);

    if (dist < minDist) {
      // Deterministic pushout vector if center coincides exactly with monument center.
      const nx = dist > 0.001 ? dx / dist : 0;
      const ny = dist > 0.001 ? dy / dist : 1;
      nextX = hotspot.x + nx * minDist;
      nextY = hotspot.y + ny * minDist;
      debugLog('Resolved solid hotspot collision', { id: hotspot.id, nextX, nextY });
    }
  }

  return {
    x: Math.max(WALKABLE_BOUNDS.minX, Math.min(WALKABLE_BOUNDS.maxX, nextX)),
    y: Math.max(WALKABLE_BOUNDS.minY, Math.min(WALKABLE_BOUNDS.maxY, nextY)),
  };
}

/**
 * Shared rectangle-drawing adapter uniting PixiJS Graphics and Canvas2D so
 * all 5 biomes render identically without duplicating tilemap logic.
 */
type RectDrawFn = (
  x: number,
  y: number,
  w: number,
  h: number,
  color: number,
  alpha?: number,
) => void;

const hexCache = new Map<number, string>();
function colorToCss(color: number): string {
  let css = hexCache.get(color);
  if (!css) {
    css = `#${color.toString(16).padStart(6, '0')}`;
    hexCache.set(color, css);
  }
  return css;
}

/**
 * Deterministic 16-bit integer hash in [0, 1) for crisp tile variation.
 */
function tileHash(tx: number, ty: number): number {
  const n = Math.sin(tx * 127.1 + ty * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

/**
 * Compute smooth center Y of the panoramic RPG trail for any world `x`.
 */
function getTrailCenterY(x: number): number {
  return 334 + Math.round(Math.sin(x * 0.0075) * 14);
}

/**
 * Draw northern biome cliff/architecture silhouettes, stone walls, and torches.
 */
function paintNorthernBackdrop(
  drawRect: RectDrawFn,
  biome: BiomeDefinition,
  elapsedSec: number,
): void {
  const { xStart, xEnd, id } = biome;
  const step = 32;

  // Distant mountain silhouette behind HORIZON_Y
  for (let x = xStart; x < xEnd; x += step) {
    const h = 36 + Math.round(((Math.sin(x * 0.019 + biome.index * 1.3) + 1) * 0.5) * 46);
    const ridgeColor =
      id === 'sanctuary'
        ? 0x0f3b26
        : id === 'eras'
          ? 0x131628
          : id === 'relics'
            ? 0x2c1610
            : id === 'trophies'
              ? 0x2a2038
              : 0x0c344d;
    drawRect(x, HORIZON_Y - h, step + 1, h + 14, ridgeColor, 0.92);

    // Biome-specific ridge rim highlight
    drawRect(x + 4, HORIZON_Y - h, step - 8, 4, biome.accentColor, 0.32);
  }

  // Northern wall / cliff boundary (y = 186..218)
  for (let x = xStart; x < xEnd; x += 24) {
    if (id === 'sanctuary') {
      // Forest canopy clusters & mossy stone bank
      drawRect(x, 186, 24, 30, 0x14532d);
      drawRect(x + 2, 180, 20, 14, 0x15803d);
      drawRect(x + 6, 184, 10, 6, 0x22c55e, 0.65);
    } else if (id === 'eras') {
      // Ancient broken obsidian ruins & glowing purple rune pillars
      drawRect(x, 188, 24, 28, 0x0f172a);
      if ((x / 24) % 3 === 0) {
        drawRect(x + 4, 166, 16, 48, 0x1e293b);
        drawRect(x + 8, 174, 8, 22, 0xa855f7, 0.72);
      }
    } else if (id === 'relics') {
      // Cyber-Forge copper bulkhead & exhaust vents
      drawRect(x, 186, 24, 30, 0x1c1917);
      drawRect(x, 192, 24, 6, 0xea580c);
      if ((x / 24) % 2 === 0) {
        drawRect(x + 6, 198, 12, 12, 0xf97316, 0.78);
      }
    } else if (id === 'trophies') {
      // Gilded Trophy Armory colonnade & crimson banners
      drawRect(x, 186, 24, 30, 0x1e1b2e);
      drawRect(x, 186, 24, 5, 0xfacc15);
      if ((x / 24) % 3 === 1) {
        drawRect(x + 5, 191, 14, 22, 0x991b1b);
        drawRect(x + 9, 195, 6, 10, 0xfacc15);
      }
    } else {
      // Starfield Mountain Summit jagged ice/cyan cliff crystals
      drawRect(x, 186, 24, 30, 0x090d16);
      drawRect(x + 2, 178 + ((x / 24) % 2) * 6, 18, 18, 0x0e7490);
      drawRect(x + 7, 182, 8, 8, 0x06b6d4, 0.78);
    }
  }

  // Periodic perimeter torches along northern wall (x every 160px inside each biome)
  const flicker = 0.72 + Math.sin(elapsedSec * 9 + biome.index) * 0.18;
  for (let x = xStart + 72; x < xEnd - 48; x += 160) {
    drawRect(x - 3, 200, 6, 16, 0x475569);
    const torchFlame =
      id === 'eras'
        ? 0xa855f7
        : id === 'beacon'
          ? 0x06b6d4
          : id === 'trophies'
            ? 0xfacc15
            : 0xf97316;
    drawRect(x - 5, 192, 10, 10, torchFlame, flicker);
    drawRect(x - 2, 194, 4, 5, 0xffffff, 0.85);
    drawRect(x - 14, 188, 28, 28, torchFlame, 0.14 * flicker);
  }
}

/**
 * Paint all 5 SNES biome ground tile layers, paths, magma channels, gilded
 * inlaid patterns, crimson runner, starry summit cliffs, and border gates.
 */
function paintWorldTilemap(
  drawRect: RectDrawFn,
  elapsedSec = 0,
  minPaintX = 0,
  maxPaintX = WORLD_WIDTH,
): void {
  const tileSize = 24;
  const startCol = Math.max(0, Math.floor(minPaintX / tileSize));
  const endCol = Math.min(Math.ceil(WORLD_WIDTH / tileSize) - 1, Math.ceil(maxPaintX / tileSize));

  // 1. Paint northern mountains, biome architecture, and torches
  for (const biome of BIOME_DEFINITIONS) {
    if (biome.xEnd < minPaintX || biome.xStart > maxPaintX) continue;
    paintNorthernBackdrop(drawRect, biome, elapsedSec);
  }

  // 2. Paint 24x24 ground terrain tiles across walkable field (y = 216..480)
  for (let col = startCol; col <= endCol; col += 1) {
    const x = col * tileSize;
    const biome = getBiomeAtX(x + tileSize * 0.5);

    for (let y = 216; y < 480; y += tileSize) {
      const h = tileHash(col, y / tileSize);
      let base = biome.groundColor;

      if (biome.id === 'sanctuary') {
        base = h > 0.65 ? 0x15803d : h > 0.3 ? 0x166534 : 0x14532d;
      } else if (biome.id === 'eras') {
        base = h > 0.72 ? 0x1e293b : h > 0.35 ? 0x111827 : 0x090d16;
      } else if (biome.id === 'relics') {
        base = h > 0.68 ? 0x3b261d : h > 0.32 ? 0x292524 : 0x1c1917;
      } else if (biome.id === 'trophies') {
        base = (col + y / tileSize) % 2 === 0 ? 0x1e1b2e : 0x29233d;
      } else {
        base = h > 0.65 ? 0x0e7490 : h > 0.3 ? 0x082f49 : 0x090d16;
      }

      drawRect(x, y, tileSize, tileSize, base);

      // Subtle 16-bit tile bevel & micro-detail pixels
      if (biome.id === 'sanctuary' && h > 0.76) {
        drawRect(x + 6, y + 8, 4, 4, 0x22c55e, 0.75);
        drawRect(x + 14, y + 14, 3, 3, h > 0.9 ? 0xfacc15 : 0xf4e3c3, 0.8);
      } else if (biome.id === 'eras' && h > 0.74) {
        drawRect(x + 4, y + 10, 14, 2, 0xa855f7, 0.32);
        drawRect(x + 2, y + 2, tileSize - 4, 1, 0x334155, 0.5);
      } else if (biome.id === 'relics') {
        drawRect(x + 1, y + 1, tileSize - 2, 2, 0xea580c, 0.28);
        if (h > 0.82) drawRect(x + 10, y + 10, 4, 4, 0xf97316, 0.45);
      } else if (biome.id === 'trophies') {
        drawRect(x, y, tileSize, 2, 0xfacc15, 0.25);
        if (h > 0.82) drawRect(x + 9, y + 9, 6, 6, 0xfacc15, 0.38);
      } else if (biome.id === 'beacon') {
        drawRect(x + 2, y + 2, tileSize - 4, 1, 0x06b6d4, 0.34);
        if (h > 0.84) drawRect(x + 8, y + 12, 4, 4, 0x67e8f9, 0.7);
      }
    }

    // 3. Paint winding panoramic RPG path across this column
    const pathY = getTrailCenterY(x + tileSize * 0.5);
    const pathEdge = biome.id === 'sanctuary' ? 0x78350f : biome.id === 'trophies' ? 0xfacc15 : 0x090d16;
    drawRect(x, pathY - 22, tileSize, 44, pathEdge, 0.65);
    drawRect(x, pathY - 18, tileSize, 36, biome.pathColor);
    if (col % 2 === 0) {
      drawRect(x + 4, pathY - 10, 12, 6, biome.accentColor, 0.25);
      drawRect(x + 8, pathY + 6, 10, 5, 0xf4e3c3, 0.14);
    }
  }

  // 4. Biome-specific featured floor landmarks & environmental storytelling
  // 4a. Sanctuary warm amber campfire clearing (around x = 220, y = 314)
  if (minPaintX <= 360 && maxPaintX >= 80) {
    drawRect(132, 266, 176, 114, 0x78350f, 0.38);
    drawRect(156, 278, 128, 86, 0xf97316, 0.14);
    drawRect(184, 294, 72, 48, 0xfacc15, 0.16);
  }

  // 4b. Hall of Eras arcane purple rune ley-lines connecting the 5 obelisks
  if (minPaintX <= 960 && maxPaintX >= 480) {
    drawRect(548, 272, 344, 4, 0xa855f7, 0.55);
    drawRect(634, 366, 172, 4, 0xa855f7, 0.48);
    for (const ex of [548, 634, 720, 806, 892]) {
      const ey = ex === 634 || ex === 806 ? 368 : 274;
      drawRect(ex - 22, ey - 14, 44, 28, 0xa855f7, 0.22);
      drawRect(ex - 16, ey - 10, 32, 20, 0x090d16);
      drawRect(ex - 12, ey - 6, 24, 12, 0xa855f7, 0.45);
    }
  }

  // 4c. Cyber-Forge Relic Vault glowing magma channels & copper floor grates
  if (minPaintX <= 1440 && maxPaintX >= 960) {
    const magmaPulse = 0.75 + Math.sin(elapsedSec * 4.2) * 0.2;
    // Upper and lower molten magma troughs
    drawRect(984, 240, 432, 16, 0x7c2d12);
    drawRect(984, 244, 432, 8, 0xf97316, magmaPulse);
    drawRect(1008, 246, 384, 3, 0xfacc15, magmaPulse);

    drawRect(984, 424, 432, 16, 0x7c2d12);
    drawRect(984, 428, 432, 8, 0xf97316, magmaPulse);
    drawRect(1008, 430, 384, 3, 0xfacc15, magmaPulse);

    // Copper forge pads beneath the 3 relic pedestals
    for (const [rx, ry] of [
      [1060, 286],
      [1200, 366],
      [1340, 286],
    ]) {
      drawRect(rx - 28, ry - 18, 56, 36, 0xea580c, 0.5);
      drawRect(rx - 20, ry - 12, 40, 24, 0x292524);
      drawRect(rx - 14, ry - 8, 28, 16, 0xf97316, 0.35);
    }
  }

  // 4d. Trophy Armory grand gilded hall & crimson runner carpet
  if (minPaintX <= 1920 && maxPaintX >= 1440) {
    drawRect(1480, 286, 400, 62, 0xfacc15, 0.22);
    drawRect(1490, 294, 380, 46, 0x991b1b);
    drawRect(1490, 298, 380, 38, 0xef4444, 0.35);
    drawRect(1490, 294, 380, 4, 0xfacc15);
    drawRect(1490, 336, 380, 4, 0xfacc15);
    // Trophy dais
    drawRect(1636, 266, 88, 60, 0xfacc15, 0.36);
    drawRect(1646, 274, 68, 44, 0x1e1b2e);
    drawRect(1652, 280, 56, 32, 0xfacc15, 0.25);
  }

  // 4e. Mountain Signal Beacon starfield cyan terrace & summit cliff drop
  if (minPaintX <= 2400 && maxPaintX >= 1920) {
    drawRect(2106, 258, 128, 76, 0x06b6d4, 0.22);
    drawRect(2118, 266, 104, 60, 0x090d16);
    drawRect(2124, 272, 92, 48, 0x06b6d4, 0.32);
    // Eastern summit cliff edge at x = 2352..2400
    drawRect(2352, 216, 48, 264, 0x090d16);
    drawRect(2348, 216, 6, 264, 0x67e8f9, 0.65);
  }

  // 5. Biome threshold stone gates at x = 480, 960, 1440, 1920
  for (const borderX of [480, 960, 1440, 1920]) {
    if (borderX + 24 < minPaintX || borderX - 24 > maxPaintX) continue;
    drawRect(borderX - 6, 216, 12, 264, 0x090d16, 0.45);
    drawRect(borderX - 2, 216, 4, 86, 0xfacc15, 0.45);
    drawRect(borderX - 2, 376, 4, 104, 0xfacc15, 0.45);
  }

  // 6. Southern highland cliff embankment (y = 480..540)
  const rimWidth = Math.max(0, (endCol - startCol + 1) * tileSize);
  const rimX = startCol * tileSize;
  if (rimWidth > 0) {
    drawRect(rimX, 478, rimWidth, 6, 0xfacc15, 0.28);
    drawRect(rimX, 484, rimWidth, 56, 0x090d16);
    for (let col = startCol; col <= endCol; col += 2) {
      drawRect(col * tileSize + 4, 492, 16, 28, 0x1e293b, 0.6);
    }
  }
}

/**
 * Paint the complete 2400x540 5-biome SNES RPG tilemap onto a PixiJS v8 `Graphics`
 * object (or construct one via `GraphicsClass` if `pixiGraphics` is null).
 */
export function paintTilemapToGraphics<T extends PixiGraphicsLike>(
  pixiGraphics?: T | null,
  GraphicsClass?: new () => T,
): T {
  const gfx = pixiGraphics ?? (GraphicsClass ? new GraphicsClass() : null);
  if (!gfx) {
    throw new Error('paintTilemapToGraphics requires a Graphics instance or GraphicsClass.');
  }

  gfx.clear?.();
  const drawRect: RectDrawFn = (x, y, w, h, color, alpha = 1) => {
    gfx.rect(x, y, w, h).fill({ color, alpha });
  };

  paintWorldTilemap(drawRect, 0, 0, WORLD_WIDTH);
  debugLog('Painted 5-biome world tilemap to PixiJS Graphics', {
    width: WORLD_WIDTH,
    height: WORLD_HEIGHT,
  });
  return gfx;
}

/**
 * Render the 2400x540 5-biome SNES RPG tilemap directly to a Canvas2D context
 * for zero-WebGPU/WebGL fallback mode. Supports optional viewport clipping.
 */
export function paintTilemapToCanvas2D(
  ctx: CanvasRenderingContext2D,
  elapsedSec = 0,
  viewStartX = 0,
  viewEndX = WORLD_WIDTH,
): void {
  const drawRect: RectDrawFn = (x, y, w, h, color, alpha = 1) => {
    if (alpha <= 0) return;
    const prevAlpha = ctx.globalAlpha;
    if (alpha < 1) ctx.globalAlpha = prevAlpha * alpha;
    ctx.fillStyle = colorToCss(color);
    ctx.fillRect(Math.floor(x), Math.floor(y), Math.ceil(w), Math.ceil(h));
    if (alpha < 1) ctx.globalAlpha = prevAlpha;
  };

  paintWorldTilemap(drawRect, elapsedSec, viewStartX, viewEndX);
}

/**
 * Canvas2D fallback sky painter matching the quantized 28-band day, sunset/amber dusk,
 * and starry night atmosphere of `WGSL_SKY_SHADER`.
 */
export function paintSkyFallbackToCanvas2D(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  dayFactor: number,
  celestialNormX: number,
  celestialNormY: number,
  biomeTintRgb: readonly [number, number, number] = [0.976, 0.451, 0.086],
  elapsedSec = 0,
): void {
  const bands = 24;
  const bandH = Math.ceil(height / bands);
  const clampedDay = Math.max(0, Math.min(1, dayFactor));
  const twilight = Math.pow(Math.sin(clampedDay * Math.PI), 1.25);

  for (let i = 0; i < bands; i += 1) {
    const t = i / (bands - 1);
    const nightR = 9 + t * 18;
    const nightG = 13 + t * 24;
    const nightB = 22 + t * 48;

    const dayR = 29 + t * 78;
    const dayG = 78 + t * 123;
    const dayB = 140 + t * 102;

    let r = nightR + (dayR - nightR) * clampedDay;
    let g = nightG + (dayG - nightG) * clampedDay;
    let b = nightB + (dayB - nightB) * clampedDay;

    // Sunset amber warmth + subtle biome horizon tint
    r = r * (1 - twilight * 0.4) + 249 * twilight * 0.4 + biomeTintRgb[0] * 255 * t * 0.24;
    g = g * (1 - twilight * 0.4) + 115 * twilight * 0.4 + biomeTintRgb[1] * 255 * t * 0.24;
    b = b * (1 - twilight * 0.4) + 22 * twilight * 0.4 + biomeTintRgb[2] * 255 * t * 0.24;

    ctx.fillStyle = `rgb(${Math.min(255, Math.round(r))}, ${Math.min(255, Math.round(g))}, ${Math.min(255, Math.round(b))})`;
    ctx.fillRect(0, i * bandH, width, bandH + 1);
  }

  // Twinkling pixel stars when dark
  if (clampedDay < 0.72) {
    const starAlpha = Math.max(0, 1 - clampedDay * 1.3);
    ctx.fillStyle = `rgba(244, 227, 195, ${starAlpha.toFixed(2)})`;
    for (let s = 0; s < 36; s += 1) {
      const sx = Math.round(((s * 97 + 31) % 100) * 0.01 * width);
      const sy = Math.round(((s * 53 + 17) % 62) * 0.01 * height);
      const twinkle = 0.5 + 0.5 * Math.sin(elapsedSec * 2.4 + s);
      if (twinkle > 0.35) {
        ctx.fillRect(sx, sy, 2, 2);
      }
    }
  }

  // Crisp pixel Sun or Moon disc
  const cx = Math.round(celestialNormX * width);
  const cy = Math.round(celestialNormY * height);
  if (clampedDay >= 0.45) {
    ctx.fillStyle = '#facc15';
    ctx.fillRect(cx - 10, cy - 10, 20, 20);
    ctx.fillStyle = '#F4E3C3';
    ctx.fillRect(cx - 5, cy - 5, 10, 10);
  } else {
    ctx.fillStyle = '#F4E3C3';
    ctx.fillRect(cx - 9, cy - 9, 18, 18);
    ctx.fillStyle = '#090d16';
    ctx.fillRect(cx - 3, cy - 7, 10, 12);
  }
}
