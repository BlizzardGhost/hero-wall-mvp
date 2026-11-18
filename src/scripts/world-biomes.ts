/**
 * Path: src/scripts/world-biomes.ts
 * Purpose: 4 discrete 960x540 room topologies for SPEC-022 (`campfire`, `cyber_chasm`,
 *          `bio_forge`, `signal_beacon`), WGSL/GLSL celestial sky shaders, room
 *          hotspots & portal anchors, solid obstacle collision resolution, and unified
 *          PixiJS v8 Graphics + Canvas2D room backdrop painters (`paintRoomBackdrop`).
 * Spec Reference: SPEC-022 (022-hero-wall-studio-cozy-rebuild)
 *
 * Debug Operator Notes:
 * - Set `window.__RASS_OVERWORLD_DEBUG__ = true` to log room transitions, portal
 *   anchor resolutions, and collision pushouts in DevTools.
 * - Alien rooms (`cyber_chasm`, `bio_forge`, `signal_beacon`) place their Return
 *   Portal at `(130, 375)` and spawn Boris right beside it at `(204, 375)` so
 *   arrival never accidentally re-triggers the return warp on frame 0.
 */

export type RoomId = 'campfire' | 'cyber_chasm' | 'bio_forge' | 'signal_beacon';
export type BiomeId = RoomId;
export type StepSurface = 'grass' | 'stone' | 'metal';

export type HotspotKind =
  | 'campfire'
  | 'shelter'
  | 'companion'
  | 'advisors'
  | 'devil'
  | 'trophy'
  | 'chest'
  | 'portal'
  | 'return_portal'
  | 'era'
  | 'relic'
  | 'beacon';

export type HotspotTargetState =
  | 'DIALOGUE'
  | 'INSPECT_RELIC'
  | 'MIMIC_ROAST'
  | 'PORTAL_WARP';

export interface WalkableBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface WorldHotspot {
  id: string;
  room: RoomId;
  /** Compatibility alias matching `room`. */
  biome: RoomId;
  kind: HotspotKind;
  label: string;
  promptAction: string;
  x: number;
  y: number;
  /** Interaction proximity radius in room pixels. */
  radius: number;
  /** Solid obstacle collision radius in room pixels (0 for pass-through companions/portals). */
  collisionRadius: number;
  targetState: HotspotTargetState;
  /** Optional 0-based index for Hall of Eras (0..4) or Bio-Forge Pods (0..2). */
  itemIndex?: number;
  /** Destination room when `kind === 'portal' || kind === 'return_portal'`. */
  targetRoom?: RoomId;
}

export interface RoomTopology {
  id: RoomId;
  index: number;
  name: string;
  shortLabel: string;
  subtitle: string;
  width: number;
  height: number;
  spawnX: number;
  spawnY: number;
  /** Anchor where the prominent Return Portal sits in alien rooms (`{ x: 130, y: 375 }`). */
  returnPortalAnchor?: { x: number; y: number };
  walkableBounds: WalkableBounds;
  surfaceType: StepSurface;
  primaryHex: string;
  accentHex: string;
  groundHex: string;
  pathHex: string;
  primaryColor: number;
  accentColor: number;
  groundColor: number;
  pathColor: number;
  /** Normalized RGB horizon sky tint (0..1) consumed by WGSL/GLSL sky shaders. */
  skyTintRgb: readonly [number, number, number];
  hotspots: readonly WorldHotspot[];
}

export type BiomeDefinition = RoomTopology;

