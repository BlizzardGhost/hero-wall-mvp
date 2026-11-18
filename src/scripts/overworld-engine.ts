/**
 * Path: src/scripts/overworld-engine.ts
 * Purpose: Core PixiJS v8 WebGPU (with WebGL2 and Canvas2D fallbacks) single-canvas
 *          room-based game engine and 7-state Finite State Machine (`EXPLORING`,
 *          `PORTAL_WARP`, `DIALOGUE`, `START_MENU`, `INSPECT_RELIC`, `CHARACTER_SHEET`,
 *          `MIMIC_ROAST`) for SPEC-022 Hero Wall Studio Cozy Rebuild.
 *          Drives WGSL/GLSL celestial sky rendering, 4 discrete 960x540 rooms
 *          (`campfire`, `cyber_chasm`, `bio_forge`, `signal_beacon`), ambient living
 *          Campfire Trio (`The Dog` sleeping on woven mat, `RASS` hovering by comms
 *          antenna, `Ms. Devil` lounging on bench), solo Boris 4-dir walk + `idleMug`
 *          steaming mug idle, ~550ms 16-bit iris + pixel-dissolve portal warps,
 *          embers/smoke/bioluminescent motes, unified Pokémon [START] menu, contained
 *          SNES dialogue box, Gamepad API, touch GBA deck, and `hw_studio_state_v1`
 *          localStorage persistence.
 * Spec Reference: SPEC-022 (022-hero-wall-studio-cozy-rebuild)
 *
 * Debug Operator Notes:
 * - Set `window.__RASS_OVERWORLD_DEBUG__ = true` to log FSM transitions, room warps,
 *   renderer fallback selection, Gamepad inputs, and hotspot proximity detections.
 * - `#motionToggle` and `#settingMotionBtn` intentionally omit `aria-pressed` per
 *   WCAG 2.2.2 Pause/Play label rules.
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

import {
  BIOME_LIST,
  COMPANION_DRONES,
  CREDITS_SCRIPT,
  HALL_OF_ERAS,
  RELIC_VAULT,
  ROAST_CHEST,
  ROOM_CONFIGS,
  SANCTUARY_CAMPFIRE,
  SIGNAL_BEACON,
  SLEEPING_DOG,
  STUDIO_STORAGE_KEY,
  TROPHY_ARMORY,
  TROPHY_CARDS,
  type GameState,
  type RoomId,
  type SpeakerTag,
} from '../data/game-content';

import {
  SPRITE_PALETTE,
  WORLD_OBJECT_SPRITES,
  createSpriteTextureSet,
  drawMatrixFrame,
  type AlienRoomPortalId,
  type CanvasSourceClassLike,
  type SpriteDirection,
  type SpriteTextureSet,
  type TextureClassLike,
} from './pixel-sprites';

import {
  BIOME_DEFINITIONS,
  GLSL_SKY_FRAGMENT,
  GLSL_SKY_VERTEX,
  HORIZON_Y,
  ROOM_HEIGHT,
  ROOM_HOTSPOTS,
  ROOM_TOPOLOGIES,
  ROOM_WIDTH,
  WGSL_SKY_SHADER,
  WGSL_SKY_VERTEX,
  WORLD_HEIGHT,
  WORLD_HOTSPOTS,
  WORLD_WIDTH,
  findNearestHotspot,
  getBiomeAtmosphereForRoom,
  getHotspotsForRoom,
  getRoomById,
  paintRoomBackdrop,
  paintTilemapToGraphics,
  resolveRoomCollisions,
  type RoomTopology,
  type WorldHotspot,
} from './world-biomes';

import { chiptuneAudio } from './chiptune-audio';

export {
  BIOME_DEFINITIONS,
  ROOM_HEIGHT,
  ROOM_HOTSPOTS,
  ROOM_TOPOLOGIES,
  ROOM_WIDTH,
  STUDIO_STORAGE_KEY,
  WGSL_SKY_SHADER,
  WGSL_SKY_VERTEX,
  WORLD_HEIGHT,
  WORLD_HOTSPOTS,
  WORLD_WIDTH,
};

/** Compatibility alias for consumers referencing room/biome metadata. */
export const OVERWORLD_ZONES = BIOME_DEFINITIONS;

export type CelestialMode = 'auto' | 'day' | 'night';

export interface StudioPersistentState {
  version: 1;
  visitedRooms: RoomId[];
  audioMuted: boolean;
  crackleEnabled: boolean;
  crtScanlines: boolean;
  celestialMode: CelestialMode;
  motionPaused: boolean;
}

interface DialogueChoice {
  label: string;
  onSelect: () => void;
}

interface DialoguePage {
  title: string;
  speaker: SpeakerTag;
  text: string;
  pitchOffsetHz?: number;
  inspectorBuilder?: (container: HTMLElement) => void;
  choices?: DialogueChoice[];
}

interface HeartParticle {
  x: number;
  y: number;
  startY: number;
  age: number;
  sprite?: Sprite;
}

interface AmbientParticle {
  kind: 'ember' | 'smoke' | 'mote';
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: number;
  age: number;
  life: number;
  phase: number;
}

interface WorldSpriteEntry {
  hotspot: WorldHotspot;
  sprite: Sprite;
  ring: Graphics;
  y: number;
}

interface WarpTransitionState {
  targetRoom: RoomId;
  progress: number;
  swapped: boolean;
  originX: number;
  originY: number;
  landingX: number;
  landingY: number;
  onComplete?: () => void;
}

declare global {
  interface Window {
    __RASS_OVERWORLD_DEBUG__?: boolean;
    CharacterDossierTerminal?: {
      open: (tabId?: string) => void;
      close: () => void;
      selectTab: (tabId: string) => void;
    };
    PokemonStartMenuUI?: {
      showSubpanel: (panelId: 'town-map' | 'settings' | 'transmit') => void;
    };
  }
}

const PLAYER_WALK_SPEED_PX = 210;
const TYPEWRITER_CHAR_INTERVAL_SEC = 0.022;
const MORALE_TOAST_DURATION_MS = 3800;
const WARP_DURATION_SEC = 0.56; // ~550ms 16-bit dimensional iris + pixel dissolve
const PORTAL_STEP_RADIUS_PX = 26;
const IDLE_MUG_DELAY_SEC = 0.65;
const MAX_AMBIENT_PARTICLES = 28;
const VALID_ROOMS: readonly RoomId[] = ['campfire', 'cyber_chasm', 'bio_forge', 'signal_beacon'];

/**
 * Emit opt-in debug diagnostics when `window.__RASS_OVERWORLD_DEBUG__` is enabled.
 */
function debugLog(message: string, detail?: unknown): void {
  if (typeof window !== 'undefined' && window.__RASS_OVERWORLD_DEBUG__) {
    console.info(`[OverworldEngine] ${message}`, detail ?? '');
  }
}

/**
 * Return true when a keydown event includes OS/browser modifiers or originates
 * inside an editable form field, preventing shortcut hijacking.
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
 * Compute celestial dayFactor (0 = starry night, 1 = daylight) and Sun/Moon arc
 * coordinates synced to visitor local clock or manual Day/Night override.
 */
function computeCelestialState(
  override: CelestialMode,
  now: Date = new Date(),
): { dayFactor: number; isDaytime: boolean; normX: number; normY: number; duskBoost: number } {
  if (override === 'day') {
    return { dayFactor: 1.0, isDaytime: true, normX: 0.5, normY: 0.22, duskBoost: 0.08 };
  }
  if (override === 'night') {
    return { dayFactor: 0.0, isDaytime: false, normX: 0.5, normY: 0.22, duskBoost: 0.0 };
  }

  const hour = now.getHours() + now.getMinutes() / 60;
  const isDaytime = hour >= 6 && hour < 18;

  let dayFactor = 0.0;
  if (hour >= 7.5 && hour <= 16.5) {
    dayFactor = 1.0;
  } else if (hour >= 5 && hour < 7.5) {
    dayFactor = (hour - 5) / 2.5;
  } else if (hour > 16.5 && hour <= 19) {
    dayFactor = 1 - (hour - 16.5) / 2.5;
  }

  const arcT = isDaytime
    ? (hour - 6) / 12
    : (hour >= 18 ? hour - 18 : hour + 6) / 12;
  const clampedArc = Math.max(0, Math.min(1, arcT));
  const normX = 0.14 + clampedArc * 0.72;
  const normY = 0.34 - Math.sin(clampedArc * Math.PI) * 0.22;
  const duskBoost = Math.sin(dayFactor * Math.PI) * 0.65;

  return { dayFactor, isDaytime, normX, normY, duskBoost };
}

/**
 * Load persisted user settings and visited rooms safely from `hw_studio_state_v1`.
 */
function loadPersistedState(systemReducedMotion: boolean): StudioPersistentState {
  const defaults: StudioPersistentState = {
    version: 1,
    visitedRooms: ['campfire'],
    audioMuted: false,
    crackleEnabled: true,
    crtScanlines: true,
    celestialMode: 'auto',
    motionPaused: systemReducedMotion,
  };

  if (typeof window === 'undefined' || !window.localStorage) {
    return defaults;
  }

  try {
    const raw = window.localStorage.getItem(STUDIO_STORAGE_KEY);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<StudioPersistentState>;
    const visited = Array.isArray(parsed.visitedRooms)
      ? parsed.visitedRooms.filter((r): r is RoomId => VALID_ROOMS.includes(r as RoomId))
      : ['campfire'];
    if (!visited.includes('campfire')) visited.unshift('campfire');

    const celestialMode: CelestialMode =
      parsed.celestialMode === 'day' || parsed.celestialMode === 'night' || parsed.celestialMode === 'auto'
        ? parsed.celestialMode
        : 'auto';

    return {
      version: 1,
      visitedRooms: Array.from(new Set(visited)),
      audioMuted: typeof parsed.audioMuted === 'boolean' ? parsed.audioMuted : defaults.audioMuted,
      crackleEnabled:
        typeof parsed.crackleEnabled === 'boolean' ? parsed.crackleEnabled : defaults.crackleEnabled,
      crtScanlines:
        typeof parsed.crtScanlines === 'boolean' ? parsed.crtScanlines : defaults.crtScanlines,
      celestialMode,
      motionPaused:
        typeof parsed.motionPaused === 'boolean' ? parsed.motionPaused : defaults.motionPaused,
    };
  } catch (err) {
    debugLog('Failed parsing localStorage state; using defaults.', err);
    return defaults;
  }
}

/**
 * Main controller coordinating PixiJS/Canvas2D single-canvas room rendering,
 * ambient Campfire Trio, solo Boris + idleMug animation, 550ms PORTAL_WARP
 * transitions, Pokémon [START] command menu, contained SNES dialogue,
 * Gamepad/Keyboard/Touch input, and `hw_studio_state_v1` persistence.
 */
export class OverworldController {
  private stageRoot: HTMLElement;
  private canvasHost: HTMLElement;
  private fallbackEl: HTMLElement | null;
  private rendererBadge: HTMLElement | null;
  private zoneLabelEl: HTMLElement | null;
  private gameStateBadgeEl: HTMLElement | null;

  // Bezel & Quick Deck controls
  private btnOpenStartMenu: HTMLButtonElement | null;
  private celestialBtn: HTMLButtonElement | null;
  private audioBtn: HTMLButtonElement | null;
  private motionBtn: HTMLButtonElement | null;
  private openDossierBtn: HTMLButtonElement | null;
  private roastTriggerBtn: HTMLButtonElement | null;
  private dogTriggerBtn: HTMLButtonElement | null;
  private btnActionA: HTMLButtonElement | null;
  private btnActionB: HTMLButtonElement | null;
  private btnStartDossier: HTMLButtonElement | null;
  private btnSelectRoast: HTMLButtonElement | null;
  private travelButtons: HTMLButtonElement[] = [];
  private dpadButtons: Record<SpriteDirection, HTMLButtonElement | null>;

  // SnesDialogueBox DOM references
  private dialogueBox: HTMLElement | null;
  private dialogueTitleEl: HTMLElement | null;
  private speakerNameEl: HTMLElement | null;
  private statePillEl: HTMLElement | null;
  private dialogueTextEl: HTMLElement | null;
  private inspectorContentEl: HTMLElement | null;
  private choiceListEl: HTMLElement | null;
  private continueBtn: HTMLButtonElement | null;
  private closeBtn: HTMLButtonElement | null;
  private interactionPromptBtn: HTMLButtonElement | null;
  private interactionPromptLabelEl: HTMLElement | null;
  private moraleToastEl: HTMLElement | null;
  private moraleToastTextEl: HTMLElement | null;
  private moraleToastCloseBtn: HTMLButtonElement | null;
  private liveRegionEl: HTMLElement | null;

  // Pokémon [START] Pause Menu DOM references
  private startMenuEl: HTMLElement | null;
  private startMenuRoomReadoutEl: HTMLElement | null;
  private startMenuResumeBtn: HTMLButtonElement | null;
  private startMenuActionBtns: HTMLButtonElement[] = [];
  private startMenuWarpBtns: HTMLButtonElement[] = [];
  private settingAudioBtn: HTMLButtonElement | null;
  private settingCrackleBtn: HTMLButtonElement | null;
  private settingCrtBtn: HTMLButtonElement | null;
  private settingSkyBtn: HTMLButtonElement | null;
  private settingMotionBtn: HTMLButtonElement | null;

  // Rendering state (PixiJS v8 primary OR Canvas2D fallback)
  private app: Application | null = null;
  private canvas2dEl: HTMLCanvasElement | null = null;
  private canvas2dCtx: CanvasRenderingContext2D | null = null;
  private rafId: number | null = null;
  private lastRafMs = 0;

  private skyMesh: Mesh<MeshGeometry, Shader> | null = null;
  private skyFallbackGfx: Graphics | null = null;
  private skyUniforms: UniformGroup | null = null;
  private sunGfx: Graphics | null = null;
  private moonGfx: Graphics | null = null;
  private worldContainer: Container | null = null;
  private roomSkyDecorGfx: Graphics | null = null;
  private tilemapGfx: Graphics | null = null;
  private dynamicFloorGfx: Graphics | null = null;
  private ambientParticleGfx: Graphics | null = null;
  private entityContainer: Container | null = null;
  private warpOverlayGfx: Graphics | null = null;

  private pixiTextures: SpriteTextureSet<Texture> | null = null;
  private canvasTextures: SpriteTextureSet<HTMLCanvasElement> | null = null;

  private borisSprite: Sprite | null = null;
  private dogSprite: Sprite | null = null;
  private rassSprite: Sprite | null = null;
  private devilSprite: Sprite | null = null;
  private campfireSprite: Sprite | null = null;
  private chestSprite: Sprite | null = null;
  private worldSprites: WorldSpriteEntry[] = [];
  private roomDecorSprites: Sprite[] = [];
  private roomLabelTexts: Text[] = [];

  // Room & Player simulation coordinates (960x540 room space)
  private activeRoom: RoomId = 'campfire';
  private visitedRooms = new Set<RoomId>(['campfire']);
  private borisX = ROOM_CONFIGS.campfire.spawnX;
  private borisY = ROOM_CONFIGS.campfire.spawnY;
  private facing: SpriteDirection = 'down';
  private walkAnimPhase = 0;
  private stationarySec = 0;
  private autoWalkTarget: { x: number; y: number; hotspotId?: string } | null = null;

  // Ambient Campfire Trio anchors (stationary in Campfire Sanctuary; zero conga-line)
  private dogAnchorX = 414;
  private dogAnchorY = 360;
  private dogWakeTimer = 0;
  private rassAnchorX = 568;
  private rassAnchorY = 268;
  private devilAnchorX = 588;
  private devilAnchorY = 356;

  // Viewport transform (letterboxed on desktop; Boris-centered zoom on mobile <= 900px)
  private viewWidth = ROOM_WIDTH;
  private viewHeight = ROOM_HEIGHT;
  private worldScale = 1;
  private worldOffsetX = 0;
  private worldOffsetY = 0;
  private camX = 0;
  private camY = 0;

  // Game FSM, Portal Warp & Dialogue state
  private gameState: GameState = 'EXPLORING';
  private stateBeforeStartMenu: GameState = 'EXPLORING';
  private returnFocusTarget: HTMLElement | null = null;
  private nearestHotspot: WorldHotspot | null = null;
  private warpState: WarpTransitionState | null = null;
  private portalStepCooldown = 0;
  private warpArrivalGuard = false;

  // Preferences & Audio
  private celestialMode: CelestialMode = 'auto';
  private crtScanlines = true;
  private motionPaused = false;
  private tabHiddenPaused = false;
  private elapsedSec = 0;
  private nextCrackleAtSec = 1.1;

  // Dialogue & Inspector cursors
  private dialogueQueue: DialoguePage[] = [];
  private dialoguePageIndex = 0;
  private typewriterFullText = '';
  private typewriterShownChars = 0;
  private typewriterAccumSec = 0;

  private roastIndex = 0;
  private chestOpenTimer = 0;
  private activeEraIndex = 0;
  private activeRelicIndex = 0;
  private activeTrophyIndex = 0;

  private moraleToastTimer: number | null = null;
  private moraleToastPaused = false;
  private heartParticles: HeartParticle[] = [];
  private ambientParticles: AmbientParticle[] = [];

