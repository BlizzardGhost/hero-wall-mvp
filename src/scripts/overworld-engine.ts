/**
 * Path: src/scripts/overworld-engine.ts
 * Purpose: Core PixiJS v8 WebGPU (with WebGL2 and Canvas2D fallbacks) game engine
 *          and 5-state Finite State Machine (`EXPLORING`, `DIALOGUE`, `INSPECT_RELIC`,
 *          `CHARACTER_SHEET`, `MIMIC_ROAST`) for SPEC-021 Hero Wall Pure 16-Bit RPG Overworld.
 *          Drives WGSL/GLSL celestial sky rendering, 5 SNES biomes, 4-member animated party,
 *          14 interactive world hotspots, universal SnesDialogueBox typewriter & inspector,
 *          CharacterDossier modal handoff, WCAG 2.2.2 motion toggle, and gamepad/keyboard input.
 * Spec Reference: SPEC-021 (021-hero-wall-full-game-overworld)
 *
 * Debug Operator Notes:
 * - Set `window.__RASS_OVERWORLD_DEBUG__ = true` to log FSM transitions, renderer fallback
 *   selection, hotspot proximity detections, and input bindings in DevTools.
 * - `#motionToggle` intentionally avoids `aria-pressed` per WCAG 2.2.2 Pause/Play label rules.
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
  HALL_OF_ERAS,
  MEMORIAL_DOG,
  RELIC_VAULT,
  ROAST_CHEST,
  SANCTUARY_CAMPFIRE,
  SIGNAL_BEACON,
  TROPHY_ARMORY,
  TROPHY_CARDS,
  type BiomeId,
  type GameState,
} from '../data/game-content';

import {
  SPRITE_PALETTE,
  WORLD_OBJECT_SPRITES,
  createSpriteTextureSet,
  drawMatrixFrame,
  type CanvasSourceClassLike,
  type SpriteDirection,
  type SpriteTextureSet,
  type TextureClassLike,
} from './pixel-sprites';

import {
  BIOME_DEFINITIONS,
  GLSL_SKY_FRAGMENT,
  GLSL_SKY_VERTEX,
  WGSL_SKY_SHADER,
  WGSL_SKY_VERTEX,
  WORLD_HEIGHT,
  WORLD_HOTSPOTS,
  WORLD_WIDTH,
  findNearestHotspot,
  getBiomeAtX,
  getBiomeAtmosphereAtX,
  getBiomeById,
  paintSkyFallbackToCanvas2D,
  paintTilemapToCanvas2D,
  paintTilemapToGraphics,
  resolveWorldCollisions,
  type BiomeDefinition,
  type WorldHotspot,
} from './world-biomes';

import { chiptuneAudio } from './chiptune-audio';

export {
  BIOME_DEFINITIONS,
  WGSL_SKY_SHADER,
  WGSL_SKY_VERTEX,
  WORLD_HEIGHT,
  WORLD_HOTSPOTS,
  WORLD_WIDTH,
  getBiomeAtX,
};

/** Compatibility alias for consumers referencing SPEC-020 zone metadata. */
export const OVERWORLD_ZONES = BIOME_DEFINITIONS;

interface DialogueChoice {
  label: string;
  onSelect: () => void;
}