export interface BiomeAtmosphereSample {
  primary: RoomTopology;
  secondary: RoomTopology;
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

export const ROOM_WIDTH = 960;
export const ROOM_HEIGHT = 540;
export const WORLD_WIDTH = ROOM_WIDTH;
export const WORLD_HEIGHT = ROOM_HEIGHT;
export const HORIZON_Y = 178;

/**
 * Default walkable floor bounds keeping Boris below the northern pine/cliff rim
 * (`y = 222`) and above the southern frame border (`y = 482`).
 */
export const WALKABLE_BOUNDS: Readonly<WalkableBounds> = {
  minX: 48,
  maxX: 912,
  minY: 222,
  maxY: 482,
} as const;

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
 * WGSL dynamic 16-bit sky fragment shader supporting quantized night sky, dusk,
 * daylight, twinkling pixel stars, solar/lunar corona, and room atmosphere tinting.
 */
export const WGSL_SKY_SHADER = `
struct SkyUniforms {
  uSkyState: vec4<f32>,        // x = skyFactor (0=night..1=day), y = timeSec, z = celestialNormX, w = celestialNormY
  uBiomeAtmosphere: vec4<f32>, // rgb = active room tint, w = duskBoost (0..1)
};
@group(2) @binding(0) var<uniform> skyUniforms : SkyUniforms;

@fragment
fn main(@location(0) uv: vec2<f32>) -> @location(0) vec4<f32> {
  let day = clamp(skyUniforms.uSkyState.x, 0.0, 1.0);
  let t = skyUniforms.uSkyState.y;
  let sunPos = skyUniforms.uSkyState.zw;
  let roomTint = skyUniforms.uBiomeAtmosphere.rgb;
  let duskBoost = clamp(skyUniforms.uBiomeAtmosphere.w, 0.0, 1.0);

  // Quantize vertical coordinate into 24 crisp 16-bit sky bands.
  let qY = floor(uv.y * 24.0) / 24.0;

  // Starry night sky (#040c18 -> #0b223d)
  let nightZenith = vec3<f32>(0.016, 0.047, 0.094);
  let nightHorizon = vec3<f32>(0.043, 0.133, 0.239);

  // Daylight sky (#1d4ed8 -> #7dd3fc)
  let dayZenith = vec3<f32>(0.114, 0.306, 0.549);
  let dayHorizon = vec3<f32>(0.420, 0.788, 0.949);

  // Twilight amber dusk (#3b1764 -> #f97316)
  let sunsetZenith = vec3<f32>(0.231, 0.090, 0.392);
  let sunsetHorizon = vec3<f32>(0.976, 0.451, 0.086);

  let twilight = max(pow(sin(day * 3.14159265), 1.25), duskBoost);
  let baseZenith = mix(mix(nightZenith, dayZenith, day), sunsetZenith, twilight * 0.62);
  let baseHorizon = mix(mix(nightHorizon, dayHorizon, day), sunsetHorizon, twilight * 0.75);

  let horizonWithRoom = mix(baseHorizon, roomTint, 0.36);
  var col = mix(baseZenith, horizonWithRoom, pow(qY, 1.15));

  // Celestial halo
  let distToBody = distance(uv, sunPos);
  let halo = smoothstep(0.42, 0.0, distToBody);
  col = col + vec3<f32>(0.980, 0.800, 0.082) * halo * 0.28 * max(day, twilight * 0.6);
  col = col + vec3<f32>(0.220, 0.780, 0.906) * halo * 0.22 * (1.0 - day);

  // Quantized pixel starfield visible during night and dusk
  let starCell = floor(uv * vec2<f32>(80.0, 36.0));
  let starHash = fract(sin(dot(starCell, vec2<f32>(127.1, 311.7))) * 43758.5453);
  let nightVis = clamp(1.0 - day * 1.15, 0.0, 1.0);
  if (starHash > 0.981 && uv.y < 0.72) {
    let twinkle = 0.55 + 0.45 * sin(t * 2.4 + starHash * 41.0);
    col = col + vec3<f32>(0.490, 0.827, 0.988) * nightVis * twinkle * 0.85;
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
  vec3 roomTint = uBiomeAtmosphere.rgb;
  float duskBoost = clamp(uBiomeAtmosphere.w, 0.0, 1.0);

  float qY = floor(vUV.y * 24.0) / 24.0;

  vec3 nightZenith = vec3(0.016, 0.047, 0.094);
  vec3 nightHorizon = vec3(0.043, 0.133, 0.239);
  vec3 dayZenith = vec3(0.114, 0.306, 0.549);
  vec3 dayHorizon = vec3(0.420, 0.788, 0.949);
  vec3 sunsetZenith = vec3(0.231, 0.090, 0.392);
  vec3 sunsetHorizon = vec3(0.976, 0.451, 0.086);

  float twilight = max(pow(sin(day * 3.14159265), 1.25), duskBoost);
  vec3 baseZenith = mix(mix(nightZenith, dayZenith, day), sunsetZenith, twilight * 0.62);
  vec3 baseHorizon = mix(mix(nightHorizon, dayHorizon, day), sunsetHorizon, twilight * 0.75);

  vec3 horizonWithRoom = mix(baseHorizon, roomTint, 0.36);
  vec3 col = mix(baseZenith, horizonWithRoom, pow(qY, 1.15));

  float distToBody = distance(vUV, sunPos);
  float halo = smoothstep(0.42, 0.0, distToBody);
  col += vec3(0.980, 0.800, 0.082) * halo * 0.28 * max(day, twilight * 0.6);
  col += vec3(0.220, 0.780, 0.906) * halo * 0.22 * (1.0 - day);

  vec2 starCell = floor(vUV * vec2(80.0, 36.0));
  float starHash = fract(sin(dot(starCell, vec2(127.1, 311.7))) * 43758.5453);
  float nightVis = clamp(1.0 - day * 1.15, 0.0, 1.0);
  if (starHash > 0.981 && vUV.y < 0.72) {
    float twinkle = 0.55 + 0.45 * sin(t * 2.4 + starHash * 41.0);
    col += vec3(0.490, 0.827, 0.988) * nightVis * twinkle * 0.85;
  }

  fragColor = vec4(col, 1.0);
}
`.trim();

/**
 * Interactive hotspots grouped per discrete 960x540 room.
 */
export const ROOM_HOTSPOTS: Readonly<Record<RoomId, readonly WorldHotspot[]>> = {
  campfire: [
    {
      id: 'campfire',
      room: 'campfire',
      biome: 'campfire',
      kind: 'campfire',
      label: 'Sanctuary Campfire Hearth',
      promptAction: 'Rest by Campfire Hearth',
      x: 480,
      y: 316,
      radius: 66,
      collisionRadius: 24,
      targetState: 'DIALOGUE',
    },
    {
      id: 'shelter',
      room: 'campfire',
      biome: 'campfire',
      kind: 'shelter',
      label: 'Timber Lean-To Shelter',
      promptAction: 'Inspect Shelter & Pot',
      x: 364,
      y: 272,
      radius: 66,
      collisionRadius: 28,
      targetState: 'DIALOGUE',
    },
    {
      id: 'the-dog',
      room: 'campfire',
      biome: 'campfire',
      kind: 'companion',
      label: 'The Dog (Sleeping on Woven Mat)',
      promptAction: 'Pet The Dog [B]',
      x: 414,
      y: 360,
      radius: 56,
      collisionRadius: 0,
      targetState: 'DIALOGUE',
    },
    {
      id: 'rass-terminal',
      room: 'campfire',
      biome: 'campfire',
      kind: 'advisors',
      label: 'RASS · Comms Antenna',
      promptAction: 'Consult RASS Hologram',
      x: 568,
      y: 268,
      radius: 60,
      collisionRadius: 14,
      targetState: 'DIALOGUE',
    },
    {
      id: 'ms-devil',
      room: 'campfire',
      biome: 'campfire',
      kind: 'devil',
      label: 'Ms. Devil · Timber Bench',
      promptAction: 'Speak with Ms. Devil',
      x: 588,
      y: 356,
      radius: 58,
      collisionRadius: 16,
      targetState: 'DIALOGUE',
    },
    {
      id: 'trophy-armory',
      room: 'campfire',
      biome: 'campfire',
      kind: 'trophy',
      label: 'Trophy Armory Lodge (21 Cards)',
      promptAction: 'Inspect Trophy Armory Lodge',
      x: 258,
      y: 392,
      radius: 70,
      collisionRadius: 30,
      targetState: 'INSPECT_RELIC',
    },
    {
      id: 'roast-chest',
      room: 'campfire',
      biome: 'campfire',
      kind: 'chest',
      label: 'Mimic Roast Chest',
      promptAction: 'Open Mimic Roast Chest [R]',
      x: 694,
      y: 404,
      radius: 58,
      collisionRadius: 18,
      targetState: 'MIMIC_ROAST',
    },
    {
      id: 'portal-cyber-chasm',
      room: 'campfire',
      biome: 'campfire',
      kind: 'portal',
      label: 'Portal: Cyber-Chasm (Hall of Eras)',
      promptAction: 'Enter Cyber-Chasm Portal',
      x: 112,
      y: 294,
      radius: 56,
      collisionRadius: 0,
      targetState: 'PORTAL_WARP',
      targetRoom: 'cyber_chasm',
    },
    {
      id: 'portal-bio-forge',
      room: 'campfire',
      biome: 'campfire',
      kind: 'portal',
      label: 'Portal: Bio-Forge Spire (Relic Vault)',
      promptAction: 'Enter Bio-Forge Portal',
      x: 716,
      y: 244,
      radius: 56,
      collisionRadius: 0,
      targetState: 'PORTAL_WARP',
      targetRoom: 'bio_forge',
    },
    {
      id: 'portal-signal-beacon',
      room: 'campfire',
      biome: 'campfire',
      kind: 'portal',
      label: 'Portal: Signal Beacon (High-Orbit)',
      promptAction: 'Enter Signal Beacon Portal',
      x: 848,
      y: 336,
      radius: 56,
      collisionRadius: 0,
      targetState: 'PORTAL_WARP',
      targetRoom: 'signal_beacon',
    },
  ],

  cyber_chasm: [
    {
      id: 'return-cyber-chasm',
      room: 'cyber_chasm',
      biome: 'cyber_chasm',
      kind: 'return_portal',
      label: '⇄ Campfire Sanctuary',
      promptAction: 'Return to Campfire Sanctuary',
      x: 130,
      y: 375,
      radius: 54,
      collisionRadius: 0,
      targetState: 'PORTAL_WARP',
      targetRoom: 'campfire',
    },
    {
      id: 'era-0',
      room: 'cyber_chasm',
      biome: 'cyber_chasm',
      kind: 'era',
      label: 'Obelisk I: Stone Age (2010 - 2013)',
      promptAction: 'Read Stone Age Monolith',
      x: 306,
      y: 280,
      radius: 56,
      collisionRadius: 20,
      targetState: 'INSPECT_RELIC',
      itemIndex: 0,
    },
    {
      id: 'era-1',
      room: 'cyber_chasm',
      biome: 'cyber_chasm',
      kind: 'era',
      label: 'Obelisk II: Steel Age (2014 - 2018)',
      promptAction: 'Read Steel Age Monolith',
      x: 436,
      y: 386,
      radius: 56,
      collisionRadius: 20,
      targetState: 'INSPECT_RELIC',
      itemIndex: 1,
    },
    {
      id: 'era-2',
      room: 'cyber_chasm',
      biome: 'cyber_chasm',
      kind: 'era',
      label: 'Obelisk III: Crystal Age (2019 - 2022)',
      promptAction: 'Read Crystal Age Monolith',
      x: 566,
      y: 280,
      radius: 56,
      collisionRadius: 20,
      targetState: 'INSPECT_RELIC',
      itemIndex: 2,
    },
    {
      id: 'era-3',
      room: 'cyber_chasm',
      biome: 'cyber_chasm',
      kind: 'era',
      label: 'Obelisk IV: Graphene Age (2023 - 2025)',
      promptAction: 'Read Graphene Age Monolith',
      x: 696,
      y: 386,
      radius: 56,
      collisionRadius: 20,
      targetState: 'INSPECT_RELIC',
      itemIndex: 3,
    },
    {
      id: 'era-4',
      room: 'cyber_chasm',
      biome: 'cyber_chasm',
      kind: 'era',
      label: 'Obelisk V: Sovereign Age (2026 - Present)',
      promptAction: 'Read Sovereign Age Monolith',
      x: 826,
      y: 280,
      radius: 56,
      collisionRadius: 20,
      targetState: 'INSPECT_RELIC',
      itemIndex: 4,
    },
  ],

  bio_forge: [
    {
      id: 'return-bio-forge',
      room: 'bio_forge',
      biome: 'bio_forge',
      kind: 'return_portal',
      label: '⇄ Campfire Sanctuary',
      promptAction: 'Return to Campfire Sanctuary',
      x: 130,
      y: 375,
      radius: 54,
      collisionRadius: 0,
      targetState: 'PORTAL_WARP',
      targetRoom: 'campfire',
    },
    {
      id: 'relic-0',
      room: 'bio_forge',
      biome: 'bio_forge',
      kind: 'relic',
      label: 'Containment Pod I: KidsLab 3.0',
      promptAction: 'Inspect KidsLab 3.0 Bio-Pod',
      x: 364,
      y: 294,
      radius: 62,
      collisionRadius: 24,
      targetState: 'INSPECT_RELIC',
      itemIndex: 0,
    },
    {
      id: 'relic-1',
      room: 'bio_forge',
      biome: 'bio_forge',
      kind: 'relic',
      label: 'Containment Pod II: Infusio AI',
      promptAction: 'Inspect Infusio Bio-Pod',
      x: 562,
      y: 378,
      radius: 62,
      collisionRadius: 24,
      targetState: 'INSPECT_RELIC',
      itemIndex: 1,
    },
    {
      id: 'relic-2',
      room: 'bio_forge',
      biome: 'bio_forge',
      kind: 'relic',
      label: 'Containment Pod III: Camp David',
      promptAction: 'Inspect Camp David Bio-Pod',
      x: 760,
      y: 294,
      radius: 62,
      collisionRadius: 24,
      targetState: 'INSPECT_RELIC',
      itemIndex: 2,
    },
  ],

  signal_beacon: [
    {
      id: 'return-signal-beacon',
      room: 'signal_beacon',
      biome: 'signal_beacon',
      kind: 'return_portal',
      label: '⇄ Campfire Sanctuary',
      promptAction: 'Return to Campfire Sanctuary',
      x: 130,
      y: 375,
      radius: 54,
      collisionRadius: 0,
      targetState: 'PORTAL_WARP',
      targetRoom: 'campfire',
    },
    {
      id: 'signal-beacon',
      room: 'signal_beacon',
      biome: 'signal_beacon',
      kind: 'beacon',
      label: 'High-Orbit Radio Observatory Dish',
      promptAction: 'Open Signal Beacon Transceiver',
      x: 636,
      y: 318,
      radius: 76,
      collisionRadius: 28,
      targetState: 'INSPECT_RELIC',
    },
  ],
} as const;

/**
 * Discrete 4-room topologies (`960x540` each) linking the Cozy Campfire Sanctuary
 * to three Techno-Organic Alien Frontiers.
 */
export const ROOM_TOPOLOGIES: Readonly<Record<RoomId, RoomTopology>> = {
  campfire: {
    id: 'campfire',
    index: 0,
    name: 'Campfire Sanctuary',
    shortLabel: 'Campfire',
    subtitle: 'Cozy Clearing, Sleeping Dog, Advisors & 3 Alien Portals',
    width: ROOM_WIDTH,
    height: ROOM_HEIGHT,
    spawnX: 480,
    spawnY: 388,
    walkableBounds: WALKABLE_BOUNDS,
    surfaceType: 'grass',
    primaryHex: '#15803d',
    accentHex: '#f97316',
    groundHex: '#14532d',
    pathHex: '#926239',
    primaryColor: 0x15803d,
    accentColor: 0xf97316,
    groundColor: 0x14532d,
    pathColor: 0x926239,
    skyTintRgb: [0.976, 0.451, 0.086],
    hotspots: ROOM_HOTSPOTS.campfire,
  },
  cyber_chasm: {
    id: 'cyber_chasm',
    index: 1,
    name: 'Cyber-Chasm · Hall of Eras',
    shortLabel: 'Cyber-Chasm',
    subtitle: 'Obsidian Monoliths, Synth Aurora & Circuit Floor',
    width: ROOM_WIDTH,
    height: ROOM_HEIGHT,
    // Spawn directly east of the Return Portal at (130, 375) so Boris never insta-warps on arrival.
    spawnX: 204,
    spawnY: 375,
    returnPortalAnchor: { x: 130, y: 375 },
    walkableBounds: WALKABLE_BOUNDS,
    surfaceType: 'stone',
    primaryHex: '#090d16',
    accentHex: '#a855f7',
    groundHex: '#111827',
    pathHex: '#1e293b',
    primaryColor: 0x090d16,
    accentColor: 0xa855f7,
    groundColor: 0x111827,
    pathColor: 0x1e293b,
    skyTintRgb: [0.659, 0.333, 0.969],
    hotspots: ROOM_HOTSPOTS.cyber_chasm,
  },
  bio_forge: {
    id: 'bio_forge',
    index: 2,
    name: 'Bio-Forge Spire · Relic Vault',
    shortLabel: 'Bio-Forge',
    subtitle: 'Biomech Tendrils, Forge Copper & 3 Containment Pods',
    width: ROOM_WIDTH,
    height: ROOM_HEIGHT,
    spawnX: 204,
    spawnY: 375,
    returnPortalAnchor: { x: 130, y: 375 },
    walkableBounds: WALKABLE_BOUNDS,
    surfaceType: 'metal',
    primaryHex: '#10b981',
    accentHex: '#ea580c',
    groundHex: '#1c1917',
    pathHex: '#431407',
    primaryColor: 0x10b981,
    accentColor: 0xea580c,
    groundColor: 0x1c1917,
    pathColor: 0x431407,
    skyTintRgb: [0.063, 0.725, 0.506],
    hotspots: ROOM_HOTSPOTS.bio_forge,
  },
  signal_beacon: {
    id: 'signal_beacon',
    index: 3,
    name: 'Signal Beacon · High-Orbit Precipice',
    shortLabel: 'Beacon',
    subtitle: 'Floating Asteroid Cliff & Deep-Space Observatory Dish',
    width: ROOM_WIDTH,
    height: ROOM_HEIGHT,
    spawnX: 204,
    spawnY: 375,
    returnPortalAnchor: { x: 130, y: 375 },
    walkableBounds: {
      minX: 48,
      maxX: 874,
      minY: 226,
      maxY: 468,
    },
    surfaceType: 'metal',
    primaryHex: '#06b6d4',
    accentHex: '#38C7E7',
    groundHex: '#082f49',
    pathHex: '#164e63',
    primaryColor: 0x06b6d4,
    accentColor: 0x38c7e7,
    groundColor: 0x082f49,
    pathColor: 0x164e63,
    skyTintRgb: [0.220, 0.780, 0.906],
    hotspots: ROOM_HOTSPOTS.signal_beacon,
  },
} as const;

/** Ordered manifest of all 4 rooms for Town Map, HUD, and iteration. */
export const BIOME_DEFINITIONS: readonly RoomTopology[] = [
  ROOM_TOPOLOGIES.campfire,
  ROOM_TOPOLOGIES.cyber_chasm,
  ROOM_TOPOLOGIES.bio_forge,
  ROOM_TOPOLOGIES.signal_beacon,
] as const;

/** Flattened hotspot list across all 4 rooms. */
export const WORLD_HOTSPOTS: readonly WorldHotspot[] = [
  ...ROOM_HOTSPOTS.campfire,
  ...ROOM_HOTSPOTS.cyber_chasm,
  ...ROOM_HOTSPOTS.bio_forge,
  ...ROOM_HOTSPOTS.signal_beacon,
] as const;

/**
 * Look up a room topology by ID, defaulting to `campfire`.
 */
export function getRoomById(id: RoomId): RoomTopology {
  return ROOM_TOPOLOGIES[id] ?? ROOM_TOPOLOGIES.campfire;
}

/** Compatibility alias matching `getRoomById`. */
export const getBiomeById = getRoomById;

/**
 * Return all hotspots belonging to a discrete room.
 */
export function getHotspotsForRoom(roomId: RoomId): readonly WorldHotspot[] {
  return ROOM_HOTSPOTS[roomId] ?? ROOM_HOTSPOTS.campfire;
}

/**
 * Return room atmosphere metadata for shader tinting.
 */
export function getBiomeAtmosphereForRoom(roomId: RoomId): BiomeAtmosphereSample {
  const room = getRoomById(roomId);
  return {
    primary: room,
    secondary: room,
    blend: 0,
    tintRgb: [room.skyTintRgb[0], room.skyTintRgb[1], room.skyTintRgb[2]],
  };
}

/**
 * Find the closest interactive hotspot inside `roomId` within its interaction radius.
 */
export function findNearestHotspot(
  roomId: RoomId,
  x: number,
  y: number,
  dynamicCoords?: Partial<Record<string, { x: number; y: number }>>,
): { hotspot: WorldHotspot; distance: number } | null {
  const list = getHotspotsForRoom(roomId);
  let bestHotspot: WorldHotspot | null = null;
  let bestDist = Infinity;

  for (const hotspot of list) {
    const pos = dynamicCoords?.[hotspot.id] ?? hotspot;
    const dist = Math.hypot(x - pos.x, y - pos.y);
    if (dist <= hotspot.radius && dist < bestDist) {
      bestHotspot = hotspot;
      bestDist = dist;
    }
  }

  return bestHotspot ? { hotspot: bestHotspot, distance: bestDist } : null;
}

/**
 * Clamp `(x, y)` inside `roomId` walkable bounds and gently push Boris outside
 * solid obstacle collision circles (`collisionRadius > 0`).
 */
export function resolveRoomCollisions(
  roomId: RoomId,
  x: number,
  y: number,
  playerRadius = 14,
): { x: number; y: number } {
  const room = getRoomById(roomId);
  const bounds = room.walkableBounds;
  let nextX = Math.max(bounds.minX, Math.min(bounds.maxX, x));
  let nextY = Math.max(bounds.minY, Math.min(bounds.maxY, y));

  for (const hotspot of room.hotspots) {
    if (hotspot.collisionRadius <= 0) continue;
    const minDist = hotspot.collisionRadius + playerRadius;
    const dx = nextX - hotspot.x;
    const dy = nextY - hotspot.y;
    const dist = Math.hypot(dx, dy);

    if (dist < minDist) {
      const nx = dist > 0.001 ? dx / dist : 0;
      const ny = dist > 0.001 ? dy / dist : 1;
      nextX = hotspot.x + nx * minDist;
      nextY = hotspot.y + ny * minDist;
      debugLog('Resolved solid obstacle pushout', { roomId, id: hotspot.id, nextX, nextY });
    }
  }

  return {
    x: Math.max(bounds.minX, Math.min(bounds.maxX, nextX)),
    y: Math.max(bounds.minY, Math.min(bounds.maxY, nextY)),
  };
}

/** Compatibility alias for collision resolver. */
export const resolveWorldCollisions = resolveRoomCollisions;

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

function tileHash(tx: number, ty: number): number {
  const n = Math.sin(tx * 127.1 + ty * 311.7) * 43758.5453;
  return n - Math.floor(n);
}

function isCanvasContext(
  target: CanvasRenderingContext2D | PixiGraphicsLike,
): target is CanvasRenderingContext2D {
  return typeof (target as CanvasRenderingContext2D).fillRect === 'function';
}

/**
 * Paint stylized sky horizon (stars, night/dusk/day sky bands, glowing cyan
 * spiral/triskelion emblem for Campfire Sanctuary, aurora for Cyber-Chasm,
 * biomechanical ceiling tendrils for Bio-Forge, and exoplanet deep-space vista
 * for Signal Beacon).
 */
function paintRoomSkyLayer(
  drawRect: RectDrawFn,
  room: RoomTopology,
  skyFactor: number,
  timeSec: number,
): void {
  const clampedSky = Math.max(0, Math.min(1, skyFactor));
  const bands = 16;
  const bandH = Math.ceil(HORIZON_Y / bands);

  for (let i = 0; i < bands; i += 1) {
    const t = i / (bands - 1);
    let r = 4 + t * 14;
    let g = 12 + t * 28;
    let b = 24 + t * 44;

    if (room.id === 'cyber_chasm') {
      r = 7 + t * 24;
      g = 8 + t * 14;
      b = 22 + t * 42;
    } else if (room.id === 'bio_forge') {
      r = 10 + t * 26;
      g = 16 + t * 20;
      b = 18 + t * 18;
    } else if (room.id === 'signal_beacon') {
      r = 3 + t * 6;
      g = 7 + t * 18;
      b = 18 + t * 36;
    } else {
      // Campfire Sanctuary responds gracefully to #celestialToggle (night -> dusk -> day).
      const dayR = 29 + t * 76;
      const dayG = 78 + t * 120;
      const dayB = 140 + t * 98;
      const twilight = Math.pow(Math.sin(clampedSky * Math.PI), 1.25);
      r = r + (dayR - r) * clampedSky + twilight * 74 * t;
      g = g + (dayG - g) * clampedSky + twilight * 28 * t;
      b = b + (dayB - b) * clampedSky;
    }

    const packed =
      (Math.min(255, Math.round(r)) << 16) |
      (Math.min(255, Math.round(g)) << 8) |
      Math.min(255, Math.round(b));
    drawRect(0, i * bandH, ROOM_WIDTH, bandH + 1, packed, 1);
  }

  // Twinkling pixel starfield
  const starCount = room.id === 'signal_beacon' ? 68 : 42;
  const starOpacity = room.id === 'campfire' ? Math.max(0.15, 1 - clampedSky * 0.9) : 0.85;
  for (let s = 0; s < starCount; s += 1) {
    const sx = ((s * 137 + 41) % (ROOM_WIDTH - 16)) + 8;
    const sy = ((s * 61 + 13) % (HORIZON_Y - 26)) + 6;
    const twinkle = 0.45 + 0.55 * Math.sin(timeSec * 2.2 + s * 1.7);
    const starColor = s % 3 === 0 ? 0x38c7e7 : s % 5 === 0 ? 0xf4e3c3 : 0x7dd3fc;
    drawRect(sx, sy, s % 4 === 0 ? 3 : 2, s % 4 === 0 ? 3 : 2, starColor, starOpacity * twinkle);
  }

  if (room.id === 'campfire') {
    // Glowing cyan spiral / triskelion sky emblem centered over the Campfire Sanctuary
    const cx = 480;
    const cy = 76;
    const pulse = 0.72 + Math.sin(timeSec * 1.8) * 0.16;

    // Soft radial aura behind triskelion
    drawRect(cx - 84, cy - 52, 168, 104, 0x06b6d4, 0.08 * pulse);
    drawRect(cx - 54, cy - 36, 108, 72, 0x38c7e7, 0.12 * pulse);

    // Three curved pixel spiral lobes arranged around (480, 76)
    for (let arm = 0; arm < 3; arm += 1) {
      const baseAngle = (arm * Math.PI * 2) / 3 - Math.PI / 2 + timeSec * 0.12;
      for (let step = 0; step < 12; step += 1) {
        const radius = 10 + step * 3.8;
        const theta = baseAngle + step * 0.24;
        const px = Math.round(cx + Math.cos(theta) * radius);
        const py = Math.round(cy + Math.sin(theta) * radius * 0.82);
        const size = step < 7 ? 7 : 5;
        drawRect(px - 2, py - 2, size, size, step < 5 ? 0x7dd3fc : 0x38c7e7, 0.72 * pulse);
      }
    }
    // Radiant pixel center rays
    for (let ray = 0; ray < 8; ray += 1) {
      const a = (ray * Math.PI) / 4;
      const rx = Math.round(cx + Math.cos(a) * 58);
      const ry = Math.round(cy + Math.sin(a) * 44);
      drawRect(rx, ry, 3, 3, 0x7dd3fc, 0.45 * pulse);
    }

    // Distant dusk hills
    for (let x = 0; x < ROOM_WIDTH; x += 28) {
      const hillH = 32 + Math.round(((Math.sin(x * 0.015) + 1) * 0.5) * 38);
      drawRect(x, HORIZON_Y - hillH, 30, hillH + 8, 0x0b1d35, 0.96);
      const innerH = 22 + Math.round(((Math.cos(x * 0.022 + 0.8) + 1) * 0.5) * 26);
      drawRect(x, HORIZON_Y - innerH, 30, innerH + 10, 0x112a47, 0.94);
    }
  } else if (room.id === 'cyber_chasm') {
    // Neon purple / cyan synth aurora bands
    for (let x = 0; x < ROOM_WIDTH; x += 16) {
      const waveA = Math.round(Math.sin(x * 0.018 + timeSec * 1.4) * 22);
      const waveB = Math.round(Math.cos(x * 0.024 - timeSec * 1.1) * 16);
      drawRect(x, 54 + waveA, 16, 18, 0xa855f7, 0.32);
      drawRect(x, 62 + waveA, 16, 8, 0x38c7e7, 0.28);
      drawRect(x, 96 + waveB, 16, 12, 0x7dd3fc, 0.22);
    }
    // Obsidian chasm spires
    for (let x = 0; x < ROOM_WIDTH; x += 48) {
      const h = 44 + ((x * 13) % 52);
      drawRect(x + 8, HORIZON_Y - h, 26, h + 16, 0x090d16);
      drawRect(x + 18, HORIZON_Y - h + 10, 4, h - 18, 0xa855f7, 0.65);
    }
  } else if (room.id === 'bio_forge') {
    // Biomechanical rib arches & pulsing neon emerald/copper ceiling tendrils
    for (let x = 36; x < ROOM_WIDTH; x += 96) {
      drawRect(x, 0, 18, HORIZON_Y, 0x1c1917);
      drawRect(x + 4, 0, 4, HORIZON_Y, 0xea580c, 0.45);
      const pulse = 0.55 + 0.4 * Math.sin(timeSec * 3.1 + x * 0.05);
      const tendrilLen = 68 + ((x * 7) % 44);
      drawRect(x + 36, 0, 6, tendrilLen, 0x10b981, 0.72 * pulse);
      drawRect(x + 34, tendrilLen, 10, 10, 0x38c7e7, 0.85 * pulse);
      drawRect(x + 62, 0, 4, tendrilLen - 22, 0xa855f7, 0.55 * pulse);
    }
  } else {
    // High-orbit exo-planet & orbital ring above deep space precipice
    const px = 724;
    const py = 74;
    drawRect(px - 38, py - 38, 76, 76, 0x0e7490, 0.9);
    drawRect(px - 30, py - 30, 60, 60, 0x06b6d4, 0.72);
    drawRect(px - 18, py - 24, 34, 24, 0x38c7e7, 0.55);
    drawRect(px - 56, py - 4, 112, 8, 0x7dd3fc, 0.42);
  }
}

/**
 * Paint room-specific pine silhouettes, terrain tiles, hearth dithering, and
 * portal/monument plinth pads across the 960x540 space.
 */
function paintRoomGroundAndArchitecture(
  drawRect: RectDrawFn,
  room: RoomTopology,
  timeSec: number,
): void {
  const tileSize = 24;

  // 1. Northern room perimeter rim (pine forest in campfire, cavern/cliff rims elsewhere)
  if (room.id === 'campfire') {
    for (let x = 0; x < ROOM_WIDTH; x += 28) {
      // Taller framing pines near west/east borders; clear view of sky emblem at center
      const distFromCenter = Math.abs(x + 14 - ROOM_WIDTH * 0.5);
      const edgeScale = distFromCenter > 220 ? 1.35 : 0.82;
      const treeH = Math.round((44 + ((x * 19) % 34)) * edgeScale);
      const baseY = 210;
      drawRect(x + 10, baseY - 12, 8, 16, 0x3b2110);
      drawRect(x - 2, baseY - Math.round(treeH * 0.45), 32, Math.round(treeH * 0.4), 0x082328);
      drawRect(x + 2, baseY - Math.round(treeH * 0.72), 24, Math.round(treeH * 0.35), 0x0c352f);
      drawRect(x + 7, baseY - treeH, 14, Math.round(treeH * 0.32), 0x134e3a);
      drawRect(x + 11, baseY - treeH - 6, 6, 8, 0x15803d);
    }
  } else if (room.id === 'cyber_chasm') {
    drawRect(0, 178, ROOM_WIDTH, 38, 0x090d16);
    for (let x = 0; x < ROOM_WIDTH; x += 48) {
      drawRect(x + 12, 184, 24, 24, 0x1e293b);
      drawRect(x + 18, 188, 12, 14, 0xa855f7, 0.55);
    }
  } else if (room.id === 'bio_forge') {
    drawRect(0, 178, ROOM_WIDTH, 38, 0x1c1917);
    drawRect(0, 186, ROOM_WIDTH, 6, 0xea580c, 0.8);
    for (let x = 16; x < ROOM_WIDTH; x += 64) {
      drawRect(x, 196, 28, 14, 0x10b981, 0.55);
    }
  } else {
    // Floating asteroid cliff rim overlooking deep space below horizon
    drawRect(0, 186, 876, 30, 0x082f49);
    drawRect(0, 184, 876, 4, 0x38c7e7, 0.65);
  }

  // 2. Ground tiles (y = 216..486)
  for (let col = 0; col < ROOM_WIDTH / tileSize; col += 1) {
    const x = col * tileSize;
    for (let y = 216; y < 486; y += tileSize) {
      if (room.id === 'signal_beacon' && x >= 876) {
        // Deep-space void beyond eastern floating asteroid precipice
        drawRect(x, y, tileSize, tileSize, 0x030712);
        continue;
      }

      const h = tileHash(col, y / tileSize);
      let base = room.groundColor;

      if (room.id === 'campfire') {
        base = h > 0.68 ? 0x166534 : h > 0.32 ? 0x14532d : 0x0f3b26;
      } else if (room.id === 'cyber_chasm') {
        base = (col + y / tileSize) % 2 === 0 ? 0x0f172a : 0x111827;
      } else if (room.id === 'bio_forge') {
        base = h > 0.7 ? 0x292524 : h > 0.35 ? 0x1c1917 : 0x161412;
      } else {
        base = h > 0.65 ? 0x0e7490 : h > 0.3 ? 0x082f49 : 0x090d16;
      }

      drawRect(x, y, tileSize, tileSize, base);

      if (room.id === 'campfire' && h > 0.76) {
        drawRect(x + 6, y + 8, 4, 4, 0x22c55e, 0.55);
        if (h > 0.9) drawRect(x + 14, y + 14, 3, 3, 0xfacc15, 0.7);
      } else if (room.id === 'cyber_chasm') {
        drawRect(x, y, tileSize, 1, 0x1e293b, 0.75);
        drawRect(x, y, 1, tileSize, 0x1e293b, 0.75);
        if (h > 0.78) {
          drawRect(x + 5, y + 11, 14, 2, h > 0.9 ? 0x38c7e7 : 0xa855f7, 0.42);
        }
      } else if (room.id === 'bio_forge') {
        drawRect(x + 1, y + 1, tileSize - 2, 2, 0xea580c, 0.25);
        if (h > 0.82) drawRect(x + 9, y + 9, 5, 5, 0x10b981, 0.42);
      } else if (room.id === 'signal_beacon') {
        drawRect(x + 2, y + 2, tileSize - 4, 1, 0x38c7e7, 0.28);
        if (h > 0.84) drawRect(x + 8, y + 10, 4, 4, 0x7dd3fc, 0.62);
      }
    }
  }

  // 3. Room-specific trails, radial hearth light, portal pads, and precipice cliffs
  if (room.id === 'campfire') {
    // Compacted earth trails radiating from central campfire to portals & Armory Lodge
    drawRect(112, 294, 370, 28, 0x78350f, 0.65);
    drawRect(466, 244, 256, 24, 0x78350f, 0.6);
    drawRect(480, 324, 372, 28, 0x78350f, 0.65);
    drawRect(256, 368, 224, 28, 0x78350f, 0.65);

    // Cozy radial campfire hearth glow & ember dithering around (480, 316)
    const hearthPulse = 0.88 + Math.sin(timeSec * 5.2) * 0.12;
    drawRect(344, 236, 272, 168, 0x78350f, 0.42);
    drawRect(382, 258, 196, 124, 0xf97316, 0.16 * hearthPulse);
    drawRect(422, 278, 116, 82, 0xfacc15, 0.18 * hearthPulse);

    // Perimeter framing trees on lower corners
    for (const [tx, ty] of [
      [34, 434],
      [68, 456],
      [884, 442],
      [918, 418],
    ]) {
      drawRect(tx - 6, ty - 26, 12, 26, 0x3b2110);
      drawRect(tx - 16, ty - 52, 32, 30, 0x0c352f);
      drawRect(tx - 10, ty - 68, 20, 20, 0x134e3a);
    }
  } else if (room.id === 'cyber_chasm') {
    // Circuit ley-lines linking Return Portal -> 5 Obsidian Era Monoliths
    drawRect(130, 372, 570, 4, 0x38c7e7, 0.45);
    drawRect(306, 278, 520, 4, 0xa855f7, 0.55);
    for (const [mx, my] of [
      [306, 280],
      [436, 386],
      [566, 280],
      [696, 386],
      [826, 280],
    ]) {
      drawRect(mx - 24, my - 16, 48, 32, 0xa855f7, 0.24);
      drawRect(mx - 18, my - 12, 36, 24, 0x090d16);
    }
  } else if (room.id === 'bio_forge') {
    const magmaPulse = 0.72 + Math.sin(timeSec * 4.2) * 0.22;
    drawRect(220, 236, 680, 14, 0x7c2d12);
    drawRect(220, 240, 680, 6, 0xf97316, magmaPulse);
    drawRect(220, 438, 680, 14, 0x7c2d12);
    drawRect(220, 442, 680, 6, 0xf97316, magmaPulse);
    for (const [rx, ry] of [
      [364, 294],
      [562, 378],
      [760, 294],
    ]) {
      drawRect(rx - 30, ry - 20, 60, 40, 0x10b981, 0.25);
      drawRect(rx - 22, ry - 14, 44, 28, 0xea580c, 0.38);
    }
  } else {
    // High-orbit asteroid precipice cliff edge & observatory dish pad
    drawRect(872, 216, 8, 270, 0x38c7e7, 0.72);
    drawRect(190, 310, 456, 32, 0x164e63, 0.65);
    drawRect(584, 274, 104, 88, 0x06b6d4, 0.24);
    drawRect(596, 284, 80, 68, 0x090d16);
  }

  // Return Portal golden/cyan pad at (130, 375) in all 3 alien rooms
  if (room.returnPortalAnchor) {
    const { x: rx, y: ry } = room.returnPortalAnchor;
    const glow = 0.72 + Math.sin(timeSec * 3.8) * 0.22;
    drawRect(rx - 28, ry - 20, 56, 40, 0xfacc15, 0.24 * glow);
    drawRect(rx - 20, ry - 14, 40, 28, 0x38c7e7, 0.32 * glow);
  }

  // 4. Southern foreground cliff/frame embankment (y = 486..540)
  drawRect(0, 484, ROOM_WIDTH, 4, room.accentColor, 0.35);
  drawRect(0, 488, ROOM_WIDTH, 52, 0x090d16);
  for (let col = 0; col < ROOM_WIDTH / 48; col += 1) {
    drawRect(col * 48 + 8, 496, 24, 26, 0x1e293b, 0.55);
  }
}

/**
 * Unified room painter accepting either a CanvasRenderingContext2D or PixiJS Graphics.
 * Draws both the room sky/atmosphere layer (`y = 0..178`) and the ground tilemap,
 * pine silhouettes, radial campfire glow, and alien architecture (`y = 178..540`).
 */
export function paintRoomBackdrop(
  ctxOrGraphics: CanvasRenderingContext2D | PixiGraphicsLike,
  roomId: RoomId,
  skyFactor = 0,
  timeSec = 0,
): void {
  const room = getRoomById(roomId);
  let drawRect: RectDrawFn;

  if (isCanvasContext(ctxOrGraphics)) {
    const ctx = ctxOrGraphics;
    drawRect = (x, y, w, h, color, alpha = 1) => {
      if (alpha <= 0) return;
      const prevAlpha = ctx.globalAlpha;
      if (alpha < 1) ctx.globalAlpha = prevAlpha * alpha;
      ctx.fillStyle = colorToCss(color);
      ctx.fillRect(Math.floor(x), Math.floor(y), Math.ceil(w), Math.ceil(h));
      if (alpha < 1) ctx.globalAlpha = prevAlpha;
    };
  } else {
    const gfx = ctxOrGraphics;
    gfx.clear?.();
    drawRect = (x, y, w, h, color, alpha = 1) => {
      gfx.rect(x, y, w, h).fill({ color, alpha });
    };
  }

  paintRoomSkyLayer(drawRect, room, skyFactor, timeSec);
  paintRoomGroundAndArchitecture(drawRect, room, timeSec);
}

/**
 * Paint a discrete room's ground/architecture tilemap onto a PixiJS Graphics instance.
 */
export function paintTilemapToGraphics<T extends PixiGraphicsLike>(
  pixiGraphics?: T | null,
  GraphicsClass?: new () => T,
  roomId: RoomId = 'campfire',
  timeSec = 0,
): T {
  const gfx = pixiGraphics ?? (GraphicsClass ? new GraphicsClass() : null);
  if (!gfx) {
    throw new Error('paintTilemapToGraphics requires a Graphics instance or GraphicsClass.');
  }
  const room = getRoomById(roomId);
  gfx.clear?.();
  paintRoomGroundAndArchitecture(
    (x, y, w, h, color, alpha = 1) => gfx.rect(x, y, w, h).fill({ color, alpha }),
    room,
    timeSec,
  );
  debugLog('Painted room tilemap to PixiJS Graphics', { roomId });
  return gfx;
}

/**
 * Paint a discrete room's ground/architecture tilemap onto a Canvas2D context.
 */
export function paintTilemapToCanvas2D(
  ctx: CanvasRenderingContext2D,
  roomId: RoomId = 'campfire',
  elapsedSec = 0,
): void {
  const room = getRoomById(roomId);
  paintRoomGroundAndArchitecture(
    (x, y, w, h, color, alpha = 1) => {
      if (alpha <= 0) return;
      const prevAlpha = ctx.globalAlpha;
      if (alpha < 1) ctx.globalAlpha = prevAlpha * alpha;
      ctx.fillStyle = colorToCss(color);
      ctx.fillRect(Math.floor(x), Math.floor(y), Math.ceil(w), Math.ceil(h));
      if (alpha < 1) ctx.globalAlpha = prevAlpha;
    },
    room,
    elapsedSec,
  );
}

/**
 * Canvas2D sky fallback painter matching `WGSL_SKY_SHADER` & room sky emblems.
 */
export function paintSkyFallbackToCanvas2D(
  ctx: CanvasRenderingContext2D,
  roomId: RoomId = 'campfire',
  skyFactor = 0,
  elapsedSec = 0,
): void {
  const room = getRoomById(roomId);
  paintRoomSkyLayer(
    (x, y, w, h, color, alpha = 1) => {
      if (alpha <= 0) return;
      const prevAlpha = ctx.globalAlpha;
      if (alpha < 1) ctx.globalAlpha = prevAlpha * alpha;
      ctx.fillStyle = colorToCss(color);
      ctx.fillRect(Math.floor(x), Math.floor(y), Math.ceil(w), Math.ceil(h));
      if (alpha < 1) ctx.globalAlpha = prevAlpha;
    },
    room,
    skyFactor,
    elapsedSec,
  );
}