  // Input state (Keyboard, Touch D-Pad, Gamepad API)
  private keysHeld = new Set<string>();
  private dpadHeld = new Set<SpriteDirection>();
  private prevGamepadButtons = new Map<number, boolean[]>();
  private resizeObserver: ResizeObserver | null = null;
  private reducedMotionQuery: MediaQueryList | null = null;
  private cleanups: Array<() => void> = [];

  constructor(stageRoot: HTMLElement) {
    this.stageRoot = stageRoot;
    this.canvasHost =
      stageRoot.querySelector<HTMLElement>('#overworldCanvasHost') || stageRoot;
    this.fallbackEl = stageRoot.querySelector<HTMLElement>('#overworldFallback');
    this.rendererBadge = stageRoot.querySelector<HTMLElement>('#rendererBadge');
    this.zoneLabelEl = stageRoot.querySelector<HTMLElement>('#overworldZoneLabel');
    this.gameStateBadgeEl = stageRoot.querySelector<HTMLElement>('#gameStateBadge');

    this.btnOpenStartMenu = stageRoot.querySelector<HTMLButtonElement>('#btnOpenStartMenu');
    this.celestialBtn = stageRoot.querySelector<HTMLButtonElement>('#celestialToggle');
    this.audioBtn = stageRoot.querySelector<HTMLButtonElement>('#audioToggle');
    this.motionBtn = stageRoot.querySelector<HTMLButtonElement>('#motionToggle');
    this.openDossierBtn = stageRoot.querySelector<HTMLButtonElement>('#btnOpenDossier');
    this.roastTriggerBtn = stageRoot.querySelector<HTMLButtonElement>('#roastChestTrigger');
    this.dogTriggerBtn = stageRoot.querySelector<HTMLButtonElement>('#dogPetTrigger');
    this.btnActionA = stageRoot.querySelector<HTMLButtonElement>('#btnActionA');
    this.btnActionB = stageRoot.querySelector<HTMLButtonElement>('#btnActionB');
    this.btnStartDossier = stageRoot.querySelector<HTMLButtonElement>('#btnStartDossier');
    this.btnSelectRoast = stageRoot.querySelector<HTMLButtonElement>('#btnSelectRoast');

    this.travelButtons = Array.from(
      stageRoot.querySelectorAll<HTMLButtonElement>('[data-travel-zone]'),
    );
    this.dpadButtons = {
      up: stageRoot.querySelector<HTMLButtonElement>('#dpadUp'),
      down: stageRoot.querySelector<HTMLButtonElement>('#dpadDown'),
      left: stageRoot.querySelector<HTMLButtonElement>('#dpadLeft'),
      right: stageRoot.querySelector<HTMLButtonElement>('#dpadRight'),
    };

    // SnesDialogueBox elements live inside `.crt-bezel-frame` / `.overworld-viewport`
    this.dialogueBox = stageRoot.querySelector<HTMLElement>('#snesDialogueBox');
    this.dialogueTitleEl = stageRoot.querySelector<HTMLElement>('#snesDialogueTitle');
    this.speakerNameEl = stageRoot.querySelector<HTMLElement>('#snesSpeakerName');
    this.statePillEl = stageRoot.querySelector<HTMLElement>('#snesStatePill');
    this.dialogueTextEl = stageRoot.querySelector<HTMLElement>('#snesDialogueText');
    this.inspectorContentEl =
      stageRoot.querySelector<HTMLElement>('#snesInspectorContent');
    this.choiceListEl = stageRoot.querySelector<HTMLElement>('#snesChoiceList');
    this.continueBtn = stageRoot.querySelector<HTMLButtonElement>('#snesContinueBtn');
    this.closeBtn = stageRoot.querySelector<HTMLButtonElement>('#snesCloseBtn');
    this.interactionPromptBtn =
      stageRoot.querySelector<HTMLButtonElement>('#interactionPrompt');
    this.interactionPromptLabelEl =
      stageRoot.querySelector<HTMLElement>('#interactionPromptLabel');
    this.moraleToastEl = stageRoot.querySelector<HTMLElement>('#moraleToast');
    this.moraleToastTextEl = stageRoot.querySelector<HTMLElement>('#moraleToastText');
    this.moraleToastCloseBtn =
      stageRoot.querySelector<HTMLButtonElement>('#moraleToastClose');
    this.liveRegionEl = stageRoot.querySelector<HTMLElement>('#overworldLiveRegion');

    // Unified Pokémon [START] Pause Menu elements inside SnesDialogueBox.astro
    this.startMenuEl = stageRoot.querySelector<HTMLElement>('#pokemonStartMenu');
    this.startMenuRoomReadoutEl =
      stageRoot.querySelector<HTMLElement>('#startMenuRoomReadout');
    this.startMenuResumeBtn =
      stageRoot.querySelector<HTMLButtonElement>('#startMenuResumeBtn');
    this.startMenuActionBtns = Array.from(
      stageRoot.querySelectorAll<HTMLButtonElement>('#pokemonStartMenu [data-menu-action]'),
    );
    this.startMenuWarpBtns = Array.from(
      stageRoot.querySelectorAll<HTMLButtonElement>('#pokemonStartMenu [data-warp-room]'),
    );
    this.settingAudioBtn = stageRoot.querySelector<HTMLButtonElement>('#settingAudioBtn');
    this.settingCrackleBtn = stageRoot.querySelector<HTMLButtonElement>('#settingCrackleBtn');
    this.settingCrtBtn = stageRoot.querySelector<HTMLButtonElement>('#settingCrtBtn');
    this.settingSkyBtn = stageRoot.querySelector<HTMLButtonElement>('#settingSkyBtn');
    this.settingMotionBtn = stageRoot.querySelector<HTMLButtonElement>('#settingMotionBtn');
  }

  /**
   * Initialize persisted preferences, input bindings, and PixiJS / Canvas2D stage.
   */
  public async mount(): Promise<void> {
    this.restoreAndBindPreferences();
    this.bindDomControls();
    this.bindStartMenuControls();
    this.bindDpadControls();
    this.bindKeyboardControls();
    this.bindDossierCloseListener();
    this.bindVisibilityLifecycle();

    this.setGameState('EXPLORING');
    this.syncRoomUI(getRoomById(this.activeRoom), false);
    this.syncAllSettingsUI();
    this.seedAmbientParticles(this.activeRoom);

    await this.initRenderer();
    debugLog('OverworldController mounted', {
      room: this.activeRoom,
      viewWidth: this.viewWidth,
      viewHeight: this.viewHeight,
      visitedRooms: Array.from(this.visitedRooms),
      motionPaused: this.motionPaused,
      crtScanlines: this.crtScanlines,
    });
  }

  /**
   * Initialize PixiJS v8 with `preference: 'webgpu'` and `resizeTo: this.canvasHost`,
   * falling back cleanly to WebGL2 and finally native Canvas2D if GPU contexts fail.
   */
  private async initRenderer(): Promise<void> {
    TextureStyle.defaultOptions.scaleMode = 'nearest';
    const rect = this.canvasHost.getBoundingClientRect();
    this.viewWidth = Math.max(260, Math.round(rect.width || ROOM_WIDTH));
    this.viewHeight = Math.max(160, Math.round(rect.height || ROOM_HEIGHT));

    let app: Application | null = null;
    for (const preference of ['webgpu', 'webgl'] as const) {
      try {
        const candidate = new Application();
        await candidate.init({
          preference,
          resizeTo: this.canvasHost,
          backgroundColor: 0x090d16,
          backgroundAlpha: 1,
          antialias: false,
          roundPixels: true,
          resolution: Math.min(window.devicePixelRatio || 1, 2),
          autoDensity: true,
        });
        app = candidate;
        break;
      } catch (err) {
        debugLog(`PixiJS ${preference} init fallback triggered`, err);
      }
    }

    if (!app) {
      this.initCanvas2DFallback();
      return;
    }

    this.app = app;
    const canvas = app.canvas;
    canvas.className = 'overworld-canvas';
    canvas.setAttribute('aria-label', 'Playable 16-bit Campfire Sanctuary & Alien Frontiers canvas');
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.imageRendering = 'pixelated';

    this.canvasHost.appendChild(canvas);
    this.markCanvasMounted();

    const backendName =
      app.renderer.type === RendererType.WEBGPU
        ? 'webgpu'
        : app.renderer.type === RendererType.WEBGL
          ? 'webgl'
          : 'canvas';
    this.updateRendererBadge(backendName);

    this.buildPixiSceneGraph(app);
    this.bindCanvasPointerWalk(canvas);
    this.startResizeObserver();
    this.layoutViewport(this.viewWidth, this.viewHeight);

    app.ticker.add((ticker) => {
      if (this.tabHiddenPaused) return;
      const dtSec = Math.min(0.05, ticker.deltaMS / 1000);
      this.updateSimulation(dtSec);
      this.syncPixiScene();
    });
  }

  /**
   * Native Canvas2D renderer fallback when neither WebGPU nor WebGL2 is available,
   * reusing `paintRoomBackdrop` and `createSpriteTextureSet(null)`.
   */
  private initCanvas2DFallback(): void {
    const canvas = document.createElement('canvas');
    canvas.className = 'overworld-canvas';
    canvas.setAttribute('aria-label', 'Playable 16-bit RPG Overworld Canvas2D stage');
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    canvas.style.imageRendering = 'pixelated';

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      debugLog('Canvas2D context unavailable; keeping accessible static DOM fallback.');
      this.updateRendererBadge('canvas');
      return;
    }

    this.canvas2dEl = canvas;
    this.canvas2dCtx = ctx;
    this.canvasTextures = createSpriteTextureSet(null, { pixelSize: 3 });

    this.canvasHost.appendChild(canvas);
    this.markCanvasMounted();
    this.updateRendererBadge('canvas');
    this.bindCanvasPointerWalk(canvas);
    this.startResizeObserver();
    this.layoutViewport(this.viewWidth, this.viewHeight);