interface DialoguePage {
  title: string;
  speaker: string;
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

interface WorldSpriteEntry {
  hotspot: WorldHotspot;
  sprite: Sprite;
  ring: Graphics;
  y: number;
}

declare global {
  interface Window {
    __RASS_OVERWORLD_DEBUG__?: boolean;
    CharacterDossierTerminal?: {
      open: (tabId?: string) => void;
      close: () => void;
      selectTab: (tabId: string) => void;
    };
  }
}

const PLAYER_WALK_SPEED_PX = 215;
const TYPEWRITER_CHAR_INTERVAL_SEC = 0.022;
const MORALE_TOAST_DURATION_MS = 3800;

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
 * inside an editable input, preventing shortcut hijacking during form entry.
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
 * Compute celestial dayFactor (0 = midnight, 1 = noon) and Sun/Moon arc coordinates
 * synced to visitor local clock or manual Day/Night override.
 */
function computeCelestialState(
  override: 'auto' | 'day' | 'night',
  now: Date = new Date(),
): { dayFactor: number; isDaytime: boolean; normX: number; normY: number; duskBoost: number } {
  if (override === 'day') {
    return { dayFactor: 1.0, isDaytime: true, normX: 0.5, normY: 0.2, duskBoost: 0.08 };
  }
  if (override === 'night') {
    return { dayFactor: 0.0, isDaytime: false, normX: 0.5, normY: 0.2, duskBoost: 0.0 };
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
  const normY = 0.42 - Math.sin(clampedArc * Math.PI) * 0.28;
  const duskBoost = Math.sin(dayFactor * Math.PI) * 0.65;

  return { dayFactor, isDaytime, normX, normY, duskBoost };
}

/**
 * Main controller coordinating PixiJS/Canvas2D rendering, player & party animation,
 * collision & proximity detection, 5-state game FSM, SNES dialogue box, and controls.
 */
export class OverworldController {
  private stageRoot: HTMLElement;
  private canvasHost: HTMLElement;
  private fallbackEl: HTMLElement | null;
  private rendererBadge: HTMLElement | null;
  private zoneLabelEl: HTMLElement | null;
  private gameStateBadgeEl: HTMLElement | null;

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
  private entityContainer: Container | null = null;
  private dynamicFloorGfx: Graphics | null = null;

  private pixiTextures: SpriteTextureSet<Texture> | null = null;
  private canvasTextures: SpriteTextureSet<HTMLCanvasElement> | null = null;

  private borisSprite: Sprite | null = null;
  private dogSprite: Sprite | null = null;
  private rassSprite: Sprite | null = null;
  private devilSprite: Sprite | null = null;
  private worldSprites: WorldSpriteEntry[] = [];
  private campfireSprite: Sprite | null = null;
  private chestSprite: Sprite | null = null;

  // World & party simulation coordinates
  private borisX = BIOME_DEFINITIONS[0].spawnX;
  private borisY = BIOME_DEFINITIONS[0].spawnY;
  private facing: SpriteDirection = 'down';
  private walkAnimPhase = 0;
  private autoWalkTarget: { x: number; y: number; hotspotId?: string } | null = null;

  private dogX = BIOME_DEFINITIONS[0].spawnX - 42;
  private dogY = BIOME_DEFINITIONS[0].spawnY + 12;
  private dogFacingRight = true;
  private dogTrotPhase = 0;

  private rassX = BIOME_DEFINITIONS[0].spawnX - 24;
  private rassY = BIOME_DEFINITIONS[0].spawnY - 40;
  private devilX = BIOME_DEFINITIONS[0].spawnX + 46;
  private devilY = BIOME_DEFINITIONS[0].spawnY - 12;

  private viewWidth = 960;
  private viewHeight = 460;
  private worldScale = 1;
  private camX = 0;

  // Game FSM & Dialogue state
  private gameState: GameState = 'EXPLORING';
  private activeBiomeId: BiomeId = 'sanctuary';
  private nearestHotspot: WorldHotspot | null = null;
  private celestialOverride: 'auto' | 'day' | 'night' = 'auto';
  private motionPaused = false;
  private elapsedSec = 0;

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

  private keysHeld = new Set<string>();
  private dpadHeld = new Set<SpriteDirection>();
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

    this.celestialBtn = stageRoot.querySelector<HTMLButtonElement>('#celestialToggle');
    this.audioBtn = stageRoot.querySelector<HTMLButtonElement>('#audioToggle');
    this.motionBtn = stageRoot.querySelector<HTMLButtonElement>('#motionToggle');
    this.openDossierBtn = stageRoot.querySelector<HTMLButtonElement>('#btnOpenDossier');
    this.roastTriggerBtn =
      stageRoot.querySelector<HTMLButtonElement>('#roastChestTrigger');
    this.dogTriggerBtn =
      stageRoot.querySelector<HTMLButtonElement>('#dogPetTrigger');
    this.btnActionA = stageRoot.querySelector<HTMLButtonElement>('#btnActionA');
    this.btnActionB = stageRoot.querySelector<HTMLButtonElement>('#btnActionB');
    this.btnStartDossier =
      stageRoot.querySelector<HTMLButtonElement>('#btnStartDossier');
    this.btnSelectRoast =
      stageRoot.querySelector<HTMLButtonElement>('#btnSelectRoast');

    this.travelButtons = Array.from(
      stageRoot.querySelectorAll<HTMLButtonElement>('[data-travel-zone]'),
    );
    this.dpadButtons = {
      up: stageRoot.querySelector<HTMLButtonElement>('#dpadUp'),
      down: stageRoot.querySelector<HTMLButtonElement>('#dpadDown'),
      left: stageRoot.querySelector<HTMLButtonElement>('#dpadLeft'),
      right: stageRoot.querySelector<HTMLButtonElement>('#dpadRight'),
    };

    // SnesDialogueBox elements live inside `.overworld-viewport` inside stageRoot
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
  }

  /**
   * Initialize preferences, DOM/keyboard listeners, and PixiJS / Canvas2D stage.
   */
  public async mount(): Promise<void> {
    this.bindMotionPreference();
    this.bindDomControls();
    this.bindDpadControls();
    this.bindKeyboardControls();
    this.bindDossierCloseListener();

    this.setGameState('EXPLORING');
    this.syncBiomeUI(BIOME_DEFINITIONS[0], false);
    this.syncCelestialButtonUI();

    await this.initRenderer();
    debugLog('OverworldController mounted', {
      viewWidth: this.viewWidth,
      viewHeight: this.viewHeight,
      biome: this.activeBiomeId,
      motionPaused: this.motionPaused,
    });
  }

  /**
   * Initialize PixiJS v8 with `preference: 'webgpu'` and `resizeTo: this.canvasHost`,
   * falling back cleanly to WebGL2 and finally native Canvas2D if GPU contexts fail.
   */
  private async initRenderer(): Promise<void> {
    TextureStyle.defaultOptions.scaleMode = 'nearest';
    const rect = this.canvasHost.getBoundingClientRect();
    this.viewWidth = Math.max(280, Math.round(rect.width || 960));
    this.viewHeight = Math.max(160, Math.round(rect.height || 460));

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
    canvas.setAttribute('aria-label', 'Playable 16-bit RPG Overworld canvas');
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
      const dtSec = Math.min(0.05, ticker.deltaMS / 1000);
      this.updateSimulation(dtSec);
      this.syncPixiScene();
    });
  }

  /**
   * Native Canvas2D renderer fallback when neither WebGPU nor WebGL2 is available,
   * reusing `paintSkyFallbackToCanvas2D`, `paintTilemapToCanvas2D`, and `createSpriteTextureSet(null)`.
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
      const dtSec = Math.min(0.05, Math.max(0.001, (nowMs - this.lastRafMs) / 1000));
      this.lastRafMs = nowMs;
      this.updateSimulation(dtSec);
      this.renderCanvas2DFrame();
      this.rafId = requestAnimationFrame(tick);
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
   * Construct PixiJS v8 sky shader mesh, Sun/Moon graphics, 5-biome tilemap,
   * 14 world hotspot sprites, and 4 animated party members.
   */
  private buildPixiSceneGraph(app: Application): void {
    const initialCelestial = computeCelestialState(this.celestialOverride);
    const initialBiome = getBiomeAtX(this.borisX);

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
            initialBiome.skyTintRgb[0],
            initialBiome.skyTintRgb[1],
            initialBiome.skyTintRgb[2],
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
    this.sunGfx.rect(-12, -12, 24, 24).fill(0xfacc15);
    this.sunGfx.rect(-16, -6, 32, 12).fill({ color: 0xf97316, alpha: 0.45 });
    this.sunGfx.rect(-6, -16, 12, 32).fill({ color: 0xf97316, alpha: 0.45 });
    this.sunGfx.rect(-6, -6, 12, 12).fill(0xf4e3c3);
    app.stage.addChild(this.sunGfx);

    this.moonGfx = new Graphics();
    this.moonGfx.rect(-10, -10, 20, 20).fill(0xf4e3c3);
    this.moonGfx.rect(-3, -8, 11, 13).fill(0x090d16);
    this.moonGfx.rect(-14, -4, 4, 4).fill({ color: 0x06b6d4, alpha: 0.8 });
    app.stage.addChild(this.moonGfx);

    // 3. Scrollable 2400x540 World Container
    this.worldContainer = new Container();
    app.stage.addChild(this.worldContainer);

    const tilemapGfx = paintTilemapToGraphics(null, Graphics);
    this.worldContainer.addChild(tilemapGfx);

    this.dynamicFloorGfx = new Graphics();
    this.worldContainer.addChild(this.dynamicFloorGfx);

    this.entityContainer = new Container();
    this.entityContainer.sortableChildren = true;
    this.worldContainer.addChild(this.entityContainer);

    this.pixiTextures = createSpriteTextureSet<Texture>(
      Texture as unknown as TextureClassLike<Texture>,
      {
        pixelSize: 3,
        CanvasSourceClass: CanvasSource as unknown as CanvasSourceClassLike,
      },
    );

    this.buildWorldHotspotSprites(this.entityContainer, this.pixiTextures);
    this.buildPartyPixiSprites(this.entityContainer, this.pixiTextures);
  }

  /**
   * Place static/animated landmark sprites for every fixed world hotspot
   * (`campfire`, `era-0..4`, `relic-0..2`, `trophy-pedestal`, `signal-beacon`, `roast-chest`).
   */
  private buildWorldHotspotSprites(
    parent: Container,
    texSet: SpriteTextureSet<Texture>,
  ): void {
    this.worldSprites = [];

    for (const hotspot of WORLD_HOTSPOTS) {
      // White Dog and RASS/Ms. Devil move with the party rather than fixed monoliths.
      if (hotspot.kind === 'companion') continue;

      let spriteTex: Texture;
      if (hotspot.kind === 'campfire') {
        spriteTex = texSet.worldObjects.campfire[0];
      } else if (hotspot.kind === 'era') {
        spriteTex = texSet.worldObjects.eraObelisk;
      } else if (hotspot.kind === 'relic') {
        spriteTex = texSet.worldObjects.relicPedestal;
      } else if (hotspot.kind === 'trophy') {
        spriteTex = texSet.worldObjects.trophyPedestal;
      } else if (hotspot.kind === 'beacon') {
        spriteTex = texSet.worldObjects.beaconTower;
      } else if (hotspot.kind === 'chest') {
        spriteTex = texSet.worldObjects.roastChest.closed;
      } else {
        // Advisors hologram beacon in Sanctuary
        spriteTex = texSet.rassDrone[0];
      }

      const ring = new Graphics();
      ring.x = hotspot.x;
      ring.y = hotspot.y;
      ring.zIndex = Math.round(hotspot.y) - 2;
      parent.addChild(ring);

      const sprite = new Sprite(spriteTex);
      sprite.anchor.set(0.5, 0.85);
      sprite.x = hotspot.x;
      sprite.y = hotspot.y;
      sprite.zIndex = Math.round(hotspot.y);
      parent.addChild(sprite);

      if (hotspot.kind === 'campfire') this.campfireSprite = sprite;
      if (hotspot.kind === 'chest') this.chestSprite = sprite;
      if (hotspot.kind === 'advisors') {
        // Render Sanctuary telemetry relay badge distinctly from the traveling RASS drone.
        sprite.scale.set(0.75);
        sprite.alpha = 0.82;
      }

      const labelTag = new Text({
        text: this.getShortHotspotTag(hotspot),
        style: {
          fontFamily: '"Press Start 2P", monospace',
          fontSize: 7,
          fill: '#F4E3C3',
          stroke: { color: '#090d16', width: 3 },
        },
      });
      labelTag.anchor.set(0.5, 1);
      labelTag.x = hotspot.x;
      labelTag.y = hotspot.y - 46;
      labelTag.zIndex = Math.round(hotspot.y) + 4;
      parent.addChild(labelTag);

      this.worldSprites.push({ hotspot, sprite, ring, y: hotspot.y });
    }
  }

  private getShortHotspotTag(hotspot: WorldHotspot): string {
    if (hotspot.kind === 'campfire') return 'CAMPFIRE';
    if (hotspot.kind === 'advisors') return 'ADVISORS';
    if (hotspot.kind === 'chest') return 'CHEST [R]';
    if (hotspot.kind === 'era') return `ERA ${(hotspot.itemIndex ?? 0) + 1}`;
    if (hotspot.kind === 'relic') {
      return hotspot.itemIndex === 0
        ? 'KIDSLAB'
        : hotspot.itemIndex === 1
          ? 'INFUSIO'
          : 'CAMP DAVID';
    }
    if (hotspot.kind === 'trophy') return '21 TROPHIES';
    if (hotspot.kind === 'beacon') return 'SIGNAL';
    return hotspot.label.toUpperCase();
  }

  private buildPartyPixiSprites(
    parent: Container,
    texSet: SpriteTextureSet<Texture>,
  ): void {
    this.borisSprite = new Sprite(texSet.boris.down[0]);
    this.borisSprite.anchor.set(0.5, 0.88);
    parent.addChild(this.borisSprite);

    this.dogSprite = new Sprite(texSet.whiteDog[0]);
    this.dogSprite.anchor.set(0.5, 0.88);
    parent.addChild(this.dogSprite);

    this.rassSprite = new Sprite(texSet.rassDrone[0]);
    this.rassSprite.anchor.set(0.5, 0.88);
    parent.addChild(this.rassSprite);

    this.devilSprite = new Sprite(texSet.msDevil[0]);
    this.devilSprite.anchor.set(0.5, 0.88);
    parent.addChild(this.devilSprite);
  }

  /**
   * Enable unified click/tap-to-walk on the game canvas across WebGPU, WebGL2, and Canvas2D,
   * prioritizing clickable party companions (`white-dog`, `rass`, `ms-devil`) and world hotspots.
   */
  private bindCanvasPointerWalk(canvas: HTMLCanvasElement): void {
    const onPointerDown = (event: PointerEvent) => {
      if (this.gameState !== 'EXPLORING') return;
      if (event.button !== 0 && event.pointerType === 'mouse') return;
      chiptuneAudio.unlock();

      const rect = canvas.getBoundingClientRect();
      const localX = event.clientX - rect.left;
      const localY = event.clientY - rect.top;
      const offsetY = Math.round((this.viewHeight - WORLD_HEIGHT * this.worldScale) * 0.5);

      const worldX = localX / this.worldScale + this.camX;
      const worldY = (localY - offsetY) / this.worldScale;

      // 1. Direct tap on the White Dog companion sprite
      if (Math.hypot(worldX - this.dogX, worldY - (this.dogY - 14)) <= 32) {
        this.triggerWhiteDogMemorial();
        return;
      }

      // 2. Direct tap on hovering RASS Drone or Ms. Devil advisors
      if (
        Math.hypot(worldX - this.rassX, worldY - (this.rassY - 14)) <= 28 ||
        Math.hypot(worldX - this.devilX, worldY - (this.devilY - 14)) <= 28
      ) {
        this.openCompanionDronesDialogue();
        return;
      }

      // 3. Direct tap on a fixed world hotspot monument/chest/campfire
      for (const hotspot of WORLD_HOTSPOTS) {
        if (hotspot.kind === 'companion') continue;
        if (Math.hypot(worldX - hotspot.x, worldY - (hotspot.y - 14)) <= Math.max(36, hotspot.radius * 0.65)) {
          this.handleHotspotClick(hotspot);
          return;
        }
      }

      // 4. Walk Boris smoothly toward clicked ground coordinate
      const clamped = resolveWorldCollisions(worldX, worldY, 14);
      if (this.motionPaused) {
        this.moveBorisImmediately(clamped.x, clamped.y);
      } else {
        this.autoWalkTarget = { x: clamped.x, y: clamped.y };
      }
      debugLog('Canvas click-to-walk target', clamped);
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    this.cleanups.push(() => canvas.removeEventListener('pointerdown', onPointerDown));
  }

  private handleHotspotClick(hotspot: WorldHotspot): void {
    if (this.gameState !== 'EXPLORING') return;
    const dist = Math.hypot(this.borisX - hotspot.x, this.borisY - hotspot.y);
    if (dist <= hotspot.radius + 10 || this.motionPaused) {
      if (this.motionPaused && dist > hotspot.radius) {
        const approach = resolveWorldCollisions(hotspot.x, hotspot.y + 28, 14);
        this.moveBorisImmediately(approach.x, approach.y);
      }
      this.interactWithHotspot(hotspot);
    } else {
      // Walk to the southern approach edge of the hotspot and auto-trigger on arrival.
      const approach = resolveWorldCollisions(hotspot.x, hotspot.y + 28, 14);
      this.autoWalkTarget = { x: approach.x, y: approach.y, hotspotId: hotspot.id };
    }
  }

  private startResizeObserver(): void {
    if (typeof ResizeObserver === 'undefined') return;
    this.resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const nextW = Math.max(280, Math.round(entry.contentRect.width));
      const nextH = Math.max(160, Math.round(entry.contentRect.height));
      if (nextW === this.viewWidth && nextH === this.viewHeight) return;
      this.layoutViewport(nextW, nextH);
    });
    this.resizeObserver.observe(this.canvasHost);
  }

  private layoutViewport(width: number, height: number): void {
    this.viewWidth = width;
    this.viewHeight = height;
    this.worldScale = Math.max(0.5, Math.min(1.65, height / WORLD_HEIGHT));

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
      this.worldContainer.y = Math.round((height - WORLD_HEIGHT * this.worldScale) * 0.5);
    }

    this.drawPixiSkyFallback(width, height);
    this.snapCameraToBoris();
  }

  private drawPixiSkyFallback(width: number, height: number): void {
    if (!this.skyFallbackGfx) return;
    const { dayFactor } = computeCelestialState(this.celestialOverride);
    const bands = 14;
    const bandH = Math.ceil(height / bands);
    this.skyFallbackGfx.clear();
    for (let i = 0; i < bands; i += 1) {
      const t = i / (bands - 1);
      const r = Math.round((9 + t * 18) * (1 - dayFactor) + (29 + t * 78) * dayFactor);
      const g = Math.round((13 + t * 24) * (1 - dayFactor) + (78 + t * 123) * dayFactor);
      const b = Math.round((22 + t * 48) * (1 - dayFactor) + (140 + t * 102) * dayFactor);
      this.skyFallbackGfx.rect(0, i * bandH, width, bandH + 1).fill((r << 16) | (g << 8) | b);
    }
  }

  private snapCameraToBoris(): void {
    const visibleWorldW = this.viewWidth / Math.max(0.25, this.worldScale);
    const maxCamX = Math.max(0, WORLD_WIDTH - visibleWorldW);
    this.camX = Math.max(0, Math.min(maxCamX, this.borisX - visibleWorldW * 0.5));
  }

  private moveBorisImmediately(x: number, y: number): void {
    const resolved = resolveWorldCollisions(x, y, 14);
    this.borisX = resolved.x;
    this.borisY = resolved.y;
    this.autoWalkTarget = null;
    this.snapCameraToBoris();
  }

  /**
   * Advance game simulation frame: sky cycle, Boris movement, companion follow AI,
   * hotspot proximity detection, typewriter dialogue cadence, and particle timers.
   */
  private updateSimulation(dtSec: number): void {
    if (!this.motionPaused) {
      this.elapsedSec += dtSec;
    }

    // 1. Movement & Exploration physics
    if (this.gameState === 'EXPLORING') {
      this.updatePlayerMovement(dtSec);
      this.updateProximityDetection();
    } else if (this.interactionPromptBtn) {
      this.interactionPromptBtn.hidden = true;
    }

    // 2. Smooth camera tracking centered on Boris
    const visibleWorldW = this.viewWidth / Math.max(0.25, this.worldScale);
    const maxCamX = Math.max(0, WORLD_WIDTH - visibleWorldW);
    const desiredCamX = Math.max(0, Math.min(maxCamX, this.borisX - visibleWorldW * 0.5));
    if (this.motionPaused) {
      this.camX = desiredCamX;
    } else {
      this.camX += (desiredCamX - this.camX) * Math.min(1, dtSec * 8.5);
    }

    // 3. Companion follow simulation (White Dog, RASS Drone, Ms. Devil)
    this.updateCompanions(dtSec);

    // 4. Chest open reset timer
    if (this.chestOpenTimer > 0) {
      this.chestOpenTimer -= dtSec;
      if (this.chestOpenTimer <= 0 && this.chestSprite && this.pixiTextures) {
        this.chestSprite.texture = this.pixiTextures.worldObjects.roastChest.closed;
      }
    }

    // 5. Floating heart particle lifetimes
    for (let i = this.heartParticles.length - 1; i >= 0; i -= 1) {
      const p = this.heartParticles[i];
      p.age += dtSec;
      p.y = p.startY - p.age * 32;
      if (p.sprite) {
        p.sprite.y = p.y;
        p.sprite.alpha = Math.max(0, 1 - p.age / 1.2);
      }
      if (p.age >= 1.2) {
        p.sprite?.destroy();
        this.heartParticles.splice(i, 1);
      }
    }

    // 6. Typewriter dialogue reveal
    this.updateTypewriter(dtSec);
  }

  private updatePlayerMovement(dtSec: number): void {
    let moveX =
      (this.keysHeld.has('KeyD') || this.keysHeld.has('ArrowRight') || this.dpadHeld.has('right') ? 1 : 0) -
      (this.keysHeld.has('KeyA') || this.keysHeld.has('ArrowLeft') || this.dpadHeld.has('left') ? 1 : 0);
    let moveY =
      (this.keysHeld.has('KeyS') || this.keysHeld.has('ArrowDown') || this.dpadHeld.has('down') ? 1 : 0) -
      (this.keysHeld.has('KeyW') || this.keysHeld.has('ArrowUp') || this.dpadHeld.has('up') ? 1 : 0);

    if (moveX !== 0 || moveY !== 0) {
      // Manual input cancels any pending click-to-walk target.
      this.autoWalkTarget = null;
      const len = Math.hypot(moveX, moveY);
      moveX /= len;
      moveY /= len;
    } else if (this.autoWalkTarget) {
      const dx = this.autoWalkTarget.x - this.borisX;
      const dy = this.autoWalkTarget.y - this.borisY;
      const dist = Math.hypot(dx, dy);
      if (dist <= 8) {
        const pendingHotspotId = this.autoWalkTarget.hotspotId;
        this.autoWalkTarget = null;
        if (pendingHotspotId) {
          const targetHotspot = WORLD_HOTSPOTS.find((h) => h.id === pendingHotspotId);
          if (targetHotspot) this.interactWithHotspot(targetHotspot);
        }
        this.walkAnimPhase = 0;
        return;
      }
      moveX = dx / dist;
      moveY = dy / dist;
    }

    if (moveX === 0 && moveY === 0) {
      this.walkAnimPhase = 0;
      return;
    }

    if (Math.abs(moveX) >= Math.abs(moveY)) {
      this.facing = moveX > 0 ? 'right' : 'left';
    } else {
      this.facing = moveY > 0 ? 'down' : 'up';
    }

    const stepDist = PLAYER_WALK_SPEED_PX * dtSec;
    const resolved = resolveWorldCollisions(
      this.borisX + moveX * stepDist,
      this.borisY + moveY * stepDist,
      14,
    );
    this.borisX = resolved.x;
    this.borisY = resolved.y;
    this.walkAnimPhase = this.motionPaused ? 0 : (this.walkAnimPhase + dtSec * 9.5) % 4;
    chiptuneAudio.playStep();

    const currentBiome = getBiomeAtX(this.borisX);
    if (currentBiome.id !== this.activeBiomeId) {
      this.syncBiomeUI(currentBiome, true);
    }
  }

  private updateCompanions(dtSec: number): void {
    // White Dog trails behind Boris based on facing direction.
    const behindX =
      this.facing === 'left'
        ? this.borisX + 42
        : this.facing === 'right'
          ? this.borisX - 42
          : this.borisX - 36;
    const behindY =
      this.facing === 'up'
        ? this.borisY + 28
        : this.facing === 'down'
          ? this.borisY - 12
          : this.borisY + 12;
    const targetDog = resolveWorldCollisions(behindX, behindY, 0);
    const dx = targetDog.x - this.dogX;
    const dy = targetDog.y - this.dogY;
    const dist = Math.hypot(dx, dy);

    if (dist > 4) {
      const followRate = this.motionPaused ? 1 : Math.min(1, dtSec * 5.2);
      this.dogX += dx * followRate;
      this.dogY += dy * followRate;
      if (Math.abs(dx) > 1.5) this.dogFacingRight = dx >= 0;
      this.dogTrotPhase = this.motionPaused ? 0 : (this.dogTrotPhase + dtSec * 9) % 4;
    } else {
      this.dogFacingRight = this.facing !== 'left';
      // Gentle idle tail wag through the 4-frame dog sprite sheet when motion is active.
      this.dogTrotPhase = this.motionPaused ? 0 : (this.dogTrotPhase + dtSec * 2.5) % 4;
    }

    // RASS Drone hovers over Boris's trailing shoulder; Ms. Devil darts playfully ahead.
    const hoverBob = this.motionPaused ? 0 : Math.sin(this.elapsedSec * 3.6) * 4;
    const devilDartX = this.motionPaused ? 0 : Math.sin(this.elapsedSec * 2.6) * 10;
    const devilDartY = this.motionPaused ? 0 : Math.cos(this.elapsedSec * 4.4) * 5;

    this.rassX = this.borisX + (this.facing === 'left' ? 24 : -24);
    this.rassY = this.borisY - 38 + hoverBob;
    this.devilX = this.borisX + (this.facing === 'left' ? -44 : 44) + devilDartX;
    this.devilY = this.borisY - 14 + devilDartY;
  }

  private updateProximityDetection(): void {
    // Keep white-dog far out of static hotspot scan unless Boris approaches Sanctuary Shrine;
    // White Dog always follows Boris and responds directly to [B], #dogPetTrigger, or sprite tap.
    const result = findNearestHotspot(this.borisX, this.borisY, {
      'white-dog': { x: -9999, y: -9999 },
    });
    const next = result?.hotspot ?? null;
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
   * Sync PixiJS scene graph nodes with current simulation state each tick.
   */
  private syncPixiScene(): void {
    if (!this.app) return;

    const celestial = computeCelestialState(this.celestialOverride);
    const atmosphere = getBiomeAtmosphereAtX(this.borisX);

    if (this.skyUniforms) {
      const skyArr = this.skyUniforms.uniforms.uSkyState as Float32Array;
      skyArr[0] = celestial.dayFactor;
      skyArr[1] = this.elapsedSec;
      skyArr[2] = celestial.normX;
      skyArr[3] = celestial.normY;

      const biomeArr = this.skyUniforms.uniforms.uBiomeAtmosphere as Float32Array;
      biomeArr[0] = atmosphere.tintRgb[0];
      biomeArr[1] = atmosphere.tintRgb[1];
      biomeArr[2] = atmosphere.tintRgb[2];
      biomeArr[3] = celestial.duskBoost;
      this.skyUniforms.update();
    }

    const cx = celestial.normX * this.viewWidth;
    const cy = celestial.normY * this.viewHeight;
    if (this.sunGfx) {
      this.sunGfx.visible = celestial.dayFactor > 0.2;
      this.sunGfx.alpha = Math.min(1, celestial.dayFactor * 1.25);
      this.sunGfx.x = cx;
      this.sunGfx.y = cy;
    }
    if (this.moonGfx) {
      this.moonGfx.visible = celestial.dayFactor < 0.8;
      this.moonGfx.alpha = Math.min(1, (1 - celestial.dayFactor) * 1.25);
      this.moonGfx.x = cx;
      this.moonGfx.y = cy;
    }

    if (this.worldContainer) {
      this.worldContainer.x = -Math.round(this.camX * this.worldScale);
    }

    // Animated Cyber-Forge magma shimmer & hotspot proximity rings
    if (this.dynamicFloorGfx && !this.motionPaused) {
      const pulse = 0.25 + Math.sin(this.elapsedSec * 4.5) * 0.14;
      this.dynamicFloorGfx.clear();
      this.dynamicFloorGfx.rect(1008, 245, 384, 5).fill({ color: 0xfacc15, alpha: pulse });
      this.dynamicFloorGfx.rect(1008, 429, 384, 5).fill({ color: 0xfacc15, alpha: pulse });
    }

    if (this.pixiTextures) {
      if (this.campfireSprite) {
        const fireIdx = this.motionPaused ? 0 : Math.floor(this.elapsedSec * 7) % 3;
        this.campfireSprite.texture = this.pixiTextures.worldObjects.campfire[fireIdx];
      }

      for (const entry of this.worldSprites) {
        const isActive = this.nearestHotspot?.id === entry.hotspot.id;
        entry.ring.clear();
        if (isActive) {
          const glowAlpha = this.motionPaused ? 0.65 : 0.45 + Math.sin(this.elapsedSec * 6) * 0.25;
          entry.ring
            .rect(-24, -10, 48, 20)
            .fill({ color: 0xfacc15, alpha: glowAlpha * 0.28 });
          entry.ring
            .rect(-24, -10, 48, 2)
            .fill({ color: 0xfacc15, alpha: glowAlpha });
          entry.ring
            .rect(-24, 8, 48, 2)
            .fill({ color: 0xfacc15, alpha: glowAlpha });
        }
      }

      const borisIdx = Math.floor(this.walkAnimPhase) % 4;
      if (this.borisSprite) {
        this.borisSprite.texture = this.pixiTextures.boris[this.facing][borisIdx];
        this.borisSprite.x = Math.round(this.borisX);
        this.borisSprite.y = Math.round(this.borisY);
        this.borisSprite.zIndex = Math.round(this.borisY);
      }

      const dogIdx = Math.floor(this.dogTrotPhase) % 4;
      if (this.dogSprite) {
        this.dogSprite.texture = this.pixiTextures.whiteDog[dogIdx];
        this.dogSprite.x = Math.round(this.dogX);
        this.dogSprite.y = Math.round(this.dogY);
        this.dogSprite.zIndex = Math.round(this.dogY);
        this.dogSprite.scale.x = this.dogFacingRight ? 1 : -1;
      }

      const droneIdx = this.motionPaused ? 0 : Math.floor(this.elapsedSec * 6) % 2;
      if (this.rassSprite) {
        this.rassSprite.texture = this.pixiTextures.rassDrone[droneIdx];
        this.rassSprite.x = Math.round(this.rassX);
        this.rassSprite.y = Math.round(this.rassY);
        this.rassSprite.zIndex = Math.round(this.borisY) + 12;
      }

      const devilIdx = this.motionPaused ? 0 : Math.floor(this.elapsedSec * 7.5) % 2;
      if (this.devilSprite) {
        this.devilSprite.texture = this.pixiTextures.msDevil[devilIdx];
        this.devilSprite.x = Math.round(this.devilX);
        this.devilSprite.y = Math.round(this.devilY);
        this.devilSprite.zIndex = Math.round(this.borisY) + 12;
      }
    }
  }

  /**
   * Software Canvas2D frame renderer mirroring the PixiJS scene graph cleanly.
   */
  private renderCanvas2DFrame(): void {
    const ctx = this.canvas2dCtx;
    if (!ctx || !this.canvasTextures) return;

    const celestial = computeCelestialState(this.celestialOverride);
    const atmosphere = getBiomeAtmosphereAtX(this.borisX);

    ctx.imageSmoothingEnabled = false;
    paintSkyFallbackToCanvas2D(
      ctx,
      this.viewWidth,
      this.viewHeight,
      celestial.dayFactor,
      celestial.normX,
      celestial.normY,
      atmosphere.tintRgb,
      this.elapsedSec,
    );

    const offsetY = Math.round((this.viewHeight - WORLD_HEIGHT * this.worldScale) * 0.5);
    const viewStartX = Math.max(0, this.camX - 48);
    const viewEndX = Math.min(WORLD_WIDTH, this.camX + this.viewWidth / this.worldScale + 48);

    ctx.save();
    ctx.translate(-Math.round(this.camX * this.worldScale), offsetY);
    ctx.scale(this.worldScale, this.worldScale);

    paintTilemapToCanvas2D(ctx, this.elapsedSec, viewStartX, viewEndX);

    // Depth-sort fixed landmarks + party members by Y for clean SNES RPG layering.
    type RenderItem = { y: number; draw: () => void };
    const items: RenderItem[] = [];

    for (const hotspot of WORLD_HOTSPOTS) {
      if (hotspot.kind === 'companion') continue;
      if (hotspot.x < viewStartX - 64 || hotspot.x > viewEndX + 64) continue;

      items.push({
        y: hotspot.y,
        draw: () => {
          if (this.nearestHotspot?.id === hotspot.id) {
            ctx.strokeStyle = '#facc15';
            ctx.lineWidth = 2;
            ctx.strokeRect(hotspot.x - 24, hotspot.y - 10, 48, 20);
          }

          let frame: HTMLCanvasElement;
          if (hotspot.kind === 'campfire') {
            const idx = this.motionPaused ? 0 : Math.floor(this.elapsedSec * 7) % 3;
            frame = this.canvasTextures!.worldObjects.campfire[idx];
          } else if (hotspot.kind === 'era') {
            frame = this.canvasTextures!.worldObjects.eraObelisk;
          } else if (hotspot.kind === 'relic') {
            frame = this.canvasTextures!.worldObjects.relicPedestal;
          } else if (hotspot.kind === 'trophy') {
            frame = this.canvasTextures!.worldObjects.trophyPedestal;
          } else if (hotspot.kind === 'beacon') {
            frame = this.canvasTextures!.worldObjects.beaconTower;
          } else if (hotspot.kind === 'chest') {
            frame =
              this.chestOpenTimer > 0
                ? this.canvasTextures!.worldObjects.roastChest.open
                : this.canvasTextures!.worldObjects.roastChest.closed;
          } else {
            frame = this.canvasTextures!.rassDrone[0];
          }
          ctx.drawImage(frame, Math.round(hotspot.x - frame.width * 0.5), Math.round(hotspot.y - frame.height * 0.85));
        },
      });
    }

    const borisFrame = this.canvasTextures.boris[this.facing][Math.floor(this.walkAnimPhase) % 4];
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

    const dogFrame = this.canvasTextures.whiteDog[Math.floor(this.dogTrotPhase) % 4];
    items.push({
      y: this.dogY,
      draw: () => {
        ctx.save();
        ctx.translate(Math.round(this.dogX), Math.round(this.dogY));
        if (!this.dogFacingRight) ctx.scale(-1, 1);
        ctx.drawImage(dogFrame, -Math.round(dogFrame.width * 0.5), -Math.round(dogFrame.height * 0.88));
        ctx.restore();
      },
    });

    const droneFrame =
      this.canvasTextures.rassDrone[this.motionPaused ? 0 : Math.floor(this.elapsedSec * 6) % 2];
    items.push({
      y: this.borisY + 12,
      draw: () => {
        ctx.drawImage(
          droneFrame,
          Math.round(this.rassX - droneFrame.width * 0.5),
          Math.round(this.rassY - droneFrame.height * 0.88),
        );
      },
    });

    const devilFrame =
      this.canvasTextures.msDevil[this.motionPaused ? 0 : Math.floor(this.elapsedSec * 7.5) % 2];
    items.push({
      y: this.borisY + 12,
      draw: () => {
        ctx.drawImage(
          devilFrame,
          Math.round(this.devilX - devilFrame.width * 0.5),
          Math.round(this.devilY - devilFrame.height * 0.88),
        );
      },
    });

    items.sort((a, b) => a.y - b.y);
    for (const item of items) item.draw();

    // Floating heart particles
    for (const p of this.heartParticles) {
      ctx.save();
      ctx.globalAlpha = Math.max(0, 1 - p.age / 1.2);
      drawMatrixFrame(ctx, WORLD_OBJECT_SPRITES.heart, SPRITE_PALETTE, p.x - 12, p.y - 24, 2);
      ctx.restore();
    }

    ctx.restore();
  }

  // ============================================================================
  // Game Finite State Machine (5 States) & Dialogue / Inspector Builders
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
    if (this.interactionPromptBtn) {
      this.interactionPromptBtn.hidden =
        nextState !== 'EXPLORING' || !this.nearestHotspot;
    }

    if (prevState !== nextState) {
      debugLog('FSM state transition', { from: prevState, to: nextState });
    }
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

    if (this.continueBtn) {
      const hasMore = this.dialoguePageIndex < this.dialogueQueue.length - 1;
      this.continueBtn.textContent = hasMore
        ? 'Next [SPACE / ENTER]'
        : 'Continue [SPACE / ENTER]';
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
    if (this.gameState === 'EXPLORING') return;
    if (playCancelAudio) chiptuneAudio.playCancel();
    this.dialogueQueue = [];
    this.dialoguePageIndex = 0;
    this.typewriterFullText = '';
    this.typewriterShownChars = 0;
    this.setGameState('EXPLORING');
  }

  private interactWithHotspot(hotspot: WorldHotspot): void {
    chiptuneAudio.playConfirm();
    switch (hotspot.kind) {
      case 'campfire':
        this.openSanctuaryCampfire();
        break;
      case 'companion':
        this.triggerWhiteDogMemorial();
        break;
      case 'advisors':
        this.openCompanionDronesDialogue();
        break;
      case 'chest':
        this.triggerRoastChest();
        break;
      case 'era':
        this.openEraInspector(hotspot.itemIndex ?? 0);
        break;
      case 'relic':
        this.openRelicInspector(hotspot.itemIndex ?? 0);
        break;
      case 'trophy':
        this.openTrophyInspector(this.activeTrophyIndex);
        break;
      case 'beacon':
        this.openSignalBeacon();
        break;
    }
  }

  private openBiomeWelcome(biomeId: BiomeId): void {
    if (biomeId === 'sanctuary') {
      this.openSanctuaryCampfire();
    } else if (biomeId === 'eras') {
      this.openEraInspector(0);
    } else if (biomeId === 'relics') {
      this.openRelicInspector(0);
    } else if (biomeId === 'trophies') {
      this.openTrophyInspector(0);
    } else {
      this.openSignalBeacon();
    }
  }

  /**
   * Sanctuary Campfire welcome dialogue with branching Dossier / Dog / Roast choices.
   */
  public openSanctuaryCampfire(): void {
    this.openDialoguePages('DIALOGUE', [
      {
        title: SANCTUARY_CAMPFIRE.title,
        speaker: SANCTUARY_CAMPFIRE.speaker,
        text: SANCTUARY_CAMPFIRE.text,
        pitchOffsetHz: -30,
        choices: [
          {
            label: SANCTUARY_CAMPFIRE.choices[0],
            onSelect: () => this.openCharacterDossier('status'),
          },
          {
            label: SANCTUARY_CAMPFIRE.choices[1],
            onSelect: () => this.triggerWhiteDogMemorial(),
          },
          {
            label: SANCTUARY_CAMPFIRE.choices[2],
            onSelect: () => this.triggerRoastChest(),
          },
        ],
      },
    ]);
  }

  /**
   * Two-page banter between RASS Drone and Ms. Devil.
   */
  public openCompanionDronesDialogue(): void {
    this.openDialoguePages('DIALOGUE', [
      {
        title: COMPANION_DRONES.title,
        speaker: COMPANION_DRONES.speakers[0].name,
        text: COMPANION_DRONES.speakers[0].text,
        pitchOffsetHz: 90,
      },
      {
        title: COMPANION_DRONES.title,
        speaker: COMPANION_DRONES.speakers[1].name,
        text: COMPANION_DRONES.speakers[1].text,
        pitchOffsetHz: 150,
        choices: [
          {
            label: 'Inspect Relic Vault',
            onSelect: () => {
              const relicBiome = getBiomeById('relics');
              this.moveBorisImmediately(relicBiome.spawnX, relicBiome.spawnY);
              this.syncBiomeUI(relicBiome, true);
              this.openRelicInspector(0);
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
   * Hall of Eras 5-obelisk inspector inside SNES dialogue overlay.
   */
  public openEraInspector(index: number): void {
    const safeIdx = ((index % HALL_OF_ERAS.length) + HALL_OF_ERAS.length) % HALL_OF_ERAS.length;
    this.activeEraIndex = safeIdx;
    const era = HALL_OF_ERAS[safeIdx];

    this.openDialoguePages('INSPECT_RELIC', [
      {
        title: `HALL OF ERAS · ${era.year}`,
        speaker: era.era,
        text: era.lore,
        pitchOffsetHz: -50,
        inspectorBuilder: (container) => {
          const meta = document.createElement('div');
          meta.className = 'snes-inspector-meta';

          const eraBadge = document.createElement('span');
          eraBadge.className = 'snes-inspector-badge snes-inspector-badge--purple';
          eraBadge.textContent = `OBELISK ${safeIdx + 1} / ${HALL_OF_ERAS.length}`;

          const yearBadge = document.createElement('span');
          yearBadge.className = 'snes-inspector-badge snes-inspector-badge--gold';
          yearBadge.textContent = era.year;

          meta.append(eraBadge, yearBadge);

          const actions = document.createElement('div');
          actions.className = 'snes-inspector-actions';

          const dossierLink = document.createElement('button');
          dossierLink.type = 'button';
          dossierLink.className = 'snes-nav-btn';
          dossierLink.textContent = 'Open Full Timeline in Dossier';
          dossierLink.addEventListener('click', () => this.openCharacterDossier('eras'));
          actions.appendChild(dossierLink);

          container.append(meta, actions);
        },
        choices: [
          {
            label: '< Prev Era',
            onSelect: () => this.openEraInspector(safeIdx - 1),
          },
          {
            label: 'Next Era >',
            onSelect: () => this.openEraInspector(safeIdx + 1),
          },
        ],
      },
    ]);
  }

  /**
   * Cyber-Forge Relic Vault inspector (KidsLab 3.0, Infusio, Camp David).
   */
  public openRelicInspector(index: number): void {
    const safeIdx = ((index % RELIC_VAULT.length) + RELIC_VAULT.length) % RELIC_VAULT.length;
    this.activeRelicIndex = safeIdx;
    const relic = RELIC_VAULT[safeIdx];

    this.openDialoguePages('INSPECT_RELIC', [
      {
        title: `RELIC VAULT · ${relic.name.toUpperCase()}`,
        speaker: `Cyber-Forge Pedestal (${safeIdx + 1}/${RELIC_VAULT.length})`,
        text: relic.lore,
        pitchOffsetHz: 20,
        inspectorBuilder: (container) => {
          const meta = document.createElement('div');
          meta.className = 'snes-inspector-meta';

          const catBadge = document.createElement('span');
          catBadge.className = 'snes-inspector-badge snes-inspector-badge--copper';
          catBadge.textContent = relic.category;
          meta.appendChild(catBadge);

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
          dossierBtn.textContent = 'Open Relic Vault in Dossier';
          dossierBtn.addEventListener('click', () => this.openCharacterDossier('relics'));

          actions.append(link, dossierBtn);
          container.append(meta, statsLine, actions);
        },
        choices: [
          {
            label: '< Prev Relic',
            onSelect: () => this.openRelicInspector(safeIdx - 1),
          },
          {
            label: 'Next Relic >',
            onSelect: () => this.openRelicInspector(safeIdx + 1),
          },
        ],
      },
    ]);
  }

  /**
   * Interactive 21-card Trophy Armory mini-carousel inside `#snesInspectorContent`.
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
        text: TROPHY_ARMORY.lore_intro,
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

          meta.append(numBadge, rarityBadge, statusBadge);

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
   * Mountain Signal Beacon transmission channels (Email, WhatsApp, Cal.com).
   */
  public openSignalBeacon(): void {
    this.openDialoguePages('INSPECT_RELIC', [
      {
        title: SIGNAL_BEACON.title,
        speaker: SIGNAL_BEACON.speaker,
        text: SIGNAL_BEACON.text,
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
      },
    ]);
  }

  /**
   * Transition cleanly into `CHARACTER_SHEET` and open native `<dialog id="characterDossierModal">`.
   */
  public openCharacterDossier(tabId = 'status'): void {
    chiptuneAudio.playConfirm();
    this.keysHeld.clear();
    this.dpadHeld.clear();

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
   * Trigger White Dog memorial tribute (`MEMORIAL_DOG`), 8-bit bark chime,
   * pixel heart bubble over White Dog, and `+10 Morale Restored` toast.
   */
  public triggerWhiteDogMemorial(): void {
    chiptuneAudio.playBarkChime();
    this.spawnHeartParticle();
    this.showMoraleToast(MEMORIAL_DOG.effect);

    this.openDialoguePages('DIALOGUE', [
      {
        title: MEMORIAL_DOG.title,
        speaker: MEMORIAL_DOG.speaker,
        text: MEMORIAL_DOG.text,
        pitchOffsetHz: 110,
        inspectorBuilder: (container) => {
          const meta = document.createElement('div');
          meta.className = 'snes-inspector-meta';

          const effectPill = document.createElement('span');
          effectPill.className = 'snes-inspector-badge snes-inspector-badge--gold';
          effectPill.textContent = MEMORIAL_DOG.effect;
          meta.appendChild(effectPill);

          container.appendChild(meta);
        },
      },
    ]);
    debugLog('White Dog memorial triggered (Emy, Kiba, Yue).');
  }

  private spawnHeartParticle(): void {
    const startY = this.dogY - 38;
    const particle: HeartParticle = {
      x: this.dogX,
      y: startY,
      startY,
      age: 0,
    };

    if (this.entityContainer && this.pixiTextures) {
      const sprite = new Sprite(this.pixiTextures.worldObjects.heart);
      sprite.anchor.set(0.5, 1);
      sprite.x = particle.x;
      sprite.y = particle.y;
      sprite.zIndex = Math.round(this.dogY) + 20;
      this.entityContainer.addChild(sprite);
      particle.sprite = sprite;
    }

    this.heartParticles.push(particle);
  }

  private showMoraleToast(message: string): void {
    if (this.moraleToastTextEl) {
      this.moraleToastTextEl.textContent = message;
    }
    if (this.liveRegionEl) {
      this.liveRegionEl.textContent = '';
      // Queue microtask so screen readers announce repeated pets cleanly.
      queueMicrotask(() => {
        if (this.liveRegionEl) this.liveRegionEl.textContent = message;
      });
    }
    const docWithNotify = document as Document & { ariaNotify?: (text: string) => void };
    if (typeof docWithNotify.ariaNotify === 'function') {
      docWithNotify.ariaNotify(message);
    }

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
   * play 4-note RPG fanfare, and display one of 3 verbatim drops + burned verdict.
   */
  public triggerRoastChest(): void {
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
   * Warp/walk Boris to a biome center (`1`..`5` or `[data-travel-zone]`) and
   * open that biome's welcome / inspection dialogue.
   */
  public fastTravelTo(biomeIndex: number, openDialogue = true): void {
    const safeIdx = Math.max(0, Math.min(BIOME_DEFINITIONS.length - 1, biomeIndex));
    const biome = BIOME_DEFINITIONS[safeIdx];

    this.moveBorisImmediately(biome.spawnX, biome.spawnY);
    this.dogX = biome.spawnX - 38;
    this.dogY = biome.spawnY + 10;
    this.facing = 'down';
    this.syncBiomeUI(biome, true);

    if (openDialogue) {
      this.openBiomeWelcome(biome.id);
    }
    debugLog('Fast-travel activated', { biome: biome.id, x: biome.spawnX, y: biome.spawnY });
  }

  private syncBiomeUI(biome: BiomeDefinition, playChime: boolean): void {
    this.activeBiomeId = biome.id;
    this.stageRoot.dataset.zoneActive = biome.id;

    const meta = BIOME_LIST.find((b) => b.id === biome.id);
    if (this.zoneLabelEl) {
      this.zoneLabelEl.textContent = meta ? meta.name : `${biome.index + 1}. ${biome.name}`;
    }

    for (const btn of this.travelButtons) {
      const isActive = btn.dataset.travelZone === biome.id;
      btn.classList.toggle('is-active', isActive);
      if (isActive) {
        btn.setAttribute('aria-current', 'true');
      } else {
        btn.removeAttribute('aria-current');
      }
    }

    if (playChime) {
      chiptuneAudio.playZoneChime(biome.index);
    }
  }

  // ============================================================================
  // Preferences, DOM Controls, GBA Deck & Keyboard Bindings
  // ============================================================================

  private bindMotionPreference(): void {
    this.reducedMotionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.setMotionPaused(this.reducedMotionQuery.matches, false);

    const onChange = (e: MediaQueryListEvent) => this.setMotionPaused(e.matches, false);
    this.reducedMotionQuery.addEventListener('change', onChange);
    this.cleanups.push(() =>
      this.reducedMotionQuery?.removeEventListener('change', onChange),
    );
  }

  private setMotionPaused(paused: boolean, withChime: boolean): void {
    this.motionPaused = paused;
    document.documentElement.dataset.motion = paused ? 'paused' : 'on';
    if (this.motionBtn) {
      // WCAG 2.2.2 Pause/Play text switch: never add aria-pressed on label-changing controls.
      this.motionBtn.textContent = paused ? 'Play motion' : 'Pause motion';
      this.motionBtn.removeAttribute('aria-pressed');
      this.motionBtn.dataset.motionState = paused ? 'paused' : 'playing';
    }
    if (paused && this.typewriterShownChars < this.typewriterFullText.length) {
      this.completeTypewriterImmediately();
    }
    if (withChime) chiptuneAudio.playToggle();
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
      const biomeId = btn.dataset.travelZone as BiomeId | undefined;
      const biome = BIOME_DEFINITIONS.find((b) => b.id === biomeId);
      if (!biome) continue;

      const onTravel = () => {
        chiptuneAudio.unlock();
        this.fastTravelTo(biome.index, true);
      };
      btn.addEventListener('click', onTravel);
      this.cleanups.push(() => btn.removeEventListener('click', onTravel));
    }

    if (this.celestialBtn) {
      const onCelestial = () => {
        const isDay = computeCelestialState(this.celestialOverride).isDaytime;
        this.celestialOverride = isDay ? 'night' : 'day';
        this.syncCelestialButtonUI();
        this.drawPixiSkyFallback(this.viewWidth, this.viewHeight);
        chiptuneAudio.playToggle();
      };
      this.celestialBtn.addEventListener('click', onCelestial);
      this.cleanups.push(() => this.celestialBtn?.removeEventListener('click', onCelestial));
    }

    if (this.audioBtn) {
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
      const onMotion = () => this.setMotionPaused(!this.motionPaused, true);
      this.motionBtn.addEventListener('click', onMotion);
      this.cleanups.push(() => this.motionBtn?.removeEventListener('click', onMotion));
    }

    const bindClick = (el: HTMLElement | null, fn: () => void) => {
      if (!el) return;
      el.addEventListener('click', fn);
      this.cleanups.push(() => el.removeEventListener('click', fn));
    };

    bindClick(this.openDossierBtn, () => this.openCharacterDossier('status'));
    bindClick(this.btnStartDossier, () => this.openCharacterDossier('status'));
    bindClick(this.roastTriggerBtn, () => this.triggerRoastChest());
    bindClick(this.btnSelectRoast, () => this.triggerRoastChest());
    bindClick(this.dogTriggerBtn, () => this.triggerWhiteDogMemorial());

    bindClick(this.btnActionA, () => this.handlePrimaryAction());
    bindClick(this.btnActionB, () => {
      if (this.gameState === 'EXPLORING') {
        this.triggerWhiteDogMemorial();
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
        // Keyboard Enter/Space activation produces a click with detail === 0.
        if (e.detail === 0 && this.gameState === 'EXPLORING') {
          chiptuneAudio.unlock();
          const step = 36;
          const dx = dir === 'right' ? step : dir === 'left' ? -step : 0;
          const dy = dir === 'down' ? step : dir === 'up' ? -step : 0;
          this.facing = dir;
          const next = resolveWorldCollisions(this.borisX + dx, this.borisY + dy, 14);
          this.borisX = next.x;
          this.borisY = next.y;
          chiptuneAudio.playStep();
          const biome = getBiomeAtX(this.borisX);
          if (biome.id !== this.activeBiomeId) this.syncBiomeUI(biome, true);
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
        this.openBiomeWelcome(this.activeBiomeId);
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

      // Fast-travel hotkeys 1..5
      if (key >= '1' && key <= '5') {
        chiptuneAudio.unlock();
        this.fastTravelTo(Number(key) - 1, true);
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

      // Escape closes active SNES dialogue window cleanly back to EXPLORING
      if (event.key === 'Escape') {
        if (this.gameState !== 'EXPLORING' && this.gameState !== 'CHARACTER_SHEET') {
          event.preventDefault();
          this.closeDialogue(true);
        }
        return;
      }

      // [B]: Close/back when reading dialogue ([ESC / B]), or pet White Dog when exploring
      if (key === 'b') {
        if (this.gameState === 'EXPLORING') {
          this.triggerWhiteDogMemorial();
        } else if (this.gameState !== 'CHARACTER_SHEET') {
          this.closeDialogue(true);
        }
        return;
      }

      // [Space] / [Enter] action key - avoid intercepting native button/link activation
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

  public destroy(): void {
    for (const cleanup of this.cleanups) cleanup();
    this.cleanups = [];
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
 * Boot and mount the SPEC-021 OverworldController inside `#overworldStage`.
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