    this.lastRafMs = performance.now();
    const tick = (nowMs: number) => {
      this.rafId = requestAnimationFrame(tick);
      if (this.tabHiddenPaused) {
        this.lastRafMs = nowMs;
        return;
      }
      const dtSec = Math.min(0.05, Math.max(0.001, (nowMs - this.lastRafMs) / 1000));
      this.lastRafMs = nowMs;
      this.updateSimulation(dtSec);
      this.renderCanvas2DFrame();
    };
    this.rafId = requestAnimationFrame(tick);
  }

  private markCanvasMounted(): void {
    this.stageRoot.classList.add('is-mounted');
    if (this.fallbackEl) {
      this.fallbackEl.hidden = true;
    }
  }

  private updateRendererBadge(backend: 'webgpu' | 'webgl' | 'canvas'): void {
    if (!this.rendererBadge) return;
    this.rendererBadge.dataset.backend = backend;
    this.rendererBadge.textContent = backend;
  }

  /**
   * Construct PixiJS v8 sky shader mesh, Sun/Moon graphics, room container,
   * cached 24-color spritesheet textures, and warp transition overlay.
   */
  private buildPixiSceneGraph(app: Application): void {
    const initialCelestial = computeCelestialState(this.celestialMode);
    const initialAtmosphere = getBiomeAtmosphereForRoom(this.activeRoom);

    // 1. Sky backdrop (WGSL/GLSL Shader Mesh + solid Graphics fallback)
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
        uBiomeAtmosphere: {
          value: new Float32Array([
            initialAtmosphere.tintRgb[0],
            initialAtmosphere.tintRgb[1],
            initialAtmosphere.tintRgb[2],
            initialCelestial.duskBoost,
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

      this.skyMesh = new Mesh({ geometry: skyGeometry, shader: skyShader });
      app.stage.addChild(this.skyMesh);
    } catch (err) {
      debugLog('Sky Shader.from bypassed; using Graphics sky bands', err);
      this.skyMesh = null;
    }

    // 2. Pixel Sun & Crescent Moon
    this.sunGfx = new Graphics();
    this.sunGfx.rect(-10, -10, 20, 20).fill(0xfacc15);
    this.sunGfx.rect(-14, -5, 28, 10).fill({ color: 0xf97316, alpha: 0.42 });
    this.sunGfx.rect(-5, -14, 10, 28).fill({ color: 0xf97316, alpha: 0.42 });
    this.sunGfx.rect(-5, -5, 10, 10).fill(0xf4e3c3);
    app.stage.addChild(this.sunGfx);

    this.moonGfx = new Graphics();
    this.moonGfx.rect(-9, -9, 18, 18).fill(0xf4e3c3);
    this.moonGfx.rect(-2, -7, 10, 12).fill(0x090d16);
    this.moonGfx.rect(-13, -3, 3, 3).fill({ color: 0x38c7e7, alpha: 0.85 });
    app.stage.addChild(this.moonGfx);

    // 3. Discrete 960x540 Room Container
    this.worldContainer = new Container();
    app.stage.addChild(this.worldContainer);

    this.roomSkyDecorGfx = new Graphics();
    this.worldContainer.addChild(this.roomSkyDecorGfx);

    this.tilemapGfx = new Graphics();
    this.worldContainer.addChild(this.tilemapGfx);

    this.dynamicFloorGfx = new Graphics();
    this.worldContainer.addChild(this.dynamicFloorGfx);

    this.entityContainer = new Container();
    this.entityContainer.sortableChildren = true;
    this.worldContainer.addChild(this.entityContainer);

    this.ambientParticleGfx = new Graphics();
    this.worldContainer.addChild(this.ambientParticleGfx);

    // 4. Full-stage 16-bit iris + chromatic dissolve overlay for PORTAL_WARP
    this.warpOverlayGfx = new Graphics();
    app.stage.addChild(this.warpOverlayGfx);

    // 5. Bake shared 24-color spritesheet textures once
    this.pixiTextures = createSpriteTextureSet<Texture>(
      Texture as unknown as TextureClassLike<Texture>,
      {
        pixelSize: 3,
        CanvasSourceClass: CanvasSource as unknown as CanvasSourceClassLike,
      },
    );

    this.buildPixiRoomScene(this.activeRoom);
  }

  /**
   * Populate `tilemapGfx` and `entityContainer` cleanly for `roomId` without
   * leaking Text textures or destroying shared spritesheet textures.
   */
  private buildPixiRoomScene(roomId: RoomId): void {
    if (!this.entityContainer || !this.pixiTextures || !this.tilemapGfx) return;

    // Dispose prior room Text label textures cleanly while preserving shared sprite textures.
    for (const txt of this.roomLabelTexts) {
      txt.destroy();
    }
    this.roomLabelTexts = [];

    for (const p of this.heartParticles) {
      p.sprite?.destroy({ children: true, texture: false });
      p.sprite = undefined;
    }

    const removed = this.entityContainer.removeChildren();
    for (const child of removed) {
      child.destroy({ children: true, texture: false });
    }

    this.worldSprites = [];
    this.roomDecorSprites = [];
    this.campfireSprite = null;
    this.chestSprite = null;
    this.dogSprite = null;
    this.rassSprite = null;
    this.devilSprite = null;
    this.borisSprite = null;

    // 1. Paint discrete 960x540 room floor & pine/cavern/cliff rim
    paintTilemapToGraphics(this.tilemapGfx, Graphics, roomId, this.elapsedSec);

    const texSet = this.pixiTextures;
    const parent = this.entityContainer;

    // 2. Decorative grounded props for Campfire Sanctuary trio (woven mat, antenna, bench)
    if (roomId === 'campfire') {
      const matSprite = new Sprite(texSet.worldObjects.wovenMat);
      matSprite.anchor.set(0.5, 0.72);
      matSprite.x = this.dogAnchorX;
      matSprite.y = this.dogAnchorY + 4;
      matSprite.zIndex = Math.round(this.dogAnchorY) - 4;
      parent.addChild(matSprite);
      this.roomDecorSprites.push(matSprite);

      const antennaSprite = new Sprite(texSet.worldObjects.commsAntenna);
      antennaSprite.anchor.set(0.5, 0.88);
      antennaSprite.x = this.rassAnchorX - 22;
      antennaSprite.y = this.rassAnchorY + 4;
      antennaSprite.zIndex = Math.round(this.rassAnchorY) - 3;
      parent.addChild(antennaSprite);
      this.roomDecorSprites.push(antennaSprite);

      const benchSprite = new Sprite(texSet.worldObjects.timberBench);
      benchSprite.anchor.set(0.5, 0.76);
      benchSprite.x = this.devilAnchorX;
      benchSprite.y = this.devilAnchorY + 5;
      benchSprite.zIndex = Math.round(this.devilAnchorY) - 4;
      parent.addChild(benchSprite);
      this.roomDecorSprites.push(benchSprite);
    }

    // 3. Place interactive room hotspots, portals, and ambient Campfire Trio
    const hotspots = getHotspotsForRoom(roomId);
    for (const hotspot of hotspots) {
      const ring = new Graphics();
      ring.x = hotspot.x;
      ring.y = hotspot.y;
      ring.zIndex = Math.round(hotspot.y) - 2;
      parent.addChild(ring);

      const spriteTex = this.resolveHotspotTexture(hotspot, texSet);
      const sprite = new Sprite(spriteTex);
      sprite.anchor.set(0.5, 0.86);
      sprite.x = hotspot.x;
      sprite.y = hotspot.y;
      sprite.zIndex = Math.round(hotspot.y);
      parent.addChild(sprite);

      if (hotspot.kind === 'campfire') this.campfireSprite = sprite;
      if (hotspot.kind === 'chest') this.chestSprite = sprite;
      if (hotspot.kind === 'companion') this.dogSprite = sprite;
      if (hotspot.kind === 'advisors') this.rassSprite = sprite;
      if (hotspot.kind === 'devil') this.devilSprite = sprite;

      const labelTag = new Text({
        text: this.getShortHotspotTag(hotspot),
        style: {
          fontFamily: '"Press Start 2P", monospace',
          fontSize: 7,
          fill: hotspot.kind === 'portal' || hotspot.kind === 'return_portal' ? '#7dd3fc' : '#F4E3C3',
          stroke: { color: '#090d16', width: 3 },
        },
      });
      labelTag.anchor.set(0.5, 1);
      labelTag.x = hotspot.x;
      labelTag.y = hotspot.y - (hotspot.kind === 'shelter' || hotspot.kind === 'trophy' ? 48 : 44);
      labelTag.zIndex = Math.round(hotspot.y) + 6;
      parent.addChild(labelTag);
      this.roomLabelTexts.push(labelTag);

      this.worldSprites.push({ hotspot, sprite, ring, y: hotspot.y });
    }

    // 4. Solo Boris sprite (4-dir walk + idleMug steaming mug idle)
    this.borisSprite = new Sprite(texSet.boris[this.facing][0]);
    this.borisSprite.anchor.set(0.5, 0.88);
    this.borisSprite.x = Math.round(this.borisX);
    this.borisSprite.y = Math.round(this.borisY);
    this.borisSprite.zIndex = Math.round(this.borisY);
    parent.addChild(this.borisSprite);
  }

  private resolveHotspotTexture(
    hotspot: WorldHotspot,
    texSet: SpriteTextureSet<Texture>,
  ): Texture {
    switch (hotspot.kind) {
      case 'campfire':
        return texSet.worldObjects.campfire[0];
      case 'shelter':
        return texSet.worldObjects.shelter;
      case 'companion':
        return texSet.sleepingDog[0];
      case 'advisors':
        return texSet.rassDrone[0];
      case 'devil':
        return texSet.msDevil[0];
      case 'trophy':
        return texSet.worldObjects.armoryLodge;
      case 'chest':
        return texSet.worldObjects.roastChest.closed;
      case 'portal': {
        const roomKey = (hotspot.targetRoom ?? 'cyber_chasm') as AlienRoomPortalId;
        return (texSet.worldObjects.portalByRoom[roomKey] ?? texSet.worldObjects.portalAlien)[0];
      }
      case 'return_portal':
        return texSet.worldObjects.returnPortal[0];
      case 'era':
        return texSet.worldObjects.eraObelisk;
      case 'relic':
        return texSet.worldObjects.bioPod;
      case 'beacon':
        return texSet.worldObjects.beaconDish;
    }
  }

  private getShortHotspotTag(hotspot: WorldHotspot): string {
    if (hotspot.kind === 'campfire') return 'CAMPFIRE';
    if (hotspot.kind === 'shelter') return 'SHELTER';
    if (hotspot.kind === 'companion') return 'THE DOG [B]';
    if (hotspot.kind === 'advisors') return 'RASS';
    if (hotspot.kind === 'devil') return 'MS. DEVIL';
    if (hotspot.kind === 'trophy') return 'ARMORY LODGE';
    if (hotspot.kind === 'chest') return 'CHEST [R]';
    if (hotspot.kind === 'return_portal') return '⇄ CAMPFIRE';
    if (hotspot.kind === 'portal') {
      if (hotspot.targetRoom === 'cyber_chasm') return 'CYBER-CHASM';
      if (hotspot.targetRoom === 'bio_forge') return 'BIO-FORGE';
      return 'BEACON';
    }
    if (hotspot.kind === 'era') return `ERA ${(hotspot.itemIndex ?? 0) + 1}`;
    if (hotspot.kind === 'relic') {
      return hotspot.itemIndex === 0
        ? 'KIDSLAB'
        : hotspot.itemIndex === 1
          ? 'INFUSIO'
          : 'CAMP DAVID';
    }
    if (hotspot.kind === 'beacon') return 'OBSERVATORY';
    return hotspot.label.toUpperCase();
  }

  /**
   * Enable click/tap-to-walk and direct hotspot/companion interaction on the canvas
   * across WebGPU, WebGL2, and Canvas2D using exact viewport-to-room transform math.
   */
  private bindCanvasPointerWalk(canvas: HTMLCanvasElement): void {
    const onPointerDown = (event: PointerEvent) => {
      if (this.gameState !== 'EXPLORING') return;
      if (event.button !== 0 && event.pointerType === 'mouse') return;
      chiptuneAudio.unlock();

      const rect = canvas.getBoundingClientRect();
      const localX = event.clientX - rect.left;
      const localY = event.clientY - rect.top;

      const worldX = (localX - this.worldOffsetX) / this.worldScale + this.camX;
      const worldY = (localY - this.worldOffsetY) / this.worldScale + this.camY;

      const hotspots = getHotspotsForRoom(this.activeRoom);
      for (const hotspot of hotspots) {
        const hitRadius =
          hotspot.kind === 'portal' || hotspot.kind === 'return_portal'
            ? 38
            : Math.max(34, hotspot.radius * 0.62);
        if (Math.hypot(worldX - hotspot.x, worldY - (hotspot.y - 14)) <= hitRadius) {
          this.handleHotspotClick(hotspot);
          return;
        }
      }

      const clamped = resolveRoomCollisions(this.activeRoom, worldX, worldY, 14);
      if (this.motionPaused) {
        this.moveBorisImmediately(clamped.x, clamped.y);
      } else {
        this.autoWalkTarget = { x: clamped.x, y: clamped.y };
      }
      debugLog('Canvas click-to-walk target', { room: this.activeRoom, ...clamped });
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    this.cleanups.push(() => canvas.removeEventListener('pointerdown', onPointerDown));
  }

  private handleHotspotClick(hotspot: WorldHotspot): void {
    if (this.gameState !== 'EXPLORING') return;
    const dist = Math.hypot(this.borisX - hotspot.x, this.borisY - hotspot.y);
    if (dist <= hotspot.radius + 10 || this.motionPaused) {
      if (this.motionPaused && dist > hotspot.radius) {
        const approach = resolveRoomCollisions(
          this.activeRoom,
          hotspot.x,
          hotspot.collisionRadius > 0 ? hotspot.y + hotspot.collisionRadius + 18 : hotspot.y + 8,
          14,
        );
        this.moveBorisImmediately(approach.x, approach.y);
      }
      this.interactWithHotspot(hotspot);
    } else {
      const approach = resolveRoomCollisions(
        this.activeRoom,
        hotspot.x,
        hotspot.collisionRadius > 0 ? hotspot.y + hotspot.collisionRadius + 18 : hotspot.y + 8,
        14,
      );
      this.autoWalkTarget = { x: approach.x, y: approach.y, hotspotId: hotspot.id };
    }
  }

  private startResizeObserver(): void {
    if (typeof ResizeObserver === 'undefined') return;
    this.resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const nextW = Math.max(260, Math.round(entry.contentRect.width));
      const nextH = Math.max(160, Math.round(entry.contentRect.height));
      if (nextW === this.viewWidth && nextH === this.viewHeight) return;
      this.layoutViewport(nextW, nextH);
    });
    this.resizeObserver.observe(this.canvasHost);
  }

  private isMobilePortraitLayout(): boolean {
    const narrowViewport = typeof window !== 'undefined' && window.innerWidth <= 900;
    return narrowViewport || this.viewWidth < this.viewHeight * 1.18;
  }

  private layoutViewport(width: number, height: number): void {
    this.viewWidth = width;
    this.viewHeight = height;

    if (this.isMobilePortraitLayout()) {
      // Mobile portrait: zoom warmly onto the hearth & Boris so thumbs in the 42dvh
      // lower controller deck never obscure Boris, The Dog, or campfire props.
      this.worldScale = Math.max(0.76, Math.min(1.12, height / (ROOM_HEIGHT * 0.86)));
    } else {
      // Desktop CRT: crisp letterboxed 960x540 aspect fit
      this.worldScale = Math.min(width / ROOM_WIDTH, height / ROOM_HEIGHT);
    }

    const scaledW = ROOM_WIDTH * this.worldScale;
    const scaledH = ROOM_HEIGHT * this.worldScale;
    this.worldOffsetX = scaledW <= width ? Math.round((width - scaledW) * 0.5) : 0;
    this.worldOffsetY = scaledH <= height ? Math.round((height - scaledH) * 0.5) : 0;

    if (this.canvas2dEl) {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      this.canvas2dEl.width = Math.round(width * dpr);
      this.canvas2dEl.height = Math.round(height * dpr);
      this.canvas2dCtx?.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    if (this.skyMesh) {
      this.skyMesh.scale.set(width, height);
    }

    if (this.worldContainer) {
      this.worldContainer.scale.set(this.worldScale);
    }

    this.drawPixiSkyFallback(width, height);
    this.snapCameraToBoris();
  }

  private drawPixiSkyFallback(width: number, height: number): void {
    if (!this.skyFallbackGfx) return;
    const { dayFactor } = computeCelestialState(this.celestialMode);
    const effectiveDay = this.activeRoom === 'campfire' ? dayFactor : 0;
    const bands = 14;
    const bandH = Math.ceil(height / bands);
    this.skyFallbackGfx.clear();
    for (let i = 0; i < bands; i += 1) {
      const t = i / (bands - 1);
      const r = Math.round((4 + t * 14) * (1 - effectiveDay) + (29 + t * 76) * effectiveDay);
      const g = Math.round((12 + t * 28) * (1 - effectiveDay) + (78 + t * 120) * effectiveDay);
      const b = Math.round((24 + t * 44) * (1 - effectiveDay) + (140 + t * 98) * effectiveDay);
      this.skyFallbackGfx.rect(0, i * bandH, width, bandH + 1).fill((r << 16) | (g << 8) | b);
    }
  }

  private getDesiredCameraTarget(): { camX: number; camY: number } {
    const visibleW = this.viewWidth / Math.max(0.25, this.worldScale);
    const visibleH = this.viewHeight / Math.max(0.25, this.worldScale);
    const maxCamX = Math.max(0, ROOM_WIDTH - visibleW);
    const maxCamY = Math.max(0, ROOM_HEIGHT - visibleH);

    // Offset slightly upward (-18px) so Boris & campfire props remain comfortably framed.
    const desiredX = maxCamX > 0 ? Math.max(0, Math.min(maxCamX, this.borisX - visibleW * 0.5)) : 0;
    const desiredY =
      maxCamY > 0 ? Math.max(0, Math.min(maxCamY, this.borisY - 18 - visibleH * 0.5)) : 0;
    return { camX: desiredX, camY: desiredY };
  }

  private snapCameraToBoris(): void {
    const { camX, camY } = this.getDesiredCameraTarget();
    this.camX = camX;
    this.camY = camY;
  }

  private moveBorisImmediately(x: number, y: number): void {
    const resolved = resolveRoomCollisions(this.activeRoom, x, y, 14);
    this.borisX = resolved.x;
    this.borisY = resolved.y;
    this.autoWalkTarget = null;
    this.stationarySec = 0;
    this.snapCameraToBoris();
  }

  // ============================================================================
  // Simulation Loop, Movement, Portal Warp, Ambient Juice & Gamepad Polling
  // ============================================================================

  private updateSimulation(dtSec: number): void {
    if (!this.motionPaused) {
      this.elapsedSec += dtSec;
    }

    if (this.portalStepCooldown > 0) {
      this.portalStepCooldown = Math.max(0, this.portalStepCooldown - dtSec);
    }
    if (this.dogWakeTimer > 0) {
      this.dogWakeTimer = Math.max(0, this.dogWakeTimer - dtSec);
    }

    // 1. Poll HTML5 Gamepad API (`navigator.getGamepads()`) across all states
    const gamepadMove = this.pollGamepadInputs();

    // 2. Active 16-bit PORTAL_WARP transition (~550ms iris wipe + pixel dissolve)
    if (this.gameState === 'PORTAL_WARP' && this.warpState) {
      this.updateWarpTransition(dtSec);
    }

    // 3. Movement, Portal step-in, and Hotspot proximity while EXPLORING
    if (this.gameState === 'EXPLORING') {
      this.updatePlayerMovement(dtSec, gamepadMove.x, gamepadMove.y);
      this.updateProximityAndPortalTriggers();
    } else if (this.interactionPromptBtn) {
      this.interactionPromptBtn.hidden = true;
    }

    // 4. Smooth camera tracking around Boris on portrait/zoomed layouts
    const desired = this.getDesiredCameraTarget();
    if (this.motionPaused) {
      this.camX = desired.camX;
      this.camY = desired.camY;
    } else {
      const followAlpha = Math.min(1, dtSec * 8.5);
      this.camX += (desired.camX - this.camX) * followAlpha;
      this.camY += (desired.camY - this.camY) * followAlpha;
    }

    // 5. Chest open timer reset
    if (this.chestOpenTimer > 0) {
      this.chestOpenTimer -= dtSec;
      if (this.chestOpenTimer <= 0 && this.chestSprite && this.pixiTextures) {
        this.chestSprite.texture = this.pixiTextures.worldObjects.roastChest.closed;
      }
    }

    // 6. Heart particles (when waking/petting The Dog)
    for (let i = this.heartParticles.length - 1; i >= 0; i -= 1) {
      const p = this.heartParticles[i];
      p.age += dtSec;
      p.y = p.startY - p.age * 32;
      if (p.sprite) {
        p.sprite.y = p.y;
        p.sprite.alpha = Math.max(0, 1 - p.age / 1.2);
      }
      if (p.age >= 1.2) {
        p.sprite?.destroy({ children: true, texture: false });
        this.heartParticles.splice(i, 1);
      }
    }

    // 7. Ambient fire embers, smoke wisps, campfire crackle SFX, and alien motes
    this.updateAmbientJuice(dtSec);

    // 8. SNES Dialogue typewriter reveal
    this.updateTypewriter(dtSec);
  }

  private updatePlayerMovement(
    dtSec: number,
    gamepadX: number,
    gamepadY: number,
  ): void {
    let moveX =
      (this.keysHeld.has('KeyD') || this.keysHeld.has('ArrowRight') || this.dpadHeld.has('right') ? 1 : 0) -
      (this.keysHeld.has('KeyA') || this.keysHeld.has('ArrowLeft') || this.dpadHeld.has('left') ? 1 : 0) +
      gamepadX;
    let moveY =
      (this.keysHeld.has('KeyS') || this.keysHeld.has('ArrowDown') || this.dpadHeld.has('down') ? 1 : 0) -
      (this.keysHeld.has('KeyW') || this.keysHeld.has('ArrowUp') || this.dpadHeld.has('up') ? 1 : 0) +
      gamepadY;

    if (Math.abs(moveX) > 0.01 || Math.abs(moveY) > 0.01) {
      this.autoWalkTarget = null;
      const len = Math.hypot(moveX, moveY);
      if (len > 1) {
        moveX /= len;
        moveY /= len;
      }
    } else if (this.autoWalkTarget) {
      const dx = this.autoWalkTarget.x - this.borisX;
      const dy = this.autoWalkTarget.y - this.borisY;
      const dist = Math.hypot(dx, dy);
      if (dist <= 8) {
        const pendingHotspotId = this.autoWalkTarget.hotspotId;
        this.autoWalkTarget = null;
        if (pendingHotspotId) {
          const target = getHotspotsForRoom(this.activeRoom).find((h) => h.id === pendingHotspotId);
          if (target) this.interactWithHotspot(target);
        }
        this.walkAnimPhase = 0;
        return;
      }
      moveX = dx / dist;
      moveY = dy / dist;
    } else {
      moveX = 0;
      moveY = 0;
    }

    if (moveX === 0 && moveY === 0) {
      this.walkAnimPhase = 0;
      this.stationarySec += dtSec;
      return;
    }

    this.stationarySec = 0;
    if (Math.abs(moveX) >= Math.abs(moveY)) {
      this.facing = moveX > 0 ? 'right' : 'left';
    } else {
      this.facing = moveY > 0 ? 'down' : 'up';
    }

    const stepDist = PLAYER_WALK_SPEED_PX * dtSec;
    const resolved = resolveRoomCollisions(
      this.activeRoom,
      this.borisX + moveX * stepDist,
      this.borisY + moveY * stepDist,
      14,
    );
    this.borisX = resolved.x;
    this.borisY = resolved.y;
    this.walkAnimPhase = this.motionPaused ? 0 : (this.walkAnimPhase + dtSec * 9.5) % 4;

    const activeSurface = getRoomById(this.activeRoom).surfaceType;
    chiptuneAudio.playStep(activeSurface);
  }

  private updateProximityAndPortalTriggers(): void {
    const result = findNearestHotspot(this.activeRoom, this.borisX, this.borisY);
    const next = result?.hotspot ?? null;

    // Subtle low-frequency portal resonator hum while standing near any portal.
    if (
      next &&
      (next.kind === 'portal' || next.kind === 'return_portal') &&
      result &&
      result.distance <= next.radius + 14
    ) {
      chiptuneAudio.playPortalHum();
    }

    // Clear warp-arrival guard once Boris steps safely away from all portal centers.
    if (this.warpArrivalGuard) {
      const portals = getHotspotsForRoom(this.activeRoom).filter(
        (h) => h.kind === 'portal' || h.kind === 'return_portal',
      );
      const stillInsidePortal = portals.some(
        (p) => Math.hypot(this.borisX - p.x, this.borisY - p.y) <= PORTAL_STEP_RADIUS_PX + 12,
      );
      if (!stillInsidePortal) {
        this.warpArrivalGuard = false;
      }
    }

    // Auto-trigger ~550ms dimensional portal warp when walking onto a portal vortex.
    if (
      next &&
      (next.kind === 'portal' || next.kind === 'return_portal') &&
      result &&
      result.distance <= PORTAL_STEP_RADIUS_PX &&
      this.portalStepCooldown <= 0 &&
      !this.warpArrivalGuard
    ) {
      const targetRoom = next.targetRoom ?? 'campfire';
      this.startPortalWarp(targetRoom, {
        returnFromRoom: next.kind === 'return_portal' ? this.activeRoom : undefined,
      });
      return;
    }

    if (
      next?.id === this.nearestHotspot?.id &&
      this.interactionPromptBtn &&
      this.interactionPromptBtn.hidden === !next
    ) {
      return;
    }

    this.nearestHotspot = next;
    if (this.interactionPromptBtn && this.interactionPromptLabelEl) {
      if (next) {
        this.interactionPromptLabelEl.textContent = next.promptAction;
        this.interactionPromptBtn.hidden = false;
      } else {
        this.interactionPromptBtn.hidden = true;
      }
    }
  }

  /**
   * Initiate the ~550ms 16-bit dimensional warp transition (`PORTAL_WARP`) between
   * rooms, playing `playPortalWarp()` and spawning Boris beside the destination portal.
   */
  public startPortalWarp(
    targetRoom: RoomId,
    options: { returnFromRoom?: RoomId; onComplete?: () => void } = {},
  ): void {
    if (this.gameState === 'PORTAL_WARP') return;

    this.closeStartMenu(false);
    this.closeDialogue(false);

    const cfg = ROOM_CONFIGS[targetRoom] ?? ROOM_CONFIGS.campfire;
    const isReturnToCampfire =
      targetRoom === 'campfire' &&
      options.returnFromRoom &&
      options.returnFromRoom !== 'campfire';

    const landingRawX = isReturnToCampfire
      ? ROOM_CONFIGS[options.returnFromRoom!].returnLandingX
      : cfg.spawnX;
    const landingRawY = isReturnToCampfire
      ? ROOM_CONFIGS[options.returnFromRoom!].returnLandingY
      : cfg.spawnY;
    const safeLanding = resolveRoomCollisions(targetRoom, landingRawX, landingRawY, 14);

    chiptuneAudio.playPortalWarp();

    if (this.motionPaused) {
      this.completeRoomSwap(targetRoom, safeLanding.x, safeLanding.y);
      this.setGameState('EXPLORING');
      options.onComplete?.();
      return;
    }

    this.warpState = {
      targetRoom,
      progress: 0,
      swapped: false,
      originX: this.borisX,
      originY: this.borisY - 12,
      landingX: safeLanding.x,
      landingY: safeLanding.y,
      onComplete: options.onComplete,
    };

    this.setGameState('PORTAL_WARP');
    debugLog('Started PORTAL_WARP transition', {
      from: this.activeRoom,
      to: targetRoom,
      landing: safeLanding,
    });
  }

  private updateWarpTransition(dtSec: number): void {
    const warp = this.warpState;
    if (!warp) return;

    warp.progress = Math.min(1, warp.progress + dtSec / WARP_DURATION_SEC);

    // Midpoint swap: cross the dimensional threshold while iris wipe is closed.
    if (warp.progress >= 0.5 && !warp.swapped) {
      warp.swapped = true;
      this.completeRoomSwap(warp.targetRoom, warp.landingX, warp.landingY);
      warp.originX = this.borisX;
      warp.originY = this.borisY - 12;
    }

    if (warp.progress >= 1) {
      const callback = warp.onComplete;
      this.warpState = null;
      this.warpOverlayGfx?.clear();
      this.setGameState('EXPLORING');
      callback?.();
    }
  }

  private completeRoomSwap(targetRoom: RoomId, spawnX: number, spawnY: number): void {
    this.activeRoom = targetRoom;
    this.borisX = spawnX;
    this.borisY = spawnY;
    this.facing = targetRoom === 'campfire' ? 'down' : 'right';
    this.walkAnimPhase = 0;
    this.stationarySec = 0;
    this.autoWalkTarget = null;
    this.nearestHotspot = null;
    this.portalStepCooldown = 0.7;
    this.warpArrivalGuard = true;

    const wasNewRoom = !this.visitedRooms.has(targetRoom);
    this.visitedRooms.add(targetRoom);
    this.savePersistedState();

    for (const p of this.heartParticles) {
      p.sprite?.destroy({ children: true, texture: false });
    }
    this.heartParticles = [];
    this.ambientParticles = [];
    this.seedAmbientParticles(targetRoom);

    if (this.app) {
      this.buildPixiRoomScene(targetRoom);
    }

    this.snapCameraToBoris();
    this.syncRoomUI(getRoomById(targetRoom), false);
    this.drawPixiSkyFallback(this.viewWidth, this.viewHeight);
    if (wasNewRoom) {
      this.announceStatus(`Entered ${getRoomById(targetRoom).name}`);
    }
  }

  /**
   * Seed and update ambient embers, campfire smoke wisps, crackle bursts, and
   * alien bioluminescent motes capped at MAX_AMBIENT_PARTICLES.
   */
  private seedAmbientParticles(roomId: RoomId): void {
    const count = roomId === 'campfire' ? 18 : 16;
    for (let i = 0; i < count; i += 1) {
      this.ambientParticles.push(this.createAmbientParticle(roomId, true));
    }
  }

  private createAmbientParticle(roomId: RoomId, randomAge = false): AmbientParticle {
    if (roomId === 'campfire') {
      const isSmoke = Math.random() > 0.62;
      const life = isSmoke ? 2.1 + Math.random() * 0.9 : 1.1 + Math.random() * 0.8;
      return {
        kind: isSmoke ? 'smoke' : 'ember',
        x: 480 + (Math.random() - 0.5) * (isSmoke ? 18 : 26),
        y: (isSmoke ? 286 : 302) - (randomAge ? Math.random() * 48 : 0),
        vx: (Math.random() - 0.5) * 14,
        vy: isSmoke ? -(14 + Math.random() * 10) : -(22 + Math.random() * 20),
        size: isSmoke ? 4 : 3,
        color: isSmoke ? 0x94a3b8 : Math.random() > 0.45 ? 0xfacc15 : 0xf97316,
        age: randomAge ? Math.random() * life : 0,
        life,
        phase: Math.random() * Math.PI * 2,
      };
    }

    const life = 2.6 + Math.random() * 1.8;
    const motePalette =
      roomId === 'cyber_chasm'
        ? [0xa855f7, 0x38c7e7, 0xd8b4fe]
        : roomId === 'bio_forge'
          ? [0x10b981, 0xf97316, 0x38c7e7]
          : [0x38c7e7, 0x7dd3fc, 0xf4e3c3];

    return {
      kind: 'mote',
      x: 70 + Math.random() * (ROOM_WIDTH - 140),
      y: 215 + Math.random() * 250,
      vx: (Math.random() - 0.5) * 14,
      vy: -(6 + Math.random() * 10),
      size: Math.random() > 0.65 ? 4 : 3,
      color: motePalette[Math.floor(Math.random() * motePalette.length)],
      age: randomAge ? Math.random() * life : 0,
      life,
      phase: Math.random() * Math.PI * 2,
    };
  }

  private updateAmbientJuice(dtSec: number): void {
    if (this.motionPaused) return;

    // Gentle randomized campfire crackle SFX while resting in Campfire Sanctuary.
    if (this.activeRoom === 'campfire' && this.elapsedSec >= this.nextCrackleAtSec) {
      chiptuneAudio.playCampfireCrackle();
      this.nextCrackleAtSec = this.elapsedSec + 0.9 + Math.random() * 1.4;
    }

    for (let i = 0; i < this.ambientParticles.length; i += 1) {
      const p = this.ambientParticles[i];
      p.age += dtSec;
      p.x += (p.vx + Math.sin(this.elapsedSec * 2.4 + p.phase) * 7) * dtSec;
      p.y += p.vy * dtSec;
      if (p.age >= p.life) {
        this.ambientParticles[i] = this.createAmbientParticle(this.activeRoom, false);
      }
    }

    while (this.ambientParticles.length < MAX_AMBIENT_PARTICLES - 10) {
      this.ambientParticles.push(this.createAmbientParticle(this.activeRoom, false));
    }
  }

  /**
   * Poll connected gamepads via `navigator.getGamepads()` for left-stick / D-pad
   * movement and edge-triggered A/B/X/Y/START actions.
   */
  private pollGamepadInputs(): { x: number; y: number } {
    if (typeof navigator === 'undefined' || typeof navigator.getGamepads !== 'function') {
      return { x: 0, y: 0 };
    }

    const pads = navigator.getGamepads();
    let moveX = 0;
    let moveY = 0;

    for (const pad of pads) {
      if (!pad || !pad.connected) continue;

      const axX = Math.abs(pad.axes[0] ?? 0) > 0.28 ? pad.axes[0] : 0;
      const axY = Math.abs(pad.axes[1] ?? 0) > 0.28 ? pad.axes[1] : 0;
      const dLeft = pad.buttons[14]?.pressed ? -1 : 0;
      const dRight = pad.buttons[15]?.pressed ? 1 : 0;
      const dUp = pad.buttons[12]?.pressed ? -1 : 0;
      const dDown = pad.buttons[13]?.pressed ? 1 : 0;

      moveX += axX || dLeft + dRight;
      moveY += axY || dUp + dDown;

      const prev = this.prevGamepadButtons.get(pad.index) ?? [];
      const curr = pad.buttons.map((b) => Boolean(b.pressed));
      const justPressed = (idx: number) => Boolean(curr[idx] && !prev[idx]);

      if (curr.some(Boolean) || Math.abs(axX) > 0.28 || Math.abs(axY) > 0.28) {
        chiptuneAudio.unlock();
      }

      if (justPressed(9)) {
        // START button toggles [START] command menu (or closes Dossier)
        if (document.querySelector('dialog[open]')) {
          window.CharacterDossierTerminal?.close();
        } else {
          this.toggleStartMenu();
        }
      } else if (justPressed(0)) {
        // A button: Primary interact / advance dialogue
        if (!document.querySelector('dialog[open]')) {
          this.handlePrimaryAction();
        }
      } else if (justPressed(1)) {
        // B button: Pet The Dog when exploring, or close dialogue / Start Menu / Dossier
        if (document.querySelector('dialog[open]')) {
          window.CharacterDossierTerminal?.close();
        } else if (this.gameState === 'START_MENU') {
          this.closeStartMenu(true);
        } else if (this.gameState === 'EXPLORING') {
          this.triggerTheDogEncounter();
        } else {
          this.closeDialogue(true);
        }
      } else if (justPressed(2) || justPressed(8)) {
        // X or SELECT: Mimic Roast Chest
        if (!document.querySelector('dialog[open]')) {
          this.triggerRoastChest();
        }
      } else if (justPressed(3)) {
        // Y button: Character Dossier
        if (document.querySelector('dialog[open]')) {
          window.CharacterDossierTerminal?.close();
        } else {
          this.openCharacterDossier('status');
        }
      }

      this.prevGamepadButtons.set(pad.index, curr);
    }

    return {
      x: Math.max(-1, Math.min(1, moveX)),
      y: Math.max(-1, Math.min(1, moveY)),
    };
  }

  // ============================================================================
  // PixiJS Scene Graph Sync & Canvas2D Fallback Renderer
  // ============================================================================

  private syncPixiScene(): void {
    if (!this.app) return;

    const celestial = computeCelestialState(this.celestialMode);
    const atmosphere = getBiomeAtmosphereForRoom(this.activeRoom);
    const effectiveDay = this.activeRoom === 'campfire' ? celestial.dayFactor : 0;

    if (this.skyUniforms) {
      const skyArr = this.skyUniforms.uniforms.uSkyState as Float32Array;
      skyArr[0] = effectiveDay;
      skyArr[1] = this.elapsedSec;
      skyArr[2] = celestial.normX;
      skyArr[3] = celestial.normY;

      const biomeArr = this.skyUniforms.uniforms.uBiomeAtmosphere as Float32Array;
      biomeArr[0] = atmosphere.tintRgb[0];
      biomeArr[1] = atmosphere.tintRgb[1];
      biomeArr[2] = atmosphere.tintRgb[2];
      biomeArr[3] = this.activeRoom === 'campfire' ? celestial.duskBoost : 0.12;
      this.skyUniforms.update();
    }

    const cx = celestial.normX * this.viewWidth;
    const cy = celestial.normY * this.viewHeight;
    if (this.sunGfx) {
      this.sunGfx.visible = this.activeRoom === 'campfire' && effectiveDay > 0.25;
      this.sunGfx.alpha = Math.min(1, effectiveDay * 1.25);
      this.sunGfx.x = cx;
      this.sunGfx.y = cy;
    }
    if (this.moonGfx) {
      this.moonGfx.visible = this.activeRoom === 'campfire' && effectiveDay < 0.78;
      this.moonGfx.alpha = Math.min(1, (1 - effectiveDay) * 1.15);
      this.moonGfx.x = cx;
      this.moonGfx.y = cy;
    }

    if (this.worldContainer) {
      this.worldContainer.x = Math.round(this.worldOffsetX - this.camX * this.worldScale);
      this.worldContainer.y = Math.round(this.worldOffsetY - this.camY * this.worldScale);
    }

    // Draw room-specific sky emblem (triskelion, synth aurora, tendrils, exoplanet)
    this.drawPixiRoomSkyDecor();

    // Animated radial amber campfire pulse / bio-forge magma shimmer / return portal pad
    if (this.dynamicFloorGfx) {
      this.dynamicFloorGfx.clear();
      const pulse = this.motionPaused ? 0.22 : 0.22 + Math.sin(this.elapsedSec * 5.0) * 0.11;
      if (this.activeRoom === 'campfire') {
        this.dynamicFloorGfx
          .rect(390, 266, 180, 108)
          .fill({ color: 0xf97316, alpha: pulse * 0.55 });
        this.dynamicFloorGfx
          .rect(430, 286, 100, 68)
          .fill({ color: 0xfacc15, alpha: pulse * 0.65 });
      } else if (this.activeRoom === 'bio_forge') {
        this.dynamicFloorGfx.rect(220, 240, 680, 6).fill({ color: 0xfacc15, alpha: pulse });
        this.dynamicFloorGfx.rect(220, 442, 680, 6).fill({ color: 0xfacc15, alpha: pulse });
      }
      const topology = getRoomById(this.activeRoom);
      if (topology.returnPortalAnchor) {
        const { x: rx, y: ry } = topology.returnPortalAnchor;
        this.dynamicFloorGfx
          .rect(rx - 22, ry - 14, 44, 28)
          .fill({ color: 0x38c7e7, alpha: pulse });
      }
    }

    // Ambient particles (campfire embers, smoke wisps, alien bioluminescent motes)
    if (this.ambientParticleGfx) {
      this.ambientParticleGfx.clear();
      for (const p of this.ambientParticles) {
        const t = Math.min(1, p.age / p.life);
        const alpha =
          p.kind === 'mote'
            ? Math.sin(t * Math.PI) * 0.72
            : Math.max(0, (1 - t) * (p.kind === 'smoke' ? 0.3 : 0.9));
        if (alpha <= 0.02) continue;
        this.ambientParticleGfx
          .rect(Math.round(p.x), Math.round(p.y), p.size, p.size)
          .fill({ color: p.color, alpha });
      }
    }

    // Animated sprites & proximity rings
    if (this.pixiTextures) {
      const texSet = this.pixiTextures;

      if (this.campfireSprite) {
        const fireIdx = this.motionPaused ? 0 : Math.floor(this.elapsedSec * 7.5) % texSet.worldObjects.campfire.length;
        this.campfireSprite.texture = texSet.worldObjects.campfire[fireIdx];
      }

      if (this.dogSprite) {
        if (this.dogWakeTimer > 0) {
          const wakeIdx = this.motionPaused ? 0 : Math.floor(this.elapsedSec * 8) % texSet.dogWake.length;
          this.dogSprite.texture = texSet.dogWake[wakeIdx];
        } else {
          // Gentle chest breathing & ear twitch cycle on woven mat
          const sleepIdx = this.motionPaused ? 0 : Math.floor(this.elapsedSec * 2.2) % texSet.sleepingDog.length;
          this.dogSprite.texture = texSet.sleepingDog[sleepIdx];
        }
      }

      if (this.rassSprite) {
        const droneIdx = this.motionPaused ? 0 : Math.floor(this.elapsedSec * 5.5) % texSet.rassDrone.length;
        this.rassSprite.texture = texSet.rassDrone[droneIdx];
        this.rassSprite.y = this.rassAnchorY + (this.motionPaused ? 0 : Math.sin(this.elapsedSec * 3.2) * 3);
      }

      if (this.devilSprite) {
        const devilIdx = this.motionPaused ? 0 : Math.floor(this.elapsedSec * 6) % texSet.msDevil.length;
        this.devilSprite.texture = texSet.msDevil[devilIdx];
      }

      for (const entry of this.worldSprites) {
        const h = entry.hotspot;
        if (h.kind === 'portal') {
          const roomKey = (h.targetRoom ?? 'cyber_chasm') as AlienRoomPortalId;
          const frames = texSet.worldObjects.portalByRoom[roomKey] ?? texSet.worldObjects.portalAlien;
          const pIdx = this.motionPaused ? 0 : Math.floor(this.elapsedSec * 5.5) % frames.length;
          entry.sprite.texture = frames[pIdx];
        } else if (h.kind === 'return_portal') {
          const rIdx = this.motionPaused ? 0 : Math.floor(this.elapsedSec * 5.5) % texSet.worldObjects.returnPortal.length;
          entry.sprite.texture = texSet.worldObjects.returnPortal[rIdx];
        }

        const isActive = this.nearestHotspot?.id === h.id;
        entry.ring.clear();
        if (isActive) {
          const glowAlpha = this.motionPaused ? 0.65 : 0.45 + Math.sin(this.elapsedSec * 6) * 0.25;
          const ringColor = h.kind === 'portal' || h.kind === 'return_portal' ? 0x38c7e7 : 0xfacc15;
          entry.ring.rect(-24, -10, 48, 20).fill({ color: ringColor, alpha: glowAlpha * 0.28 });
          entry.ring.rect(-24, -10, 48, 2).fill({ color: ringColor, alpha: glowAlpha });
          entry.ring.rect(-24, 8, 48, 2).fill({ color: ringColor, alpha: glowAlpha });
        }
      }

      if (this.borisSprite) {
        const useIdleMug =
          this.activeRoom === 'campfire' &&
          this.stationarySec >= IDLE_MUG_DELAY_SEC &&
          texSet.boris.idleMug.length > 0;

        if (useIdleMug) {
          const mugIdx = this.motionPaused ? 0 : Math.floor(this.elapsedSec * 2.2) % texSet.boris.idleMug.length;
          this.borisSprite.texture = texSet.boris.idleMug[mugIdx];
        } else {
          const walkIdx = Math.floor(this.walkAnimPhase) % texSet.boris[this.facing].length;
          this.borisSprite.texture = texSet.boris[this.facing][walkIdx];
        }
        this.borisSprite.x = Math.round(this.borisX);
        this.borisSprite.y = Math.round(this.borisY);
        this.borisSprite.zIndex = Math.round(this.borisY);
      }
    }

    // 16-bit iris + chromatic pixel dissolve overlay during PORTAL_WARP
    if (this.warpOverlayGfx) {
      this.warpOverlayGfx.clear();
      if (this.gameState === 'PORTAL_WARP' && this.warpState) {
        this.drawWarpOverlay((x, y, w, h, color, alpha = 1) => {
          this.warpOverlayGfx!.rect(x, y, w, h).fill({ color, alpha });
        });
      }
    }
  }

  /**
   * Paint the room-specific sky centerpiece (Campfire triskelion sky emblem + dusk hills,
   * Cyber-Chasm synth aurora, Bio-Forge tendrils, Signal Beacon exoplanet) above `skyMesh`.
   */
  private drawPixiRoomSkyDecor(): void {
    const gfx = this.roomSkyDecorGfx;
    if (!gfx) return;
    gfx.clear();

    if (this.activeRoom === 'campfire') {
      const cx = 480;
      const cy = 76;
      const pulse = this.motionPaused ? 0.78 : 0.72 + Math.sin(this.elapsedSec * 1.8) * 0.16;

      gfx.rect(cx - 84, cy - 52, 168, 104).fill({ color: 0x06b6d4, alpha: 0.08 * pulse });
      gfx.rect(cx - 54, cy - 36, 108, 72).fill({ color: 0x38c7e7, alpha: 0.12 * pulse });

      for (let arm = 0; arm < 3; arm += 1) {
        const baseAngle = (arm * Math.PI * 2) / 3 - Math.PI / 2 + (this.motionPaused ? 0 : this.elapsedSec * 0.12);
        for (let step = 0; step < 12; step += 1) {
          const radius = 10 + step * 3.8;
          const theta = baseAngle + step * 0.24;
          const px = Math.round(cx + Math.cos(theta) * radius);
          const py = Math.round(cy + Math.sin(theta) * radius * 0.82);
          const size = step < 7 ? 7 : 5;
          gfx
            .rect(px - 2, py - 2, size, size)
            .fill({ color: step < 5 ? 0x7dd3fc : 0x38c7e7, alpha: 0.72 * pulse });
        }
      }

      for (let x = 0; x < ROOM_WIDTH; x += 28) {
        const hillH = 32 + Math.round(((Math.sin(x * 0.015) + 1) * 0.5) * 38);
        gfx.rect(x, HORIZON_Y - hillH, 30, hillH + 8).fill({ color: 0x0b1d35, alpha: 0.94 });
        const innerH = 22 + Math.round(((Math.cos(x * 0.022 + 0.8) + 1) * 0.5) * 26);
        gfx.rect(x, HORIZON_Y - innerH, 30, innerH + 10).fill({ color: 0x112a47, alpha: 0.92 });
      }
      return;
    }

    if (this.activeRoom === 'cyber_chasm') {
      for (let x = 0; x < ROOM_WIDTH; x += 16) {
        const waveA = Math.round(Math.sin(x * 0.018 + (this.motionPaused ? 0 : this.elapsedSec * 1.4)) * 22);
        const waveB = Math.round(Math.cos(x * 0.024 - (this.motionPaused ? 0 : this.elapsedSec * 1.1)) * 16);
        gfx.rect(x, 54 + waveA, 16, 18).fill({ color: 0xa855f7, alpha: 0.34 });
        gfx.rect(x, 62 + waveA, 16, 8).fill({ color: 0x38c7e7, alpha: 0.3 });
        gfx.rect(x, 96 + waveB, 16, 12).fill({ color: 0x7dd3fc, alpha: 0.22 });
      }
      for (let x = 0; x < ROOM_WIDTH; x += 48) {
        const h = 44 + ((x * 13) % 52);
        gfx.rect(x + 8, HORIZON_Y - h, 26, h + 16).fill(0x090d16);
        gfx.rect(x + 18, HORIZON_Y - h + 10, 4, h - 18).fill({ color: 0xa855f7, alpha: 0.65 });
      }
      return;
    }

    if (this.activeRoom === 'bio_forge') {
      for (let x = 36; x < ROOM_WIDTH; x += 96) {
        gfx.rect(x, 0, 18, HORIZON_Y).fill(0x1c1917);
        gfx.rect(x + 4, 0, 4, HORIZON_Y).fill({ color: 0xea580c, alpha: 0.48 });
        const pulse = this.motionPaused ? 0.75 : 0.55 + 0.4 * Math.sin(this.elapsedSec * 3.1 + x * 0.05);
        const tendrilLen = 68 + ((x * 7) % 44);
        gfx.rect(x + 36, 0, 6, tendrilLen).fill({ color: 0x10b981, alpha: 0.72 * pulse });
        gfx.rect(x + 34, tendrilLen, 10, 10).fill({ color: 0x38c7e7, alpha: 0.85 * pulse });
        gfx.rect(x + 62, 0, 4, tendrilLen - 22).fill({ color: 0xa855f7, alpha: 0.55 * pulse });
      }
      return;
    }

    // Signal Beacon deep-space exoplanet & orbital ring
    const px = 724;
    const py = 74;
    gfx.rect(px - 38, py - 38, 76, 76).fill({ color: 0x0e7490, alpha: 0.9 });
    gfx.rect(px - 30, py - 30, 60, 60).fill({ color: 0x06b6d4, alpha: 0.72 });
    gfx.rect(px - 18, py - 24, 34, 24).fill({ color: 0x38c7e7, alpha: 0.55 });
    gfx.rect(px - 56, py - 4, 112, 8).fill({ color: 0x7dd3fc, alpha: 0.42 });
  }

  /**
   * Software Canvas2D frame renderer mirroring the PixiJS scene graph cleanly.
   */
  private renderCanvas2DFrame(): void {
    const ctx = this.canvas2dCtx;
    if (!ctx || !this.canvasTextures) return;

    const celestial = computeCelestialState(this.celestialMode);
    const skyFactor = this.activeRoom === 'campfire' ? celestial.dayFactor : 0;

    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#050811';
    ctx.fillRect(0, 0, this.viewWidth, this.viewHeight);

    ctx.save();
    ctx.translate(
      Math.round(this.worldOffsetX - this.camX * this.worldScale),
      Math.round(this.worldOffsetY - this.camY * this.worldScale),
    );
    ctx.scale(this.worldScale, this.worldScale);

    // Clip to 960x540 discrete room rectangle for clean CRT letterboxing
    ctx.beginPath();
    ctx.rect(0, 0, ROOM_WIDTH, ROOM_HEIGHT);
    ctx.clip();

    paintRoomBackdrop(ctx, this.activeRoom, skyFactor, this.elapsedSec);

    // Sun / Moon accent in Campfire Sanctuary
    if (this.activeRoom === 'campfire') {
      const sunX = Math.round(celestial.normX * ROOM_WIDTH);
      const sunY = Math.round(celestial.normY * HORIZON_Y);
      if (skyFactor >= 0.45) {
        ctx.fillStyle = '#facc15';
        ctx.fillRect(sunX - 10, sunY - 10, 20, 20);
        ctx.fillStyle = '#F4E3C3';
        ctx.fillRect(sunX - 5, sunY - 5, 10, 10);
      } else {
        ctx.fillStyle = '#F4E3C3';
        ctx.fillRect(sunX - 9, sunY - 9, 18, 18);
        ctx.fillStyle = '#090d16';
        ctx.fillRect(sunX - 3, sunY - 7, 10, 12);
      }
    }

    // Grounded Campfire Trio props (woven mat, antenna, bench)
    const tex = this.canvasTextures;
    if (this.activeRoom === 'campfire') {
      const mat = tex.worldObjects.wovenMat;
      ctx.drawImage(mat, Math.round(this.dogAnchorX - mat.width * 0.5), Math.round(this.dogAnchorY + 4 - mat.height * 0.72));
      const ant = tex.worldObjects.commsAntenna;
      ctx.drawImage(ant, Math.round(this.rassAnchorX - 22 - ant.width * 0.5), Math.round(this.rassAnchorY + 4 - ant.height * 0.88));
      const bench = tex.worldObjects.timberBench;
      ctx.drawImage(bench, Math.round(this.devilAnchorX - bench.width * 0.5), Math.round(this.devilAnchorY + 5 - bench.height * 0.76));
    }

    // Depth-sorted hotspots + ambient trio + solo Boris
    type RenderItem = { y: number; draw: () => void };
    const items: RenderItem[] = [];

    for (const hotspot of getHotspotsForRoom(this.activeRoom)) {
      items.push({
        y: hotspot.y,
        draw: () => {
          if (this.nearestHotspot?.id === hotspot.id) {
            ctx.strokeStyle =
              hotspot.kind === 'portal' || hotspot.kind === 'return_portal' ? '#38C7E7' : '#facc15';
            ctx.lineWidth = 2;
            ctx.strokeRect(hotspot.x - 24, hotspot.y - 10, 48, 20);
          }

          let frame: HTMLCanvasElement;
          let drawY = hotspot.y;
          if (hotspot.kind === 'campfire') {
            const idx = this.motionPaused ? 0 : Math.floor(this.elapsedSec * 7.5) % tex.worldObjects.campfire.length;
            frame = tex.worldObjects.campfire[idx];
          } else if (hotspot.kind === 'shelter') {
            frame = tex.worldObjects.shelter;
          } else if (hotspot.kind === 'companion') {
            frame =
              this.dogWakeTimer > 0
                ? tex.dogWake[this.motionPaused ? 0 : Math.floor(this.elapsedSec * 8) % tex.dogWake.length]
                : tex.sleepingDog[this.motionPaused ? 0 : Math.floor(this.elapsedSec * 2.2) % tex.sleepingDog.length];
          } else if (hotspot.kind === 'advisors') {
            frame = tex.rassDrone[this.motionPaused ? 0 : Math.floor(this.elapsedSec * 5.5) % tex.rassDrone.length];
            drawY += this.motionPaused ? 0 : Math.sin(this.elapsedSec * 3.2) * 3;
          } else if (hotspot.kind === 'devil') {
            frame = tex.msDevil[this.motionPaused ? 0 : Math.floor(this.elapsedSec * 6) % tex.msDevil.length];
          } else if (hotspot.kind === 'trophy') {
            frame = tex.worldObjects.armoryLodge;
          } else if (hotspot.kind === 'chest') {
            frame = this.chestOpenTimer > 0 ? tex.worldObjects.roastChest.open : tex.worldObjects.roastChest.closed;
          } else if (hotspot.kind === 'portal') {
            const roomKey = (hotspot.targetRoom ?? 'cyber_chasm') as AlienRoomPortalId;
            const list = tex.worldObjects.portalByRoom[roomKey] ?? tex.worldObjects.portalAlien;
            frame = list[this.motionPaused ? 0 : Math.floor(this.elapsedSec * 5.5) % list.length];
          } else if (hotspot.kind === 'return_portal') {
            frame = tex.worldObjects.returnPortal[this.motionPaused ? 0 : Math.floor(this.elapsedSec * 5.5) % tex.worldObjects.returnPortal.length];
          } else if (hotspot.kind === 'era') {
            frame = tex.worldObjects.eraObelisk;
          } else if (hotspot.kind === 'relic') {
            frame = tex.worldObjects.bioPod;
          } else {
            frame = tex.worldObjects.beaconDish;
          }

          ctx.drawImage(frame, Math.round(hotspot.x - frame.width * 0.5), Math.round(drawY - frame.height * 0.86));
        },
      });
    }

    const useIdleMug =
      this.activeRoom === 'campfire' &&
      this.stationarySec >= IDLE_MUG_DELAY_SEC &&
      tex.boris.idleMug.length > 0;
    const borisFrame = useIdleMug
      ? tex.boris.idleMug[this.motionPaused ? 0 : Math.floor(this.elapsedSec * 2.2) % tex.boris.idleMug.length]
      : tex.boris[this.facing][Math.floor(this.walkAnimPhase) % tex.boris[this.facing].length];

    items.push({
      y: this.borisY,
      draw: () => {
        ctx.drawImage(
          borisFrame,
          Math.round(this.borisX - borisFrame.width * 0.5),
          Math.round(this.borisY - borisFrame.height * 0.88),
        );
      },
    });

    items.sort((a, b) => a.y - b.y);
    for (const item of items) item.draw();

    // Ambient embers, smoke wisps, and alien bioluminescent motes
    for (const p of this.ambientParticles) {
      const t = Math.min(1, p.age / p.life);
      const alpha =
        p.kind === 'mote'
          ? Math.sin(t * Math.PI) * 0.72
          : Math.max(0, (1 - t) * (p.kind === 'smoke' ? 0.3 : 0.9));
      if (alpha <= 0.02) continue;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = `#${p.color.toString(16).padStart(6, '0')}`;
      ctx.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
      ctx.restore();
    }

    // Floating heart particles when petting The Dog
    for (const p of this.heartParticles) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - p.age / 1.2);
      drawMatrixFrame(ctx, WORLD_OBJECT_SPRITES.heart, SPRITE_PALETTE, p.x - 12, p.y - 24, 2);
      ctx.restore();
    }

    ctx.restore();

    // 16-bit iris + chromatic pixel dissolve overlay during PORTAL_WARP
    if (this.gameState === 'PORTAL_WARP' && this.warpState) {
      this.drawWarpOverlay((x, y, w, h, color, alpha = 1) => {
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.fillStyle = `#${color.toString(16).padStart(6, '0')}`;
        ctx.fillRect(Math.round(x), Math.round(y), Math.ceil(w), Math.ceil(h));
        ctx.restore();
      });
    }
  }

  /**
   * Shared quantized 16-bit iris wipe + chromatic pixel dissolve renderer used by
   * both PixiJS Graphics and Canvas2D during the ~550ms `PORTAL_WARP` transition.
   */
  private drawWarpOverlay(
    drawRect: (x: number, y: number, w: number, h: number, color: number, alpha?: number) => void,
  ): void {
    const warp = this.warpState;
    if (!warp) return;

    const irisClose = warp.progress < 0.5 ? warp.progress * 2 : (1 - warp.progress) * 2;
    const centerX = Math.round(this.worldOffsetX + (warp.originX - this.camX) * this.worldScale);
    const centerY = Math.round(this.worldOffsetY + (warp.originY - this.camY) * this.worldScale);
    const maxRadius = Math.hypot(this.viewWidth, this.viewHeight);
    const openRadius = Math.max(0, maxRadius * (1 - Math.pow(irisClose, 0.85)));

    const stripH = 8;
    const rimPalette = [0x38c7e7, 0xa855f7, 0xfacc15];

    for (let sy = 0; sy < this.viewHeight; sy += stripH) {
      const dy = sy + stripH * 0.5 - centerY;
      if (Math.abs(dy) >= openRadius) {
        drawRect(0, sy, this.viewWidth, stripH, 0x090d16, 1);
        continue;
      }

      const halfChord = Math.floor(Math.sqrt(openRadius * openRadius - dy * dy) / 8) * 8;
      const leftEdge = Math.max(0, centerX - halfChord);
      const rightEdge = Math.min(this.viewWidth, centerX + halfChord);

      if (leftEdge > 0) {
        drawRect(0, sy, leftEdge, stripH, 0x090d16, 1);
      }
      if (rightEdge < this.viewWidth) {
        drawRect(rightEdge, sy, this.viewWidth - rightEdge, stripH, 0x090d16, 1);
      }

      const rimColor = rimPalette[Math.floor(sy / stripH) % rimPalette.length];
      if (leftEdge > 0 && leftEdge < this.viewWidth) {
        drawRect(leftEdge, sy, 6, stripH, rimColor, 0.85);
      }
      if (rightEdge > 6 && rightEdge < this.viewWidth) {
        drawRect(rightEdge - 6, sy, 6, stripH, rimColor, 0.85);
      }
    }

    // Quantized chromatic pixel dissolve sparks around the warp aperture
    for (let s = 0; s < 18; s += 1) {
      const angle = (s * Math.PI * 2) / 18 + warp.progress * 7;
      const r = Math.max(14, openRadius + ((s % 3) - 1) * 14);
      const px = Math.round((centerX + Math.cos(angle) * r) / 8) * 8;
      const py = Math.round((centerY + Math.sin(angle) * r) / 8) * 8;
      drawRect(px, py, 8, 8, rimPalette[s % rimPalette.length], 0.88);
    }
  }

  // ============================================================================
  // 7-State FSM, Pokémon [START] Menu, Dialogue Chunks & Inspectors
  // ============================================================================

  private setGameState(nextState: GameState): void {
    const prevState = this.gameState;
    this.gameState = nextState;
    document.documentElement.dataset.gameState = nextState;

    if (nextState !== 'EXPLORING') {
      this.keysHeld.clear();
      this.dpadHeld.clear();
      this.autoWalkTarget = null;
      this.walkAnimPhase = 0;
    }

    if (this.gameStateBadgeEl) {
      this.gameStateBadgeEl.textContent = nextState;
    }
    if (this.statePillEl) {
      this.statePillEl.textContent = nextState;
    }

    const showDialogueOverlay =
      nextState === 'DIALOGUE' ||
      nextState === 'INSPECT_RELIC' ||
      nextState === 'MIMIC_ROAST';

    if (this.dialogueBox) {
      this.dialogueBox.hidden = !showDialogueOverlay;
    }
    if (this.startMenuEl) {
      this.startMenuEl.hidden = nextState !== 'START_MENU';
    }
    if (this.btnOpenStartMenu) {
      this.btnOpenStartMenu.setAttribute('aria-expanded', String(nextState === 'START_MENU'));
    }
    if (this.interactionPromptBtn) {
      this.interactionPromptBtn.hidden =
        nextState !== 'EXPLORING' || !this.nearestHotspot;
    }

    if (prevState !== nextState) {
      debugLog('FSM state transition', { from: prevState, to: nextState, room: this.activeRoom });
    }
  }

  /**
   * Open or close the unified Pokémon `[START]` pause menu (`START_MENU` state).
   */
  public toggleStartMenu(forceOpen?: boolean): void {
    if (this.gameState === 'PORTAL_WARP') return;
    const shouldOpen = forceOpen ?? this.gameState !== 'START_MENU';
    if (shouldOpen) {
      this.openStartMenu();
    } else {
      this.closeStartMenu(true);
    }
  }

  public openStartMenu(): void {
    if (this.gameState === 'START_MENU' || this.gameState === 'PORTAL_WARP') return;
    if (document.querySelector('dialog[open]')) return;

    this.stateBeforeStartMenu = this.gameState === 'CHARACTER_SHEET' ? 'EXPLORING' : this.gameState;
    this.returnFocusTarget = document.activeElement as HTMLElement | null;

    chiptuneAudio.playMenuBlip();
    this.syncRoomUI(getRoomById(this.activeRoom), false);
    this.syncAllSettingsUI();
    this.setGameState('START_MENU');

    requestAnimationFrame(() => {
      const firstCmd = this.startMenuEl?.querySelector<HTMLButtonElement>('[data-menu-action]');
      firstCmd?.focus({ preventScroll: true });
    });
  }

  public closeStartMenu(playCancelAudio = true): void {
    if (this.gameState !== 'START_MENU') return;
    if (playCancelAudio) chiptuneAudio.playCancel();

    const restoreTo =
      this.stateBeforeStartMenu === 'DIALOGUE' ||
      this.stateBeforeStartMenu === 'INSPECT_RELIC' ||
      this.stateBeforeStartMenu === 'MIMIC_ROAST'
        ? this.stateBeforeStartMenu
        : 'EXPLORING';
    this.setGameState(restoreTo);

    if (this.returnFocusTarget && this.returnFocusTarget.isConnected) {
      this.returnFocusTarget.focus({ preventScroll: true });
    }
    this.returnFocusTarget = null;
  }

  private openDialoguePages(state: GameState, pages: DialoguePage[]): void {
    if (pages.length === 0) return;
    this.dialogueQueue = pages;
    this.dialoguePageIndex = 0;
    this.setGameState(state);
    this.renderCurrentDialoguePage();
  }

  private renderCurrentDialoguePage(): void {
    const page = this.dialogueQueue[this.dialoguePageIndex];
    if (!page) {
      this.closeDialogue(false);
      return;
    }

    if (this.dialogueBox) {
      this.dialogueBox.dataset.speaker = page.speaker;
    }
    if (this.dialogueTitleEl) this.dialogueTitleEl.textContent = page.title;
    if (this.speakerNameEl) this.speakerNameEl.textContent = page.speaker;

    this.typewriterFullText = page.text;
    this.typewriterAccumSec = 0;
    this.typewriterShownChars = this.motionPaused ? page.text.length : 0;

    if (this.dialogueTextEl) {
      this.dialogueTextEl.textContent = this.motionPaused ? page.text : '';
    }

    if (this.inspectorContentEl) {
      this.inspectorContentEl.replaceChildren();
      if (page.inspectorBuilder) {
        page.inspectorBuilder(this.inspectorContentEl);
        this.inspectorContentEl.hidden = false;
      } else {
        this.inspectorContentEl.hidden = true;
      }
    }

    if (this.choiceListEl) {
      this.choiceListEl.replaceChildren();
      if (page.choices && page.choices.length > 0) {
        for (const choice of page.choices) {
          const btn = document.createElement('button');
          btn.type = 'button';
          btn.className = 'snes-choice-btn';
          btn.textContent = choice.label;
          btn.addEventListener('click', () => {
            chiptuneAudio.playConfirm();
            choice.onSelect();
          });
          this.choiceListEl.appendChild(btn);
        }
        this.choiceListEl.hidden = false;
      } else {
        this.choiceListEl.hidden = true;
      }
    }

    // Preserve animated `<span class="snes-advance-arrow">▼</span>` child inside `#snesContinueBtn`.
    if (this.continueBtn) {
      const hasMore = this.dialoguePageIndex < this.dialogueQueue.length - 1;
      const labelEl = this.continueBtn.querySelector<HTMLElement>('span:first-child');
      const labelText = hasMore ? 'Next [SPACE / A]' : 'Continue [SPACE / A]';
      if (labelEl) {
        labelEl.textContent = labelText;
      } else {
        this.continueBtn.textContent = labelText;
      }
    }
  }

  private updateTypewriter(dtSec: number): void {
    if (
      this.gameState !== 'DIALOGUE' &&
      this.gameState !== 'INSPECT_RELIC' &&
      this.gameState !== 'MIMIC_ROAST'
    ) {
      return;
    }
    if (this.typewriterShownChars >= this.typewriterFullText.length) return;

    if (this.motionPaused) {
      this.completeTypewriterImmediately();
      return;
    }

    this.typewriterAccumSec += dtSec;
    const charsToAdd = Math.floor(this.typewriterAccumSec / TYPEWRITER_CHAR_INTERVAL_SEC);
    if (charsToAdd <= 0) return;

    this.typewriterAccumSec -= charsToAdd * TYPEWRITER_CHAR_INTERVAL_SEC;
    this.typewriterShownChars = Math.min(
      this.typewriterFullText.length,
      this.typewriterShownChars + charsToAdd,
    );

    if (this.dialogueTextEl) {
      this.dialogueTextEl.textContent = this.typewriterFullText.slice(
        0,
        this.typewriterShownChars,
      );
    }

    const activePage = this.dialogueQueue[this.dialoguePageIndex];
    const lastChar = this.typewriterFullText[this.typewriterShownChars - 1] ?? '';
    if (lastChar.trim()) {
      chiptuneAudio.playTypewriterBlip(activePage?.pitchOffsetHz ?? 0);
    }
  }

  private completeTypewriterImmediately(): void {
    this.typewriterShownChars = this.typewriterFullText.length;
    if (this.dialogueTextEl) {
      this.dialogueTextEl.textContent = this.typewriterFullText;
    }
  }

  private advanceOrCompleteDialogue(): void {
    if (this.typewriterShownChars < this.typewriterFullText.length) {
      this.completeTypewriterImmediately();
      chiptuneAudio.playConfirm();
      return;
    }
    if (this.dialoguePageIndex < this.dialogueQueue.length - 1) {
      this.dialoguePageIndex += 1;
      chiptuneAudio.playConfirm();
      this.renderCurrentDialoguePage();
      return;
    }
    this.closeDialogue(true);
  }

  public closeDialogue(playCancelAudio = true): void {
    if (
      this.gameState !== 'DIALOGUE' &&
      this.gameState !== 'INSPECT_RELIC' &&
      this.gameState !== 'MIMIC_ROAST'
    ) {
      return;
    }
    if (playCancelAudio) chiptuneAudio.playCancel();
    this.dialogueQueue = [];
    this.dialoguePageIndex = 0;
    this.typewriterFullText = '';
    this.typewriterShownChars = 0;
    this.setGameState('EXPLORING');
  }

  private interactWithHotspot(hotspot: WorldHotspot): void {
    if (hotspot.kind === 'portal' || hotspot.kind === 'return_portal') {
      const targetRoom = hotspot.targetRoom ?? 'campfire';
      this.startPortalWarp(targetRoom, {
        returnFromRoom: hotspot.kind === 'return_portal' ? this.activeRoom : undefined,
      });
      return;
    }

    chiptuneAudio.playConfirm();
    switch (hotspot.kind) {
      case 'campfire':
        this.openSanctuaryCampfire();
        break;
      case 'shelter':
        this.openShelterDialogue();
        break;
      case 'companion':
        this.triggerTheDogEncounter();
        break;
      case 'advisors':
        this.openRassDialogue();
        break;
      case 'devil':
        this.openMsDevilDialogue();
        break;
      case 'chest':
        this.triggerRoastChest();
        break;
      case 'trophy':
        this.openTrophyInspector(this.activeTrophyIndex);
        break;
      case 'era':
        this.openEraInspector(hotspot.itemIndex ?? 0);
        break;
      case 'relic':
        this.openRelicInspector(hotspot.itemIndex ?? 0);
        break;
      case 'beacon':
        this.openSignalBeacon();
        break;
    }
  }

  private openRoomWelcome(roomId: RoomId): void {
    if (roomId === 'campfire') {
      this.openSanctuaryCampfire();
    } else if (roomId === 'cyber_chasm') {
      this.openEraInspector(this.activeEraIndex);
    } else if (roomId === 'bio_forge') {
      this.openRelicInspector(this.activeRelicIndex);
    } else {
      this.openSignalBeacon();
    }
  }

  /**
   * Campfire Sanctuary hearth dialogue chunked cleanly into 2-3 line SNES pages.
   */
  public openSanctuaryCampfire(): void {
    const pages: DialoguePage[] = SANCTUARY_CAMPFIRE.chunks.map((chunk, idx) => ({
      title: SANCTUARY_CAMPFIRE.title,
      speaker: SANCTUARY_CAMPFIRE.speaker,
      text: chunk,
      pitchOffsetHz: -30,
      choices:
        idx === SANCTUARY_CAMPFIRE.chunks.length - 1
          ? [
              {
                label: SANCTUARY_CAMPFIRE.choices[0],
                onSelect: () => this.openCharacterDossier('status'),
              },
              {
                label: SANCTUARY_CAMPFIRE.choices[1],
                onSelect: () => this.triggerTheDogEncounter(),
              },
              {
                label: SANCTUARY_CAMPFIRE.choices[2],
                onSelect: () => {
                  this.closeDialogue(false);
                  this.openStartMenu();
                },
              },
              {
                label: SANCTUARY_CAMPFIRE.choices[3],
                onSelect: () => this.triggerRoastChest(),
              },
            ]
          : undefined,
    }));
    this.openDialoguePages('DIALOGUE', pages);
  }

  /**
   * Timber lean-to shelter & hanging pot inspection at Campfire Sanctuary.
   */
  public openShelterDialogue(): void {
    this.openDialoguePages('DIALOGUE', [
      {
        title: 'CAMPFIRE SANCTUARY · TIMBER SHELTER',
        speaker: '[BORIS]',
        text: 'Hand-hewn timber beams, a cast-iron pot simmering above warm stones, and a lantern keeping watch over the clearing.',
        pitchOffsetHz: -25,
      },
      {
        title: 'CAMPFIRE SANCTUARY · TIMBER SHELTER',
        speaker: '[BORIS]',
        text: 'From here, three perimeter portals link our sanctuary to the Cyber-Chasm, Bio-Forge Spire, and Signal Beacon.',
        pitchOffsetHz: -25,
        choices: [
          {
            label: 'Open Town Map [START]',
            onSelect: () => {
              this.closeDialogue(false);
              this.openStartMenu();
              window.PokemonStartMenuUI?.showSubpanel('town-map');
            },
          },
          {
            label: 'Open Character Dossier [C]',
            onSelect: () => this.openCharacterDossier('status'),
          },
        ],
      },
    ]);
  }

  /**
   * RASS holographic advisor dialogue near the campfire radio antenna.
   */
  public openRassDialogue(): void {
    const rass = COMPANION_DRONES.speakers[0];
    this.openDialoguePages(
      'DIALOGUE',
      rass.chunks.map((chunk, idx) => ({
        title: 'CAMPFIRE ADVISOR · RASS ARCHITECT',
        speaker: rass.name,
        text: chunk,
        pitchOffsetHz: 90,
        choices:
          idx === rass.chunks.length - 1
            ? [
                {
                  label: 'Warp to Cyber-Chasm',
                  onSelect: () => this.startPortalWarp('cyber_chasm'),
                },
                {
                  label: 'Warp to Signal Beacon',
                  onSelect: () => this.startPortalWarp('signal_beacon'),
                },
              ]
            : undefined,
      })),
    );
  }

  /**
   * Ms. Devil skeptic advisor dialogue lounging on the carved timber bench.
   */
  public openMsDevilDialogue(): void {
    const devil = COMPANION_DRONES.speakers[1];
    this.openDialoguePages(
      'DIALOGUE',
      devil.chunks.map((chunk, idx) => ({
        title: 'CAMPFIRE ADVISOR · MS. DEVIL',
        speaker: devil.name,
        text: chunk,
        pitchOffsetHz: 150,
        choices:
          idx === devil.chunks.length - 1
            ? [
                {
                  label: 'Warp to Bio-Forge Relics',
                  onSelect: () => this.startPortalWarp('bio_forge'),
                },
                {
                  label: 'Crack Mimic Chest [R]',
                  onSelect: () => this.triggerRoastChest(),
                },
              ]
            : undefined,
      })),
    );
  }

  /**
   * Backwards-compatible alias launching both campfire advisors in sequence.
   */
  public openCompanionDronesDialogue(): void {
    this.openRassDialogue();
  }

  /**
   * Cyber-Chasm 5-monolith Era inspector (`HALL_OF_ERAS`).
   */
  public openEraInspector(index: number): void {
    const safeIdx = ((index % HALL_OF_ERAS.length) + HALL_OF_ERAS.length) % HALL_OF_ERAS.length;
    this.activeEraIndex = safeIdx;
    const era = HALL_OF_ERAS[safeIdx];

    this.openDialoguePages(
      'INSPECT_RELIC',
      era.chunks.map((chunk, chunkIdx) => ({
        title: `CYBER-CHASM · ${era.year}`,
        speaker: '[TERMINAL]',
        text: chunk,
        pitchOffsetHz: -50,
        inspectorBuilder: (container) => {
          const meta = document.createElement('div');
          meta.className = 'snes-inspector-meta';

          const eraBadge = document.createElement('span');
          eraBadge.className = 'snes-inspector-badge snes-inspector-badge--purple';
          eraBadge.textContent = `MONOLITH ${safeIdx + 1} / ${HALL_OF_ERAS.length}`;

          const titleBadge = document.createElement('span');
          titleBadge.className = 'snes-inspector-badge snes-inspector-badge--gold';
          titleBadge.textContent = era.era;

          meta.append(eraBadge, titleBadge);

          const actions = document.createElement('div');
          actions.className = 'snes-inspector-actions';

          const dossierLink = document.createElement('button');
          dossierLink.type = 'button';
          dossierLink.className = 'snes-nav-btn';
          dossierLink.textContent = 'Full Eras in Dossier';
          dossierLink.addEventListener('click', () => this.openCharacterDossier('eras'));
          actions.appendChild(dossierLink);

          container.append(meta, actions);
        },
        choices:
          chunkIdx === era.chunks.length - 1
            ? [
                {
                  label: '< Prev Monolith',
                  onSelect: () => this.openEraInspector(safeIdx - 1),
                },
                {
                  label: 'Next Monolith >',
                  onSelect: () => this.openEraInspector(safeIdx + 1),
                },
              ]
            : undefined,
      })),
    );
  }

  /**
   * Bio-Forge Spire pulsing glass containment pod inspector (`RELIC_VAULT`).
   */
  public openRelicInspector(index: number): void {
    const safeIdx = ((index % RELIC_VAULT.length) + RELIC_VAULT.length) % RELIC_VAULT.length;
    this.activeRelicIndex = safeIdx;
    const relic = RELIC_VAULT[safeIdx];

    this.openDialoguePages(
      'INSPECT_RELIC',
      relic.chunks.map((chunk, chunkIdx) => ({
        title: `BIO-FORGE · ${relic.name.toUpperCase()}`,
        speaker: '[TERMINAL]',
        text: chunk,
        pitchOffsetHz: 20,
        inspectorBuilder: (container) => {
          const meta = document.createElement('div');
          meta.className = 'snes-inspector-meta';

          const podBadge = document.createElement('span');
          podBadge.className = 'snes-inspector-badge';
          podBadge.textContent = `POD ${safeIdx + 1} / ${RELIC_VAULT.length}`;

          const catBadge = document.createElement('span');
          catBadge.className = 'snes-inspector-badge snes-inspector-badge--copper';
          catBadge.textContent = relic.category;
          meta.append(podBadge, catBadge);

          const statsLine = document.createElement('p');
          statsLine.className = 'snes-inspector-stats';
          statsLine.textContent = relic.stats;

          const actions = document.createElement('div');
          actions.className = 'snes-inspector-actions';

          const link = document.createElement('a');
          link.className = 'snes-inspector-link';
          link.href = relic.url;
          link.textContent = relic.btn;
          if (relic.url.startsWith('http')) {
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
          } else {
            link.addEventListener('click', (e) => {
              e.preventDefault();
              statsLine.textContent = `${relic.stats} · Field Compass synced.`;
            });
          }

          const dossierBtn = document.createElement('button');
          dossierBtn.type = 'button';
          dossierBtn.className = 'snes-nav-btn';
          dossierBtn.textContent = 'Relic Vault in Dossier';
          dossierBtn.addEventListener('click', () => this.openCharacterDossier('relics'));

          actions.append(link, dossierBtn);
          container.append(meta, statsLine, actions);
        },
        choices:
          chunkIdx === relic.chunks.length - 1
            ? [
                {
                  label: '< Prev Pod',
                  onSelect: () => this.openRelicInspector(safeIdx - 1),
                },
                {
                  label: 'Next Pod >',
                  onSelect: () => this.openRelicInspector(safeIdx + 1),
                },
              ]
            : undefined,
      })),
    );
  }

  /**
   * Trophy Armory Lodge 21-card inspector at the Campfire Sanctuary edge.
   */
  public openTrophyInspector(index: number): void {
    const count = TROPHY_CARDS.length;
    const safeIdx = ((index % count) + count) % count;
    this.activeTrophyIndex = safeIdx;
    const card = TROPHY_CARDS[safeIdx];

    this.openDialoguePages('INSPECT_RELIC', [
      {
        title: TROPHY_ARMORY.title,
        speaker: TROPHY_ARMORY.speaker,
        text: TROPHY_ARMORY.chunks[0],
        pitchOffsetHz: 45,
        inspectorBuilder: (container) => {
          const trophyBox = document.createElement('div');
          trophyBox.className = 'snes-trophy-card';

          const meta = document.createElement('div');
          meta.className = 'snes-inspector-meta';

          const numBadge = document.createElement('span');
          numBadge.className = 'snes-inspector-badge snes-inspector-badge--gold';
          numBadge.textContent = `${card.cardNumber} (${safeIdx + 1}/${count})`;

          const rarityBadge = document.createElement('span');
          rarityBadge.className = 'snes-inspector-badge';
          rarityBadge.textContent = `${card.rarityLabel} · ${card.xp ?? 0} XP`;

          const statusBadge = document.createElement('span');
          statusBadge.className = 'snes-inspector-badge';
          statusBadge.textContent = card.earned
            ? 'EARNED'
            : card.isMystery
              ? 'MYSTERY'
              : 'PENDING';

          const visitedBadge = document.createElement('span');
          visitedBadge.className = 'snes-inspector-badge snes-inspector-badge--purple';
          visitedBadge.textContent = `FRONTIERS ${this.visitedRooms.size}/${BIOME_LIST.length}`;

          meta.append(numBadge, rarityBadge, statusBadge, visitedBadge);

          const title = document.createElement('p');
          title.className = 'snes-trophy-name';
          title.textContent = card.name;

          const caption = document.createElement('p');
          caption.className = 'snes-inspector-sub';
          caption.textContent = card.caption;

          const lore = document.createElement('p');
          lore.className = 'snes-trophy-lore';
          lore.textContent = card.lore || card.tooltip || '';

          trophyBox.append(meta, title, caption);
          if (lore.textContent) trophyBox.appendChild(lore);

          const actions = document.createElement('div');
          actions.className = 'snes-inspector-actions';

          const prevBtn = document.createElement('button');
          prevBtn.type = 'button';
          prevBtn.className = 'snes-nav-btn';
          prevBtn.textContent = '< Prev Card';
          prevBtn.addEventListener('click', () => {
            chiptuneAudio.playConfirm();
            this.openTrophyInspector(safeIdx - 1);
          });

          const nextBtn = document.createElement('button');
          nextBtn.type = 'button';
          nextBtn.className = 'snes-nav-btn';
          nextBtn.textContent = 'Next Card >';
          nextBtn.addEventListener('click', () => {
            chiptuneAudio.playConfirm();
            this.openTrophyInspector(safeIdx + 1);
          });

          const viewAllBtn = document.createElement('button');
          viewAllBtn.type = 'button';
          viewAllBtn.className = 'snes-inspector-link';
          viewAllBtn.textContent = 'View All 21 in Dossier';
          viewAllBtn.addEventListener('click', () => this.openCharacterDossier('trophies'));

          actions.append(prevBtn, nextBtn, viewAllBtn);
          container.append(trophyBox, actions);
        },
      },
    ]);
  }

  /**
   * High-Orbit Signal Beacon transmission channels (Email, WhatsApp, Cal.com).
   */
  public openSignalBeacon(): void {
    this.openDialoguePages(
      'INSPECT_RELIC',
      SIGNAL_BEACON.chunks.map((chunk) => ({
        title: SIGNAL_BEACON.title,
        speaker: SIGNAL_BEACON.speaker,
        text: chunk,
        pitchOffsetHz: 75,
        inspectorBuilder: (container) => {
          const actions = document.createElement('div');
          actions.className = 'snes-inspector-actions';

          for (const ch of SIGNAL_BEACON.channels) {
            const link = document.createElement('a');
            link.className = 'snes-inspector-link';
            link.href = ch.val;
            link.textContent = `${ch.type}: ${ch.label}`;
            if (ch.val.startsWith('http')) {
              link.target = '_blank';
              link.rel = 'noopener noreferrer';
            }
            actions.appendChild(link);
          }

          const dossierBtn = document.createElement('button');
          dossierBtn.type = 'button';
          dossierBtn.className = 'snes-nav-btn';
          dossierBtn.textContent = 'Open Beacon Terminal';
          dossierBtn.addEventListener('click', () => this.openCharacterDossier('beacon'));
          actions.appendChild(dossierBtn);

          container.appendChild(actions);
        },
      })),
    );
  }

  /**
   * Studio Credits & Democracy of Three script triggered from `[START] -> Credits`.
   */
  public openCreditsDialogue(): void {
    this.openDialoguePages(
      'DIALOGUE',
      CREDITS_SCRIPT.chunks.map((chunk) => ({
        title: CREDITS_SCRIPT.title,
        speaker: CREDITS_SCRIPT.speaker,
        text: chunk,
        pitchOffsetHz: 40,
      })),
    );
  }

  /**
   * Transition cleanly into `CHARACTER_SHEET` and open native `<dialog id="characterDossierModal">`.
   */
  public openCharacterDossier(tabId = 'status'): void {
    chiptuneAudio.playConfirm();
    this.keysHeld.clear();
    this.dpadHeld.clear();
    this.closeStartMenu(false);
    this.closeDialogue(false);

    const terminal = window.CharacterDossierTerminal;
    if (!terminal) {
      debugLog('CharacterDossierTerminal missing; returning to EXPLORING.');
      this.setGameState('EXPLORING');
      return;
    }

    this.setGameState('CHARACTER_SHEET');
    terminal.open(tabId);
  }

  /**
   * Wake & pet The Dog on the campfire woven mat (`[THE DOG]`), trigger 8-bit
   * bark chime, spawn pixel heart particle, and show `+10 Morale Restored` toast.
   */
  public triggerTheDogEncounter(): void {
    this.dogWakeTimer = 2.8;
    chiptuneAudio.playBarkChime();
    if (this.activeRoom === 'campfire') {
      this.spawnHeartParticle();
    }
    this.showMoraleToast(SLEEPING_DOG.effect);

    this.openDialoguePages(
      'DIALOGUE',
      SLEEPING_DOG.chunks.map((chunk, idx) => ({
        title: SLEEPING_DOG.title,
        speaker: SLEEPING_DOG.speaker,
        text: chunk,
        pitchOffsetHz: 110,
        inspectorBuilder:
          idx === SLEEPING_DOG.chunks.length - 1
            ? (container) => {
                const meta = document.createElement('div');
                meta.className = 'snes-inspector-meta';

                const effectPill = document.createElement('span');
                effectPill.className = 'snes-inspector-badge snes-inspector-badge--gold';
                effectPill.textContent = SLEEPING_DOG.effect;
                meta.appendChild(effectPill);
                container.appendChild(meta);
              }
            : undefined,
      })),
    );
    debugLog('The Dog patted by the campfire hearth (+10 Morale Restored).');
  }

  /** Compatibility alias for external triggers referencing the dog encounter. */
  public triggerWhiteDogMemorial(): void {
    this.triggerTheDogEncounter();
  }

  private spawnHeartParticle(): void {
    const startY = this.dogAnchorY - 36;
    const particle: HeartParticle = {
      x: this.dogAnchorX,
      y: startY,
      startY,
      age: 0,
    };

    if (this.entityContainer && this.pixiTextures) {
      const sprite = new Sprite(this.pixiTextures.worldObjects.heart);
      sprite.anchor.set(0.5, 1);
      sprite.x = particle.x;
      sprite.y = particle.y;
      sprite.zIndex = Math.round(this.dogAnchorY) + 20;
      this.entityContainer.addChild(sprite);
      particle.sprite = sprite;
    }

    this.heartParticles.push(particle);
  }

  private announceStatus(message: string): void {
    if (this.liveRegionEl) {
      this.liveRegionEl.textContent = '';
      queueMicrotask(() => {
        if (this.liveRegionEl) this.liveRegionEl.textContent = message;
      });
    }
    const docWithNotify = document as Document & { ariaNotify?: (text: string) => void };
    if (typeof docWithNotify.ariaNotify === 'function') {
      docWithNotify.ariaNotify(message);
    }
  }

  private showMoraleToast(message: string): void {
    if (this.moraleToastTextEl) {
      this.moraleToastTextEl.textContent = message;
    }
    this.announceStatus(message);

    if (!this.moraleToastEl) return;
    this.moraleToastEl.hidden = false;
    this.scheduleMoraleToastHide();
  }

  private scheduleMoraleToastHide(): void {
    if (this.moraleToastTimer !== null) {
      window.clearTimeout(this.moraleToastTimer);
    }
    this.moraleToastTimer = window.setTimeout(() => {
      if (this.moraleToastPaused) {
        this.scheduleMoraleToastHide();
        return;
      }
      if (this.moraleToastEl) this.moraleToastEl.hidden = true;
      this.moraleToastTimer = null;
    }, MORALE_TOAST_DURATION_MS);
  }

  /**
   * Open the Mimic Roast Chest (`MIMIC_ROAST` state), animate chest open,
   * play 4-note RPG fanfare, and display one of 3 satirical drops + burned verdict.
   */
  public triggerRoastChest(): void {
    this.closeStartMenu(false);
    chiptuneAudio.playChestOpen();
    this.chestOpenTimer = 2.4;
    if (this.chestSprite && this.pixiTextures) {
      this.chestSprite.texture = this.pixiTextures.worldObjects.roastChest.open;
    }

    const drop = ROAST_CHEST.items[this.roastIndex % ROAST_CHEST.items.length];
    this.roastIndex += 1;

    this.openDialoguePages('MIMIC_ROAST', [
      {
        title: ROAST_CHEST.title,
        speaker: ROAST_CHEST.speaker,
        text: `${drop}\n\n${ROAST_CHEST.verdict}`,
        pitchOffsetHz: -80,
        inspectorBuilder: (container) => {
          const meta = document.createElement('div');
          meta.className = 'snes-inspector-meta';

          const badge = document.createElement('span');
          badge.className = 'snes-inspector-badge snes-inspector-badge--copper';
          badge.textContent = ROAST_CHEST.verdict;
          meta.appendChild(badge);
          container.appendChild(meta);
        },
        choices: [
          {
            label: 'Loot Another Roast [R]',
            onSelect: () => this.triggerRoastChest(),
          },
          {
            label: 'Open Character Dossier [C]',
            onSelect: () => this.openCharacterDossier('status'),
          },
        ],
      },
    ]);
    debugLog('Mimic Roast Chest opened', { drop });
  }

  /**
   * Warp cleanly to room index `0..3` (`1`..`4` keys or fast-travel buttons).
   */
  public fastTravelTo(roomIndex: number): void {
    const safeIdx = Math.max(0, Math.min(BIOME_DEFINITIONS.length - 1, roomIndex));
    const room = BIOME_DEFINITIONS[safeIdx];
    this.startPortalWarp(room.id);
  }

  private syncRoomUI(room: RoomTopology, playChime: boolean): void {
    this.stageRoot.dataset.zoneActive = room.id;

    const meta = BIOME_LIST.find((r) => r.id === room.id);
    if (this.zoneLabelEl) {
      this.zoneLabelEl.textContent = meta ? meta.name : room.name;
    }
    if (this.startMenuRoomReadoutEl) {
      this.startMenuRoomReadoutEl.textContent = meta ? meta.name : room.name;
    }

    for (const btn of this.travelButtons) {
      const isActive = btn.dataset.travelZone === room.id;
      btn.classList.toggle('is-active', isActive);
      if (isActive) {
        btn.setAttribute('aria-current', 'true');
      } else {
        btn.removeAttribute('aria-current');
      }
    }

    for (const btn of this.startMenuWarpBtns) {
      const btnRoom = btn.dataset.warpRoom as RoomId | undefined;
      const isActive = btnRoom === room.id;
      btn.classList.toggle('is-active', isActive);
      if (btnRoom) {
        btn.dataset.visited = String(this.visitedRooms.has(btnRoom));
      }
      if (isActive) {
        btn.setAttribute('aria-current', 'true');
      } else {
        btn.removeAttribute('aria-current');
      }
    }

    if (playChime) {
      chiptuneAudio.playZoneChime(room.index);
    }
  }

  // ============================================================================
  // Preferences, Persistence (hw_studio_state_v1), Controls & Event Bindings
  // ============================================================================

  private savePersistedState(): void {
    if (typeof window === 'undefined' || !window.localStorage) return;
    const payload: StudioPersistentState = {
      version: 1,
      visitedRooms: Array.from(this.visitedRooms),
      audioMuted: chiptuneAudio.isMuted(),
      crackleEnabled: chiptuneAudio.isCrackleEnabled(),
      crtScanlines: this.crtScanlines,
      celestialMode: this.celestialMode,
      motionPaused: this.motionPaused,
    };
    try {
      window.localStorage.setItem(STUDIO_STORAGE_KEY, JSON.stringify(payload));
    } catch (err) {
      debugLog('Failed saving hw_studio_state_v1 to localStorage.', err);
    }
  }

  private restoreAndBindPreferences(): void {
    this.reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const restored = loadPersistedState(this.reducedMotionQuery.matches);

    this.visitedRooms = new Set<RoomId>(restored.visitedRooms);
    this.celestialMode = restored.celestialMode;
    this.setCrtScanlines(restored.crtScanlines, false);
    chiptuneAudio.setMuted(restored.audioMuted);
    chiptuneAudio.setCrackleEnabled(restored.crackleEnabled);
    this.setMotionPaused(restored.motionPaused, false, false);

    const onReducedMotionChange = (e: MediaQueryListEvent) => {
      this.setMotionPaused(e.matches, false, true);
    };
    this.reducedMotionQuery.addEventListener('change', onReducedMotionChange);
    this.cleanups.push(() =>
      this.reducedMotionQuery?.removeEventListener('change', onReducedMotionChange),
    );
  }

  private setMotionPaused(paused: boolean, withChime: boolean, persist = true): void {
    this.motionPaused = paused;
    document.documentElement.dataset.motion = paused ? 'paused' : 'on';

    // WCAG 2.2.2 Pause/Play text switch: never add aria-pressed on label-changing controls.
    if (this.motionBtn) {
      this.motionBtn.textContent = paused ? 'Play motion' : 'Pause motion';
      this.motionBtn.removeAttribute('aria-pressed');
      this.motionBtn.dataset.motionState = paused ? 'paused' : 'playing';
    }
    if (this.settingMotionBtn) {
      this.settingMotionBtn.dataset.state = paused ? 'paused' : 'playing';
      const valEl = this.settingMotionBtn.querySelector<HTMLElement>('.setting-val');
      if (valEl) valEl.textContent = paused ? 'Play motion' : 'Pause motion';
    }

    if (paused && this.typewriterShownChars < this.typewriterFullText.length) {
      this.completeTypewriterImmediately();
    }
    if (persist) this.savePersistedState();
    if (withChime) chiptuneAudio.playToggle();
  }

  private setCrtScanlines(enabled: boolean, persist = true): void {
    this.crtScanlines = enabled;
    document.documentElement.dataset.crt = enabled ? 'on' : 'off';
    if (this.settingCrtBtn) {
      this.settingCrtBtn.dataset.state = enabled ? 'on' : 'off';
      const valEl = this.settingCrtBtn.querySelector<HTMLElement>('.setting-val');
      if (valEl) valEl.textContent = enabled ? 'ON' : 'OFF';
    }
    if (persist) this.savePersistedState();
  }

  private syncAllSettingsUI(): void {
    const muted = chiptuneAudio.isMuted();
    if (this.audioBtn) {
      this.audioBtn.dataset.muted = String(muted);
      this.audioBtn.textContent = muted ? 'Unmute SFX' : 'Mute SFX';
    }
    if (this.settingAudioBtn) {
      this.settingAudioBtn.dataset.state = muted ? 'off' : 'on';
      const valEl = this.settingAudioBtn.querySelector<HTMLElement>('.setting-val');
      if (valEl) valEl.textContent = muted ? 'MUTED' : 'ON';
    }

    const crackleOn = chiptuneAudio.isCrackleEnabled();
    if (this.settingCrackleBtn) {
      this.settingCrackleBtn.dataset.state = crackleOn ? 'on' : 'off';
      const valEl = this.settingCrackleBtn.querySelector<HTMLElement>('.setting-val');
      if (valEl) valEl.textContent = crackleOn ? 'ON' : 'OFF';
    }

    this.setCrtScanlines(this.crtScanlines, false);

    if (this.settingSkyBtn) {
      this.settingSkyBtn.dataset.state = this.celestialMode;
      const valEl = this.settingSkyBtn.querySelector<HTMLElement>('.setting-val');
      if (valEl) valEl.textContent = this.celestialMode.toUpperCase();
    }

    if (this.celestialBtn) {
      const { isDaytime } = computeCelestialState(this.celestialMode);
      this.celestialBtn.textContent = isDaytime ? '☀️ Day' : '🌙 Night';
      this.celestialBtn.setAttribute(
        'aria-label',
        isDaytime
          ? 'Sky mode: Day. Activate to switch to Night sky.'
          : 'Sky mode: Night. Activate to switch to Day sky.',
      );
    }

    this.setMotionPaused(this.motionPaused, false, false);
  }

  private bindDomControls(): void {
    const bindClick = (el: HTMLElement | null, fn: () => void) => {
      if (!el) return;
      el.addEventListener('click', fn);
      this.cleanups.push(() => el.removeEventListener('click', fn));
    };

    for (const btn of this.travelButtons) {
      const roomId = btn.dataset.travelZone as RoomId | undefined;
      if (!roomId) continue;
      bindClick(btn, () => {
        chiptuneAudio.unlock();
        this.startPortalWarp(roomId);
      });
    }

    bindClick(this.btnOpenStartMenu, () => {
      chiptuneAudio.unlock();
      this.toggleStartMenu();
    });

    bindClick(this.btnStartDossier, () => {
      chiptuneAudio.unlock();
      this.toggleStartMenu();
    });

    bindClick(this.celestialBtn, () => {
      chiptuneAudio.unlock();
      const isDay = computeCelestialState(this.celestialMode).isDaytime;
      this.celestialMode = isDay ? 'night' : 'day';
      this.syncAllSettingsUI();
      this.drawPixiSkyFallback(this.viewWidth, this.viewHeight);
      this.savePersistedState();
      chiptuneAudio.playToggle();
    });

    bindClick(this.audioBtn, () => {
      chiptuneAudio.toggleMute();
      this.syncAllSettingsUI();
      this.savePersistedState();
    });

    bindClick(this.motionBtn, () => {
      chiptuneAudio.unlock();
      this.setMotionPaused(!this.motionPaused, true, true);
    });

    bindClick(this.openDossierBtn, () => this.openCharacterDossier('status'));
    bindClick(this.roastTriggerBtn, () => this.triggerRoastChest());
    bindClick(this.btnSelectRoast, () => this.triggerRoastChest());
    bindClick(this.dogTriggerBtn, () => this.triggerTheDogEncounter());

    bindClick(this.btnActionA, () => this.handlePrimaryAction());
    bindClick(this.btnActionB, () => {
      if (this.gameState === 'START_MENU') {
        this.closeStartMenu(true);
      } else if (this.gameState === 'EXPLORING') {
        this.triggerTheDogEncounter();
      } else {
        this.closeDialogue(true);
      }
    });

    bindClick(this.interactionPromptBtn, () => this.handlePrimaryAction());
    bindClick(this.continueBtn, () => this.advanceOrCompleteDialogue());
    bindClick(this.closeBtn, () => this.closeDialogue(true));

    bindClick(this.moraleToastCloseBtn, () => {
      if (this.moraleToastEl) this.moraleToastEl.hidden = true;
    });

    if (this.moraleToastEl) {
      const pauseHide = () => {
        this.moraleToastPaused = true;
      };
      const resumeHide = () => {
        this.moraleToastPaused = false;
      };
      this.moraleToastEl.addEventListener('mouseenter', pauseHide);
      this.moraleToastEl.addEventListener('mouseleave', resumeHide);
      this.moraleToastEl.addEventListener('focusin', pauseHide);
      this.moraleToastEl.addEventListener('focusout', resumeHide);
      this.cleanups.push(() => {
        this.moraleToastEl?.removeEventListener('mouseenter', pauseHide);
        this.moraleToastEl?.removeEventListener('mouseleave', resumeHide);
        this.moraleToastEl?.removeEventListener('focusin', pauseHide);
        this.moraleToastEl?.removeEventListener('focusout', resumeHide);
      });
    }
  }

  private bindStartMenuControls(): void {
    const bindClick = (el: HTMLElement | null, fn: () => void) => {
      if (!el) return;
      el.addEventListener('click', fn);
      this.cleanups.push(() => el.removeEventListener('click', fn));
    };

    for (const btn of this.startMenuActionBtns) {
      const action = btn.dataset.menuAction;
      bindClick(btn, () => {
        chiptuneAudio.unlock();
        if (action === 'dossier') {
          this.openCharacterDossier('status');
        } else if (action === 'relics') {
          this.closeStartMenu(false);
          if (this.activeRoom === 'bio_forge') {
            this.openRelicInspector(0);
          } else {
            this.startPortalWarp('bio_forge', {
              onComplete: () => this.openRelicInspector(0),
            });
          }
        } else if (action === 'badges') {
          this.closeStartMenu(false);
          this.openTrophyInspector(this.activeTrophyIndex);
        } else if (action === 'credits') {
          this.closeStartMenu(false);
          this.openCreditsDialogue();
        } else if (action === 'resume') {
          this.closeStartMenu(true);
        } else if (action === 'town-map' || action === 'settings' || action === 'transmit') {
          chiptuneAudio.playMenuBlip();
          window.PokemonStartMenuUI?.showSubpanel(action);
        }
      });
    }

    for (const warpBtn of this.startMenuWarpBtns) {
      const roomId = warpBtn.dataset.warpRoom as RoomId | undefined;
      if (!roomId) continue;
      bindClick(warpBtn, () => {
        chiptuneAudio.unlock();
        this.startPortalWarp(roomId);
      });
    }

    bindClick(this.settingAudioBtn, () => {
      chiptuneAudio.toggleMute();
      this.syncAllSettingsUI();
      this.savePersistedState();
    });

    bindClick(this.settingCrackleBtn, () => {
      chiptuneAudio.toggleCrackle();
      this.syncAllSettingsUI();
      this.savePersistedState();
    });

    bindClick(this.settingCrtBtn, () => {
      chiptuneAudio.unlock();
      this.setCrtScanlines(!this.crtScanlines, true);
      chiptuneAudio.playToggle();
    });

    bindClick(this.settingSkyBtn, () => {
      chiptuneAudio.unlock();
      const order: CelestialMode[] = ['auto', 'day', 'night'];
      const nextIdx = (order.indexOf(this.celestialMode) + 1) % order.length;
      this.celestialMode = order[nextIdx];
      this.syncAllSettingsUI();
      this.drawPixiSkyFallback(this.viewWidth, this.viewHeight);
      this.savePersistedState();
      chiptuneAudio.playToggle();
    });

    bindClick(this.settingMotionBtn, () => {
      chiptuneAudio.unlock();
      this.setMotionPaused(!this.motionPaused, true, true);
    });

    bindClick(this.startMenuResumeBtn, () => {
      chiptuneAudio.unlock();
      this.closeStartMenu(true);
    });
  }

  private bindDpadControls(): void {
    const dirs: SpriteDirection[] = ['up', 'down', 'left', 'right'];
    for (const dir of dirs) {
      const btn = this.dpadButtons[dir];
      if (!btn) continue;

      const startHold = (e: PointerEvent) => {
        e.preventDefault();
        chiptuneAudio.unlock();
        this.dpadHeld.add(dir);
      };
      const stopHold = () => {
        this.dpadHeld.delete(dir);
      };
      const onKeyClick = (e: MouseEvent) => {
        if (e.detail === 0 && this.gameState === 'EXPLORING') {
          chiptuneAudio.unlock();
          const step = 36;
          const dx = dir === 'right' ? step : dir === 'left' ? -step : 0;
          const dy = dir === 'down' ? step : dir === 'up' ? -step : 0;
          this.facing = dir;
          const next = resolveRoomCollisions(this.activeRoom, this.borisX + dx, this.borisY + dy, 14);
          this.borisX = next.x;
          this.borisY = next.y;
          this.stationarySec = 0;
          chiptuneAudio.playStep(getRoomById(this.activeRoom).surfaceType);
        }
      };

      btn.addEventListener('pointerdown', startHold);
      btn.addEventListener('pointerup', stopHold);
      btn.addEventListener('pointerleave', stopHold);
      btn.addEventListener('pointercancel', stopHold);
      btn.addEventListener('click', onKeyClick);

      this.cleanups.push(() => {
        btn.removeEventListener('pointerdown', startHold);
        btn.removeEventListener('pointerup', stopHold);
        btn.removeEventListener('pointerleave', stopHold);
        btn.removeEventListener('pointercancel', stopHold);
        btn.removeEventListener('click', onKeyClick);
      });
    }
  }

  private handlePrimaryAction(): void {
    chiptuneAudio.unlock();
    if (
      this.gameState === 'DIALOGUE' ||
      this.gameState === 'INSPECT_RELIC' ||
      this.gameState === 'MIMIC_ROAST'
    ) {
      this.advanceOrCompleteDialogue();
      return;
    }

    if (this.gameState === 'EXPLORING') {
      if (this.nearestHotspot) {
        this.interactWithHotspot(this.nearestHotspot);
      } else {
        this.openRoomWelcome(this.activeRoom);
      }
    }
  }

  private bindKeyboardControls(): void {
    const onKeyDown = (event: KeyboardEvent) => {
      if (isEditableOrModified(event)) return;
      if (document.querySelector('dialog[open]')) return;

      const key = event.key.toLowerCase();

      // Movement keys (WASD / Arrow keys)
      if (
        event.code === 'KeyW' ||
        event.code === 'KeyA' ||
        event.code === 'KeyS' ||
        event.code === 'KeyD' ||
        event.code === 'ArrowUp' ||
        event.code === 'ArrowDown' ||
        event.code === 'ArrowLeft' ||
        event.code === 'ArrowRight'
      ) {
        if (this.gameState === 'EXPLORING') {
          if (event.code.startsWith('Arrow')) event.preventDefault();
          this.keysHeld.add(event.code);
          chiptuneAudio.unlock();
        }
        return;
      }

      // Room portal warp hotkeys 1..4
      if (key >= '1' && key <= '4') {
        chiptuneAudio.unlock();
        this.fastTravelTo(Number(key) - 1);
        return;
      }

      // [H] Warp Home directly to Campfire Sanctuary
      if (key === 'h') {
        chiptuneAudio.unlock();
        if (this.activeRoom !== 'campfire') {
          this.startPortalWarp('campfire');
        } else {
          this.openSanctuaryCampfire();
        }
        return;
      }

      // [M] Toggle unified Pokémon [START] Command Menu
      if (key === 'm') {
        event.preventDefault();
        chiptuneAudio.unlock();
        this.toggleStartMenu();
        return;
      }

      // Character Dossier hotkey [C]
      if (key === 'c') {
        this.openCharacterDossier('status');
        return;
      }

      // Mimic Roast Chest hotkey [R]
      if (key === 'r') {
        this.triggerRoastChest();
        return;
      }

      // Escape: close dialogue OR toggle [START] menu when exploring
      if (event.key === 'Escape') {
        event.preventDefault();
        if (this.gameState === 'START_MENU') {
          this.closeStartMenu(true);
        } else if (
          this.gameState === 'DIALOGUE' ||
          this.gameState === 'INSPECT_RELIC' ||
          this.gameState === 'MIMIC_ROAST'
        ) {
          this.closeDialogue(true);
        } else if (this.gameState === 'EXPLORING') {
          this.openStartMenu();
        }
        return;
      }

      // [B]: Close dialogue/menu, or pet The Dog when exploring
      if (key === 'b') {
        if (this.gameState === 'START_MENU') {
          this.closeStartMenu(true);
        } else if (this.gameState === 'EXPLORING') {
          this.triggerTheDogEncounter();
        } else if (this.gameState !== 'CHARACTER_SHEET' && this.gameState !== 'PORTAL_WARP') {
          this.closeDialogue(true);
        }
        return;
      }

      // [Space] / [Enter] action key - preserve native focused button/link activation
      if (event.code === 'Space' || event.key === 'Enter') {
        const target = event.target as HTMLElement | null;
        if (target && (target.tagName === 'BUTTON' || target.tagName === 'A')) {
          return;
        }
        event.preventDefault();
        this.handlePrimaryAction();
      }
    };

    const onKeyUp = (event: KeyboardEvent) => {
      this.keysHeld.delete(event.code);
    };

    const clearHeld = () => {
      this.keysHeld.clear();
      this.dpadHeld.clear();
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', clearHeld);

    this.cleanups.push(() => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', clearHeld);
    });
  }

  private bindDossierCloseListener(): void {
    const onDossierClose = () => {
      if (this.gameState === 'CHARACTER_SHEET') {
        chiptuneAudio.playCancel();
        this.setGameState('EXPLORING');
      }
    };
    document.addEventListener('hw:dossier-close', onDossierClose);
    this.cleanups.push(() =>
      document.removeEventListener('hw:dossier-close', onDossierClose),
    );
  }

  /**
   * Pause ticker simulation when tab is hidden or skipped by browser visibility
   * to conserve battery life on mobile devices.
   */
  private bindVisibilityLifecycle(): void {
    const onVisibilityChange = () => {
      this.tabHiddenPaused = document.hidden;
      if (!document.hidden) {
        this.lastRafMs = performance.now();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    this.cleanups.push(() =>
      document.removeEventListener('visibilitychange', onVisibilityChange),
    );

    const onContentVisibility = (event: Event) => {
      const skipped = (event as Event & { skipped?: boolean }).skipped;
      if (typeof skipped === 'boolean') {
        this.tabHiddenPaused = skipped || document.hidden;
      }
    };
    this.stageRoot.addEventListener('contentvisibilityautostatechange', onContentVisibility);
    this.cleanups.push(() =>
      this.stageRoot.removeEventListener('contentvisibilityautostatechange', onContentVisibility),
    );
  }

  public destroy(): void {
    for (const cleanup of this.cleanups) cleanup();
    this.cleanups = [];

    for (const txt of this.roomLabelTexts) {
      txt.destroy();
    }
    this.roomLabelTexts = [];

    if (this.moraleToastTimer !== null) {
      window.clearTimeout(this.moraleToastTimer);
      this.moraleToastTimer = null;
    }
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    this.resizeObserver?.disconnect();
    this.app?.destroy(true, { children: true, texture: true });
    this.app = null;
  }
}

let activeController: OverworldController | null = null;

/**
 * Boot and mount the SPEC-022 OverworldController inside `#overworldStage`.
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
