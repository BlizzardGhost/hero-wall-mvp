/**
 * Path: src/scripts/pixel-sprites.ts
 * Purpose: Zero-dependency procedural 16-bit pixel-art sprite sheet generator
 *          built around a 24-color warm & techno-organic palette (`SPRITE_PALETTE`).
 *          Produces nearest-neighbor PixiJS v8 Texture instances AND reusable
 *          offscreen HTMLCanvasElement frames for Canvas2D fallback.
 * Spec Reference: SPEC-022 (022-hero-wall-studio-cozy-rebuild)
 *
 * Debug Operator Notes:
 * - Set `window.__RASS_OVERWORLD_DEBUG__ = true` to inspect generated texture
 *   dimensions, scaleMode bindings, and offscreen canvas counts in DevTools.
 * - All grids are authored inline as uniform character matrices (0 KB external
 *   bitmap assets) and quantized cleanly via `drawMatrixFrame` / `renderMatrixToCanvas`.
 */

export type SpriteDirection = 'down' | 'up' | 'left' | 'right';
export type BorisSpriteChannel = SpriteDirection | 'idleMug';
export type AlienRoomPortalId = 'cyber_chasm' | 'bio_forge' | 'signal_beacon';
export type SpriteGrid = readonly string[];
export type SpritePalette = Readonly<Record<string, string>>;

export interface TextureSourceLike {
  scaleMode?: string;
  style?: {
    scaleMode?: string;
  };
}

export interface TextureLike {
  source?: TextureSourceLike;
}

export interface TextureClassLike<T = TextureLike> {
  from: (input: unknown) => T;
}

export type CanvasSourceClassLike = new (options: {
  resource: HTMLCanvasElement;
  scaleMode: 'nearest';
}) => unknown;

export interface SpriteBuildOptions {
  /** Pixel enlargement multiplier per matrix cell (default: 3 -> 16x16 becomes 48x48px). */
  pixelSize?: number;
  /** Optional PixiJS v8 CanvasSource constructor to pin scaleMode: 'nearest' at source creation. */
  CanvasSourceClass?: CanvasSourceClassLike;
}

export interface SpriteTextureSet<T = HTMLCanvasElement> {
  pixelSize: number;
  canvases: {
    boris: Record<BorisSpriteChannel, HTMLCanvasElement[]>;
    sleepingDog: HTMLCanvasElement[];
    dogWake: HTMLCanvasElement[];
    /** Compatibility alias pointing to `sleepingDog`. */
    whiteDog: HTMLCanvasElement[];
    rassDrone: HTMLCanvasElement[];
    msDevil: HTMLCanvasElement[];
    worldObjects: {
      campfire: HTMLCanvasElement[];
      shelter: HTMLCanvasElement;
      armoryLodge: HTMLCanvasElement;
      portalAlien: HTMLCanvasElement[];
      portalByRoom: Record<AlienRoomPortalId, HTMLCanvasElement[]>;
      returnPortal: HTMLCanvasElement[];
      eraObelisk: HTMLCanvasElement;
      bioPod: HTMLCanvasElement;
      beaconDish: HTMLCanvasElement;
      wovenMat: HTMLCanvasElement;
      commsAntenna: HTMLCanvasElement;
      timberBench: HTMLCanvasElement;
      /** Compatibility aliases for landmark renderers. */
      relicPedestal: HTMLCanvasElement;
      trophyPedestal: HTMLCanvasElement;
      beaconTower: HTMLCanvasElement;
      roastChest: {
        closed: HTMLCanvasElement;
        open: HTMLCanvasElement;
      };
      heart: HTMLCanvasElement;
    };
  };
  boris: Record<BorisSpriteChannel, T[]>;
  sleepingDog: T[];
  dogWake: T[];
  /** Compatibility alias pointing to `sleepingDog`. */
  whiteDog: T[];
  rassDrone: T[];
  msDevil: T[];
  worldObjects: {
    campfire: T[];
    shelter: T;
    armoryLodge: T;
    portalAlien: T[];
    portalByRoom: Record<AlienRoomPortalId, T[]>;
    returnPortal: T[];
    eraObelisk: T;
    bioPod: T;
    beaconDish: T;
    wovenMat: T;
    commsAntenna: T;
    timberBench: T;
    relicPedestal: T;
    trophyPedestal: T;
    beaconTower: T;
    roastChest: {
      closed: T;
      open: T;
    };
    heart: T;
  };
}

declare global {
  interface Window {
    __RASS_OVERWORLD_DEBUG__?: boolean;
  }
}

/**
 * Emit opt-in debug diagnostics when `window.__RASS_OVERWORLD_DEBUG__` is enabled.
 */
function debugLog(message: string, detail?: unknown): void {
  if (typeof window !== 'undefined' && window.__RASS_OVERWORLD_DEBUG__) {
    console.info(`[PixelSprites] ${message}`, detail ?? '');
  }
}

/**
 * Unified 24-color warm campfire & techno-organic alien sprite palette.
 * `.` or ` ` denotes transparent pixels.
 */
export const SPRITE_PALETTE: Record<string, string> = {
  K: '#090d16', // 01. Obsidian ink outline
  h: '#151c28', // 02. Dark hair, Boris beard & Ms. Devil locks
  B: '#1C3B54', // 03. Boris dark Armor Blue base
  b: '#28597a', // 04. Boris Armor Blue mid-tone highlight
  d: '#102436', // 05. Deep Armor Blue / Sherpa cloak shadow
  S: '#e89c61', // 06. Warm rugged skin highlight
  s: '#c9713b', // 07. Warm skin shadow
  C: '#38C7E7', // 08. Glowing cyan chest core, visor eyes & RASS hologram
  c: '#7dd3fc', // 09. Bright cyan energy orb & hologram rim highlight
  N: '#06b6d4', // 10. Cyan beacon & bio-glass mid-tone
  n: '#0e7490', // 11. Deep cyan hologram shadow & glass edge
  F: '#f4e3c3', // 12. Terrier cream coat, mug steam & parchment highlight
  W: '#ffffff', // 13. Specular white spark & flame heart
  T: '#9a5b25', // 14. Terrier chestnut coat & carved timber mid-tone
  t: '#3b2110', // 15. Terrier dark chocolate muzzle/spots & charred timber
  P: '#78350f', // 16. Sherpa fur/leather cloak trim & shelter beams
  O: '#f97316', // 17. Campfire amber outer flame & forge copper glow
  Y: '#facc15', // 18. Gold flame core, lantern light & return portal gold
  R: '#dc2626', // 19. Ms. Devil crimson & woven mat accent
  r: '#991b1b', // 20. Ms. Devil deep crimson shadow & woven mat base
  A: '#a855f7', // 21. Cyber-Chasm arcane purple & alien portal plasma
  E: '#10b981', // 22. Bio-Forge emerald tendril & moss highlight
  M: '#64748b', // 23. Hearth stone highlight & observatory steel
  m: '#334155', // 24. Stone ring mid-tone & dark obsidian slate
};

/**
 * Boris (Level 39 LATAM AI Sherpa):
 * - 4 directions (`down`, `up`, `left`, `right`) x 4-frame walk cycle (16 frames)
 * - `idleMug`: 2-frame breathing idle holding a warm steaming campfire mug
 * Depicts bearded Boris in dark Armor Blue (#1C3B54 / #28597a) sci-fi armor,
 * hooded Sherpa cloak trim, glowing cyan visor/eyes & cyan chest core (#38C7E7).
 */
export const BORIS_SPRITE_FRAMES: Readonly<Record<BorisSpriteChannel, readonly SpriteGrid[]>> = {
  down: [
    // Frame 0: neutral stance
    [
      '.....KKKKKK.....',
      '....KhhhhhhK....',
      '...KhhSSSShhK...',
      '...KhSCssCSKh...',
      '...KhSSSSSSKh...',
      '....KhhSShhK....',
      '....KKhhhhKK....',
      '..KPPdBBBBdPPK..',
      '.KBbBBBBBBBBbBK.',
      '.KBBdBBCCBBdBBK.',
      '.KSKdBbcCbBdKSK.',
      '.KK.KBBBBBBK.KK.',
      '....KBB..BBK....',
      '....Kdd..ddK....',
      '....KPP..PPK....',
      '...KKKK..KKKK...',
    ],
    // Frame 1: left stride forward, right arm swing
    [
      '.....KKKKKK.....',
      '....KhhhhhhK....',
      '...KhhSSSShhK...',
      '...KhSCssCSKh...',
      '...KhSSSSSSKh...',
      '....KhhSShhK....',
      '....KKhhhhKK....',
      '..KPPdBBBBdPPK..',
      '.KBbBBBBBBBBbBK.',
      '.KBBdBBCCBBdBBK.',
      '.KSKdBbcCbBdK...',
      '.KK.KBBBBBBKKSK.',
      '...KBB....BBK...',
      '...KPP....ddK...',
      '..KKKK....PPK...',
      '..........KKK...',
    ],
    // Frame 2: passing stride
    [
      '.....KKKKKK.....',
      '....KhhhhhhK....',
      '...KhhSSSShhK...',
      '...KhSCssCSKh...',
      '...KhSSSSSSKh...',
      '....KhhSShhK....',
      '....KKhhhhKK....',
      '..KPPdBBBBdPPK..',
      '.KBbBBBBBBBBbBK.',
      '.KBBdBBCCBBdBBK.',
      '..KKdBbcCbBdKK..',
      '....KBBBBBBK....',
      '....KBB..BBK....',
      '....KPP..ddK....',
      '....KKK..PPK....',
      '.........KKK....',
    ],
    // Frame 3: right stride forward, left arm swing
    [
      '.....KKKKKK.....',
      '....KhhhhhhK....',
      '...KhhSSSShhK...',
      '...KhSCssCSKh...',
      '...KhSSSSSSKh...',
      '....KhhSShhK....',
      '....KKhhhhKK....',
      '..KPPdBBBBdPPK..',
      '.KBbBBBBBBBBbBK.',
      '.KBBdBBCCBBdBBK.',
      '...KdBbcCbBdKSK.',
      '.KSKKBBBBBBK.KK.',
      '...KBB....BBK...',
      '...Kdd....PPK...',
      '...KPP....KKKK..',
      '...KKK..........',
    ],
  ],
  up: [
    // Frame 0: north view showing hooded Sherpa cloak & pack
    [
      '.....KKKKKK.....',
      '....KBBBBBBK....',
      '...KBBbbbbBBK...',
      '..KBBddddddBBK..',
      '..KPPdBBBBdPPK..',
      '..KPPBBBBBBPPK..',
      '...KKPPPPPPKK...',
      '..KPPBBBBBBPPK..',
      '.KBbPBBCCBBPbBK.',
      '.KBBPBBBBBBPBBK.',
      '.KK.KBBBBBBK.KK.',
      '....KBBddBBK....',
      '....KBB..BBK....',
      '....Kdd..ddK....',
      '....KPP..PPK....',
      '...KKKK..KKKK...',
    ],
    // Frame 1: left stride
    [
      '.....KKKKKK.....',
      '....KBBBBBBK....',
      '...KBBbbbbBBK...',
      '..KBBddddddBBK..',
      '..KPPdBBBBdPPK..',
      '..KPPBBBBBBPPK..',
      '...KKPPPPPPKK...',
      '..KPPBBBBBBPPK..',
      '.KBbPBBCCBBPbBK.',
      '.KBBPBBBBBBPBBK.',
      '.KK.KBBBBBBK....',
      '....KBBddBBK....',
      '....KBB..BBK....',
      '....KPP..ddK....',
      '....KKK..PPK....',
      '.........KKK....',
    ],
    // Frame 2: passing stride
    [
      '.....KKKKKK.....',
      '....KBBBBBBK....',
      '...KBBbbbbBBK...',
      '..KBBddddddBBK..',
      '..KPPdBBBBdPPK..',
      '..KPPBBBBBBPPK..',
      '...KKPPPPPPKK...',
      '..KPPBBBBBBPPK..',
      '.KBbPBBCCBBPbBK.',
      '.KBBPBBBBBBPBBK.',
      '..KKKBBBBBBKKK..',
      '....KBBddBBK....',
      '....KBB..BBK....',
      '....Kdd..ddK....',
      '....KPP..PPK....',
      '....KKK..KKK....',
    ],
    // Frame 3: right stride
    [
      '.....KKKKKK.....',
      '....KBBBBBBK....',
      '...KBBbbbbBBK...',
      '..KBBddddddBBK..',
      '..KPPdBBBBdPPK..',
      '..KPPBBBBBBPPK..',
      '...KKPPPPPPKK...',
      '..KPPBBBBBBPPK..',
      '.KBbPBBCCBBPbBK.',
      '.KBBPBBBBBBPBBK.',
      '....KBBBBBBK.KK.',
      '....KBBddBBK....',
      '....KBB..BBK....',
      '....Kdd..PPK....',
      '....KPP..KKK....',
      '....KKK.........',
    ],
  ],
  left: [
    // Frame 0: west profile showing cyan eye, beard & Sherpa hood pack
    [
      '.....KKKKKK.....',
      '....KhhhhhhK....',
      '...KhhSSSShhK...',
      '..KhCSSSSSBBPK..',
      '..KhhSSSSSBBPK..',
      '...KKhhhhSBBPK..',
      '....KKhhhPPPK...',
      '..KPPBBBBPPPK...',
      '.KBbBBBCBBPPK...',
      '.KBBSKBBBBPPK...',
      '.KBBbBBBBBBPK...',
      '...KKBBBBBBK....',
      '....KBB..BBK....',
      '....Kdd..ddK....',
      '....KPP..PPK....',
      '...KKKK..KKKK...',
    ],
    // Frame 1: wide stride
    [
      '.....KKKKKK.....',
      '....KhhhhhhK....',
      '...KhhSSSShhK...',
      '..KhCSSSSSBBPK..',
      '..KhhSSSSSBBPK..',
      '...KKhhhhSBBPK..',
      '....KKhhhPPPK...',
      '..KPPBBBBPPPK...',
      '.KBbBBBCBBPPK...',
      '.KSKBBBBBBPPK...',
      '..KKbBBBBBBPK...',
      '...KKBBBBBBK....',
      '...KBB...BBK....',
      '..Kdd.....ddK...',
      '.KPP.......PPK..',
      '.KKKK.....KKKK..',
    ],
    // Frame 2: passing stride
    [
      '.....KKKKKK.....',
      '....KhhhhhhK....',
      '...KhhSSSShhK...',
      '..KhCSSSSSBBPK..',
      '..KhhSSSSSBBPK..',
      '...KKhhhhSBBPK..',
      '....KKhhhPPPK...',
      '..KPPBBBBPPPK...',
      '.KBbBBBCBBPPK...',
      '.KBBKSKBBBPPK...',
      '.KBBbBBBBBBPK...',
      '...KKBBBBBBK....',
      '.....KBBBBK.....',
      '.....KddddK.....',
      '.....KPPPPK.....',
      '....KKKKKKK.....',
    ],
    // Frame 3: alternate stride
    [
      '.....KKKKKK.....',
      '....KhhhhhhK....',
      '...KhhSSSShhK...',
      '..KhCSSSSSBBPK..',
      '..KhhSSSSSBBPK..',
      '...KKhhhhSBBPK..',
      '....KKhhhPPPK...',
      '..KPPBBBBPPPK...',
      '.KBbBBBCBBPPK...',
      '.KBBBBKSKBPPK...',
      '.KBBbBBBBBBPK...',
      '...KKBBBBBBK....',
      '...KBB...BBK....',
      '...Kdd....ddK...',
      '...KPP.....PPK..',
      '..KKKK.....KKKK.',
    ],
  ],
  right: [
    // Frame 0: east profile
    [
      '.....KKKKKK.....',
      '....KhhhhhhK....',
      '...KhhSSSShhK...',
      '..KPBBSSSSSCKh..',
      '..KPBBSSSSShhK..',
      '..KPBBSssssKK...',
      '...KPPPPhhhKK...',
      '...KPPPBBBBPPK..',
      '...KPPBBCBBBbBK.',
      '...KPPBBBBKSBBK.',
      '...KPBBBBBBbBBK.',
      '....KBBBBBBKK...',
      '....KBB..BBK....',
      '....Kdd..ddK....',
      '....KPP..PPK....',
      '...KKKK..KKKK...',
    ],
    // Frame 1: wide stride
    [
      '.....KKKKKK.....',
      '....KhhhhhhK....',
      '...KhhSSSShhK...',
      '..KPBBSSSSSCKh..',
      '..KPBBSSSSShhK..',
      '..KPBBSssssKK...',
      '...KPPPPhhhKK...',
      '...KPPPBBBBPPK..',
      '...KPPBBCBBBbBK.',
      '...KPPBBBBBBKSK.',
      '...KPBBBBBBbKK..',
      '....KBBBBBBKK...',
      '....KBB...BBK...',
      '...Kdd.....ddK..',
      '..KPP.......PPK.',
      '.KKKK.....KKKK..',
    ],
    // Frame 2: passing stride
    [
      '.....KKKKKK.....',
      '....KhhhhhhK....',
      '...KhhSSSShhK...',
      '..KPBBSSSSSCKh..',
      '..KPBBSSSSShhK..',
      '..KPBBSssssKK...',
      '...KPPPPhhhKK...',
      '...KPPPBBBBPPK..',
      '...KPPBBCBBBbBK.',
      '...KPPBBBKSKBBK.',
      '...KPBBBBBBbBBK.',
      '....KBBBBBBKK...',
      '.....KBBBBK.....',
      '.....KddddK.....',
      '.....KPPPPK.....',
      '.....KKKKKKK....',
    ],
    // Frame 3: alternate stride
    [
      '.....KKKKKK.....',
      '....KhhhhhhK....',
      '...KhhSSSShhK...',
      '..KPBBSSSSSCKh..',
      '..KPBBSSSSShhK..',
      '..KPBBSssssKK...',
      '...KPPPPhhhKK...',
      '...KPPPBBBBPPK..',
      '...KPPBBCBBBbBK.',
      '...KPPBKSKBBBBK.',
      '...KPBBBBBBbBBK.',
      '....KBBBBBBKK...',
      '....KBB...BBK...',
      '...Kdd....ddK...',
      '..KPP.....PPK...',
      '.KKKK....KKKK...',
    ],
  ],
  idleMug: [
    // Frame 0: cozy breathing stance holding warm steaming mug
    [
      '.....KKKKKK.....',
      '....KhhhhhhK....',
      '...KhhSSSShhK...',
      '...KhSCssCSKh...',
      '...KhSSSSSSKh.F.',
      '....KhhSShhK.F..',
      '....KKhhhhKK.FF.',
      '..KPPdBBBBdPPK..',
      '.KBbBBBBBBBBbBK.',
      '.KBBdBBCCBBdKFFK',
      '.KSKdBbcCbBdKPTK',
      '.KK.KBBBBBBK.KKK',
      '....KBB..BBK....',
      '....Kdd..ddK....',
      '....KPP..PPK....',
      '...KKKK..KKKK...',
    ],
    // Frame 1: subtle 1px inhale lift, glowing core pulse & rising steam
    [
      '.....KKKKKK...F.',
      '....KhhhhhhK.F..',
      '...KhhSSSShhK.F.',
      '...KhSCssCSKh...',
      '...KhSSSSSSKh...',
      '....KhhSShhK....',
      '..KKPPhhhhPPKK..',
      '.KBbPdBBBBdPbBK.',
      '.KBBdBBcCBbdKFFK',
      '.KSKdBbCCbBdKPTK',
      '.KK.KBBBBBBK.KKK',
      '....KBBBBBBK....',
      '....KBB..BBK....',
      '....Kdd..ddK....',
      '....KPP..PPK....',
      '...KKKK..KKKK...',
    ],
  ],
};

/**
 * The Dog: Brown-and-white terrier (#f4e3c3, #9a5b25, #3b2110) curled up
 * sleeping on a woven crimson/amber mat by the campfire embers.
 * 4 frames: peaceful breath, chest rise, ear twitch, and cozy exhale.
 */
export const SLEEPING_DOG_FRAMES: readonly SpriteGrid[] = [
  // Frame 0: curled restful sleep
  [
    '................',
    '................',
    '................',
    '................',
    '................',
    '....KK..........',
    '...KTTKK.KKKKK..',
    '..KTTTFFKFFFFtK.',
    '.KFFtFFtKFFTTTtK',
    '.KFFFFFKFFFFTTFK',
    '.rKFFFFFFFFFFFKr',
    'rRKKFFFFFFFFFKKr',
    'rOYRRRRRRRRRRYOr',
    '.rrrrrrrrrrrrrr.',
    '................',
    '................',
  ],
  // Frame 1: gentle chest rise inhale
  [
    '................',
    '................',
    '................',
    '................',
    '................',
    '....KK...KKKKK..',
    '...KTTKKKFFFFtK.',
    '..KTTTFFKFFTTTtK',
    '.KFFtFFtKFFFTTFK',
    '.KFFFFFKFFFFFFFK',
    '.rKFFFFFFFFFFFKr',
    'rRKKFFFFFFFFFKKr',
    'rOYRRRRRRRRRRYOr',
    '.rrrrrrrrrrrrrr.',
    '................',
    '................',
  ],
  // Frame 2: gentle chest rise + right ear twitch
  [
    '................',
    '................',
    '................',
    '................',
    '...KK...........',
    '..KTTK...KKKKK..',
    '..KTTTKKKFFFFtK.',
    '..KTTTFFKFFTTTtK',
    '.KFFtFFtKFFFTTFK',
    '.KFFFFFKFFFFFFFK',
    '.rKFFFFFFFFFFFKr',
    'rRKKFFFFFFFFFKKr',
    'rOYRRRRRRRRRRYOr',
    '.rrrrrrrrrrrrrr.',
    '................',
    '................',
  ],
  // Frame 3: exhale back down into warm curl
  [
    '................',
    '................',
    '................',
    '................',
    '................',
    '....KK..........',
    '...KTTKK.KKKKK..',
    '..KTTTFFKFFFFtKK',
    '.KFFtFFtKFFTTTtK',
    '.KFFFFFKFFFFTTFK',
    '.rKFFFFFFFFFFFKr',
    'rRKKFFFFFFFFFKKr',
    'rOYRRRRRRRRRRYOr',
    '.rrrrrrrrrrrrrr.',
    '................',
    '................',
  ],
];

/**
 * Wake & tail-wag frames played when Boris pets The Dog ([B]) by the campfire.
 */
export const DOG_WAKE_FRAMES: readonly SpriteGrid[] = [
  // Frame 0: perked sitting terrier with bright eyes & upright tail
  [
    '................',
    '........KK..KK..',
    '.......KTTKKTFK.',
    '......KTTTFFFFK.',
    '......KTtFFKtFFK',
    '.......KFFFFFFtK',
    '.......KFFOOOOFK',
    '...KK..KFFFFFFK.',
    '..KtFK.KFFTTTKK.',
    '...KFFKFFFFFFK..',
    '..rKFFFFFFFFFKr.',
    'rRYKFFKFFKFFKYRr',
    'rOYRRRRRRRRRRYOr',
    '.rrrrrrrrrrrrrr.',
    '................',
    '................',
  ],
  // Frame 1: wagging tail & happy 1px head bounce
  [
    '................',
    '.......KK..KK...',
    '......KTTKKTFK..',
    '.....KTTTFFFFK..',
    '.....KTtFFKtFFK.',
    '......KFFFFFFtK.',
    '.KK...KFFOOOOFK.',
    'KtFK..KFFFFFFK..',
    '.KFFKKKFFTTTKK..',
    '..KFFFFFFFFFFK..',
    '..rKFFFFFFFFFKr.',
    'rRYKFFKFFKFFKYRr',
    'rOYRRRRRRRRRRYOr',
    '.rrrrrrrrrrrrrr.',
    '................',
    '................',
  ],
];

/** Compatibility alias preserving downstream `WHITE_DOG_FRAMES` symbol consumers. */
export const WHITE_DOG_FRAMES = SLEEPING_DOG_FRAMES;

/**
 * RASS: Glowing holographic cyan female AI figure (#38C7E7 / #7dd3fc) with
 * floating cyan energy orb, 2-frame hover loop near the campfire radio antenna.
 */
export const RASS_DRONE_FRAMES: readonly SpriteGrid[] = [
  // Frame 0: holographic cyan stance with glowing floating orb
  [
    '.......nnnn.....',
    '......nCCCCn....',
    '.....nCCccCCn...',
    '.....nCcWWcCn...',
    '.ccc.nCCCCCCn...',
    'cWWWc.nNccNn....',
    '.ccc.nCCWWCCn...',
    '..NNnnCCCCCCn...',
    '.....nCccccCn...',
    '.....nCCCCCCn...',
    '.....nNNCCNNn...',
    '.....nCC..CCn...',
    '.....nNN..NNn...',
    '......nn..nn....',
    '......c....c....',
    '................',
  ],
  // Frame 1: 1px vertical hover float + pulsed orb flare
  [
    '......nCCCCn....',
    '.....nCCccCCn...',
    '.....nCcWWcCn...',
    'cWc..nCCCCCCn...',
    'WWcWc.nNccNn....',
    '.ccc.nCCWWCCn...',
    '.cNNnnCCCCCCn...',
    '.....nCccccCn...',
    '.....nCCCCCCn...',
    '.....nNNCCNNn...',
    '.....nCC..CCn...',
    '.....nNN..NNn...',
    '......nn..nn....',
    '.....c..cc..c...',
    '................',
    '................',
  ],
];

/**
 * Ms. Devil: Crimson horned demoness (#dc2626 / #991b1b) with dark flowing locks
 * holding an amber campfire flame, 2-frame lounging idle on a carved timber bench.
 */
export const MS_DEVIL_FRAMES: readonly SpriteGrid[] = [
  // Frame 0: relaxed bench lounge, amber flame held aloft
  [
    '............O...',
    '...K....K..OYO..',
    '...RK..KR..OWO..',
    '..hRRRRRRh.OYO..',
    '.hhRKRKRrh.KPK..',
    '.hhRRRRRrhKRRK..',
    'hh.KrRRRrrRRK...',
    'h..KRRRRRRRRK...',
    '...KrrRRRRrrK...',
    '..KRRRRRRRRK....',
    '.KTTTTTTTTTTTK..',
    '.KPPPPPPPPPPPK..',
    '..KttK...KttK...',
    '..KKK.....KKK...',
    '................',
    '................',
  ],
  // Frame 1: gentle dark lock sway + taller crackling campfire flame
  [
    '...........OO...',
    '...K....K..OYO..',
    '...RK..KR.OYWYO.',
    '..hRRRRRRh.OYO..',
    '.hhRKRKRrh.OPO..',
    'hh.RRRRRrhKRRK..',
    'hh.KrRRRrrRRK...',
    '.h.KRRRRRRRRK...',
    '...KrrRRRRrrK...',
    '..KRRRRRRRRK....',
    '.KTTTTTTTTTTTK..',
    '.KPPPPPPPPPPPK..',
    '..KttK...KttK...',
    '..KKK.....KKK...',
    '................',
    '................',
  ],
];

/**
 * Interactive 16x16, 24x24, and 32x24 world landmarks, shelters, portals,
 * and props across the Campfire Sanctuary and 3 Techno-Organic Alien Rooms.
 */
export const WORLD_OBJECT_SPRITES = {
  /** 4-frame 24x24 stone campfire ring with flickering amber flames & radial hearth dithering. */
  campfire: [
    // Frame 0: tall central amber blaze + warm radial stone dithering
    [
      '...........OO...........',
      '..........OYYO..........',
      '.....O....OWYO..........',
      '.........OYWYOO.........',
      '........OOYWYYO.........',
      '........OYWWWYYO........',
      '.......OOYWWWWYO........',
      '.......OYYWWWWYYO.......',
      '......OOYOWWWWOYO.......',
      '......OYOOOYYYOOY.......',
      '.....OOROOOOOOOOrO......',
      '.....rrOOOOOOOOrrr......',
      '....KTtOOOOOOOOOtTK.....',
      '...KTtPPROOOOORPPtTK....',
      '..KTtPPPTOOOOOTPPPtTK...',
      '..KKttttPPPPPPPPttttKK..',
      '.rmmKttttttttttttttKmmr.',
      'rMmmMKttPPPPPPPPttKMmmMr',
      'KMmmMKmttttttttttmKMmmMK',
      '.rMmKKMmMmKKmMmMKKmMr...',
      '..OrKmnmmmKKmmmnmKrO....',
      '...r.KmmmKKKKmmmK.r.....',
      '....r.KKKKKKKKKK.r......',
      '......O..r..r..O........',
    ],
    // Frame 1: flickering left lean + right spark
    [
      '.........OO.............',
      '........OYYO............',
      '........OWYO.....O......',
      '.......OYWYOO...........',
      '.......OYWWYYO..........',
      '......OOYWWWYYYO........',
      '......OYYWWWWYYOO.......',
      '......OYOWWWWWOYO.......',
      '.....OOYOWWWWWOYYO......',
      '.....OYYOOYYYYOOOY......',
      '.....OOrOOOOOOOrrO......',
      '....rrrOOOOOOOOrrr......',
      '....KTtOOOOOOOOOtTK.....',
      '...KTtPPROOOOORPPtTK....',
      '..KTtPPPTOOOOOTPPPtTK...',
      '..KKttttPPPPPPPPttttKK..',
      '.rmmKttttttttttttttKmmr.',
      'rMmmMKttPPPPPPPPttKMmmMr',
      'KMmmMKmttttttttttmKMmmMK',
      '.rMmKKMmMmKKmMmMKKmMr...',
      '..OrKmnmmmKKmmmnmKrO....',
      '...r.KmmmKKKKmmmK.r.....',
      '....r.KKKKKKKKKK.r......',
      '.....O...r..r...O.......',
    ],
    // Frame 2: flickering right flare + dual sparks
    [
      '.............OO.........',
      '............OYYO........',
      '......O.....OYWO........',
      '...........OOYWYO.......',
      '..........OYYWWYO.......',
      '........OOYYWWWYYO......',
      '........OYYWWWWYYO......',
      '.......OOYWWWWWYYO......',
      '......OOYOWWWWWOYOO.....',
      '......OYOOOYYYYOOYY.....',
      '.....OOROOOOOOOOrOO.....',
      '.....rrOOOOOOOOrrrr.....',
      '....KTtOOOOOOOOOtTK.....',
      '...KTtPPROOOOORPPtTK....',
      '..KTtPPPTOOOOOTPPPtTK...',
      '..KKttttPPPPPPPPttttKK..',
      '.rmmKttttttttttttttKmmr.',
      'rMmmMKttPPPPPPPPttKMmmMr',
      'KMmmMKmttttttttttmKMmmMK',
      '.rMmKKMmMmKKmMmMKKmMr...',
      '..OrKmnmmmKKmmmnmKrO....',
      '...r.KmmmKKKKmmmK.r.....',
      '....r.KKKKKKKKKK.r......',
      '......O..r..r..O........',
    ],
    // Frame 3: warm low ember pulse + ascending spark ring
    [
      '....O..............O....',
      '...........OYO..........',
      '..........OYWYO.........',
      '.........OOYWYOO........',
      '........OYYWWWYYO.......',
      '.......OOYWWWWYYO.......',
      '.......OYOWWWWWYO.......',
      '......OOYOWWWWOYYO......',
      '......OYYOOYYYOOYO......',
      '.....OOROOOOOOOOrO......',
      '.....rrOOOOOOOOrrr......',
      '....rrrOOOOOOOOrrrr.....',
      '....KTtOOOOOOOOOtTK.....',
      '...KTtPPROOOOORPPtTK....',
      '..KTtPPPTOOOOOTPPPtTK...',
      '..KKttttPPPPPPPPttttKK..',
      '.rmmKttttttttttttttKmmr.',
      'rMmmMKttPPPPPPPPttKMmmMr',
      'KMmmMKmttttttttttmKMmmMK',
      '.rMmKKMmMmKKmMmMKKmMr...',
      '..OrKmnmmmKKmmmnmKrO....',
      '...r.KmmmKKKKmmmK.r.....',
      '....r.KKKKKKKKKK.r......',
      '.....O..r....r..O.......',
    ],
  ] as readonly SpriteGrid[],

  /** 32x24 rustic timber lean-to shelter with hanging cooking pot & warm glowing lantern. */
  shelter: [
    '........KKKKKKKKKKKKKKKK........',
    '......KKTTTTTTTTTTTTTTTTKK......',
    '....KKPPTTTTTTTTTTTTTTTTPPKK....',
    '..KKPPPPTTTTTTTTTTTTTTTTPPPPKK..',
    '.KttPPPPPPPPPPPPPPPPPPPPPPPPttK.',
    'KKKKKKKKKKKKKKKKKKKKKKKKKKKKKKKK',
    '.KttK...K..F........K....K..KttK',
    '.KPPK...K.F.........KYYK.K..KPPK',
    '.KPPK...K...........KYWK.K..KPPK',
    '.KPPK..KKK..........KOYK.K..KPPK',
    '.KPPK.KmmmK.........KKKK.K..KPPK',
    '.KPPK.KmmMK...KPPP..O....K..KPPK',
    '.KPPK..KKK...KTTTTPK.....K..KPPK',
    '.KPPK..OYO..KTTTTTTPK....K..KPPK',
    '.KPPK..rOr..KPPPPPPPK....K..KPPK',
    '.KPPK..KKK..KKKKKKKKK....K..KPPK',
    '.KPPK....................K..KPPK',
    '.KttK..rRRRRRRRRRRRrrrr..K..KttK',
    '.KttK..rOYRRRRRRRRRRYOr..K..KttK',
    '.KmmK..rrrrrrrrrrrrrrrr..K..KmmK',
    '.KMmK....................K..KMmK',
    '.KmmK....................K..KmmK',
    '.KKKK....................KKKKKK.',
    '................................',
  ] as SpriteGrid,

  /** 32x24 timber-and-stone Trophy Armory Lodge at the Sanctuary clearing edge. */
  armoryLodge: [
    '..............KKKK..............',
    '............KKYYYYKK............',
    '..........KKPPYYYYPPKK..........',
    '........KKPPPPYYYYPPPPKK........',
    '......KKTTTTTTTTTTTTTTTTKK......',
    '....KKPPTTTTTTTTTTTTTTTTPPKK....',
    '..KKPPPPPPPPPPPPPPPPPPPPPPPPKK..',
    '.KKKKKKKKKKKKKKKKKKKKKKKKKKKKKK.',
    '.KttKPPPPPPPKYYYYYYKPPPPPPPKttK.',
    '.KPPKPPTTTTPKYRRRRYKPTTTTPPKPPK.',
    '.KPPKPYYYYPPKYRYYRYKPPYYYYPKPPK.',
    '.KPPKPYWWYPPKYYYYYYKPPYWWYPKPPK.',
    '.KPPKPYOOYPPKKKKKKKKPPYOOYPKPPK.',
    '.KPPKPKKKKPPKttPPttKPPKKKKPKPPK.',
    '.KMMKMMMMMMMKtPPPPtKMMMMMMMKMMK.',
    '.KMmKMmmmmmmKtPYYPtKmmmmmmMKmMK.',
    '.KMmKMmmMMmmKtPPPPtKmmMMmmMKmMK.',
    '.KmmKmMMMMMmKtPPPPtKmMMMMMmKmmK.',
    '.KmmKmmmmmmmKttPPttKmmmmmmmKmmK.',
    '.KMmKMMmmmMMKKKKKKKKMMmmmMMKmMK.',
    '.KmmKmmmmmmmmmmmmmmmmmmmmmmKmmK.',
    '.KKKKKKKKKKKKKKKKKKKKKKKKKKKKKK.',
    '..r..O....................O..r..',
    '................................',
  ] as SpriteGrid,

  /** 3-frame 24x24 pulsating techno-organic dimensional portal (shared base). */
  portalAlien: [
    // Frame 0
    [
      '.......KKAAAAAACK.......',
      '.....KKAAccccccAAKK.....',
      '....KAmAAccWWccAAmAK....',
      '...KmmAccCCCCCCccAmmK...',
      '..KmMAcCCAAWWAAcCCAMmK..',
      '..KmAcCAcCCCCCCcACcAmK..',
      '.KmMcCAAcCCWWCCcAACcMmK.',
      '.KmAcCAccCCCCCCccACcAmK.',
      '.KmAcCAcCCcWWcCCCACcAmK.',
      '.KmAcCAcCCcWWcCCCACcAmK.',
      '.KmMcCAAcCCCCCCcAACcMmK.',
      '..KmAcCAcCCWWCCcACcAmK..',
      '..KmMAcCCAAAAAAcCCAMmK..',
      '...KmmAccCCCCCCccAmmK...',
      '...KmmMAAccccccAAMmmK...',
      '....KmMMAAAAAAAAAMmK....',
      '....KmmEEEEEEEEEEmmK....',
      '...KMmmEEccccccEEmmMK...',
      '..KMMmmEEEEEEEEEEmmMMK..',
      '..KmmmmmmmmmmmmmmmmmmK..',
      '...KKKKKKKKKKKKKKKKKK...',
      '........................',
      '........................',
      '........................',
    ],
    // Frame 1
    [
      '......KKcAAAAAACKK......',
      '.....KAccWWWWWWccAK.....',
      '....KAmAcCCCCCCcAmAK....',
      '...KmmACcAAWWAAcCAmmK...',
      '..KmMAcCAcCCCCcACcAMmK..',
      '..KmAcCAcCcWWcCcACcAmK..',
      '.KmMcCAccCWWWWCccACcMmK.',
      '.KmAcCAcCCWWWWCCCACcAmK.',
      '.KmAcCAcCCcWWcCCCACcAmK.',
      '.KmAcCAcCCWWWWCCCACcAmK.',
      '.KmMcCAccCWWWWCccACcMmK.',
      '..KmAcCAcCcWWcCcACcAmK..',
      '..KmMAcCAcCCCCcACcAMmK..',
      '...KmmACcAAAAAAcCAmmK...',
      '...KmmMAccCCCCccAMmmK...',
      '....KmMMAAAAAAAAAMmK....',
      '....KmmEEccccccEEmmK....',
      '...KMmmEEccWWccEEmmMK...',
      '..KMMmmEEEEEEEEEEmmMMK..',
      '..KmmmmmmmmmmmmmmmmmmK..',
      '...KKKKKKKKKKKKKKKKKK...',
      '........................',
      '........................',
      '........................',
    ],
    // Frame 2
    [
      '.......KKcCCCCcKK.......',
      '.....KKAAcCCCCcAAKK.....',
      '....KAmAAcWWWWcAAmAK....',
      '...KmmAccCCCCCCccAmmK...',
      '..KmMAcCCcAAAAcCCCAMmK..',
      '..KmAcCAcCCCCCCcACcAmK..',
      '.KmMcCAcCCcWWcCCCACcMmK.',
      '.KmAcCAcCCWWWWCCCACcAmK.',
      '.KmAcCAccWWWWWWccACcAmK.',
      '.KmAcCAcCCWWWWCCCACcAmK.',
      '.KmMcCAcCCcWWcCCCACcMmK.',
      '..KmAcCAcCCCCCCcACcAmK..',
      '..KmMAcCCcAAAAcCCCAMmK..',
      '...KmmAccCCCCCCccAmmK...',
      '...KmmMAAccWWccAAMmmK...',
      '....KmMMAAAAAAAAAMmK....',
      '....KmmEEEEEEEEEEmmK....',
      '...KMmmEECCCCCCEEmmMK...',
      '..KMMmmEEEEEEEEEEmmMMK..',
      '..KmmmmmmmmmmmmmmmmmmK..',
      '...KKKKKKKKKKKKKKKKKK...',
      '........................',
      '........................',
      '........................',
    ],
  ] as readonly SpriteGrid[],

  /** Per-room themed 3-frame 24x24 alien portal variants for Sanctuary perimeter gates. */
  portalByRoom: {
    cyber_chasm: [
      [
        '.......KKAAAAAACK.......',
        '.....KKAAcAAAAcAAKK.....',
        '....KAmAAcWWWWcAAmAK....',
        '...KmmAccAAAAAAccAmmK...',
        '..KmMAcCAAcWWcAAACAMmK..',
        '..KmAcCAcAAAAAAcACcAmK..',
        '.KmMcCAAcAAWWAAcAACcMmK.',
        '.KmAcCAccCCCCCCccACcAmK.',
        '.KmAcCAcCCcWWcCCCACcAmK.',
        '.KmAcCAcCCcWWcCCCACcAmK.',
        '.KmMcCAAcCCCCCCcAACcMmK.',
        '..KmAcCAcAAWWAAcACcAmK..',
        '..KmMAcCCAAAAAAcCCAMmK..',
        '...KmmAccAAAAAAccAmmK...',
        '...KmmMAAcAAAAcAAMmmK...',
        '....KmMMAAAAAAAAAMmK....',
        '....KmmAAccccccAAmmK....',
        '...KMmmAAccccccAAmmMK...',
        '..KMMmmAAAAAAAAAAmmMMK..',
        '..KmmmmmmmmmmmmmmmmmmK..',
        '...KKKKKKKKKKKKKKKKKK...',
        '........................',
        '........................',
        '........................',
      ],
      [
        '......KKcAAAAAACKK......',
        '.....KAAcWWWWWWcAAK.....',
        '....KAmAcAAAAAAcAmAK....',
        '...KmmACcAAWWAAcCAmmK...',
        '..KmMAcCAcCCCCcACcAMmK..',
        '..KmAcCAcCcWWcCcACcAmK..',
        '.KmMcCAccAWWWWAAAACcMmK.',
        '.KmAcCAcAAWWWWAAAACcAmK.',
        '.KmAcCAcCCcWWcCCCACcAmK.',
        '.KmAcCAcAAWWWWAAAACcAmK.',
        '.KmMcCAccAWWWWAAAACcMmK.',
        '..KmAcCAcCcWWcCcACcAmK..',
        '..KmMAcCAcCCCCcACcAMmK..',
        '...KmmACcAAAAAAcCAmmK...',
        '...KmmMAccAAAAccAMmmK...',
        '....KmMMAAAAAAAAAMmK....',
        '....KmmAAcWWWWcAAmmK....',
        '...KMmmAAccccccAAmmMK...',
        '..KMMmmAAAAAAAAAAmmMMK..',
        '..KmmmmmmmmmmmmmmmmmmK..',
        '...KKKKKKKKKKKKKKKKKK...',
        '........................',
        '........................',
        '........................',
      ],
      [
        '.......KKcAAAAcKK.......',
        '.....KKAAcCCCCcAAKK.....',
        '....KAmAAcWWWWcAAmAK....',
        '...KmmAccCCCCCCccAmmK...',
        '..KmMAcCCcAAAAcCCCAMmK..',
        '..KmAcCAcCCCCCCcACcAmK..',
        '.KmMcCAcCCcWWcCCCACcMmK.',
        '.KmAcCAcCCWWWWCCCACcAmK.',
        '.KmAcCAAWWWWWWAAACcAmK..',
        '.KmAcCAcCCWWWWCCCACcAmK.',
        '.KmMcCAcCCcWWcCCCACcMmK.',
        '..KmAcCAcCCCCCCcACcAmK..',
        '..KmMAcCCcAAAAcCCCAMmK..',
        '...KmmAccCCCCCCccAmmK...',
        '...KmmMAAccWWccAAMmmK...',
        '....KmMMAAAAAAAAAMmK....',
        '....KmmAAAAAAAAAAmmK....',
        '...KMmmAACCCCCCAAmmMK...',
        '..KMMmmAAAAAAAAAAmmMMK..',
        '..KmmmmmmmmmmmmmmmmmmK..',
        '...KKKKKKKKKKKKKKKKKK...',
        '........................',
        '........................',
        '........................',
      ],
    ] as readonly SpriteGrid[],
    bio_forge: [
      [
        '.......KKEEEEEEEK.......',
        '.....KKEEOOOOOOEEKK.....',
        '....KPtEEOWWWWOEEtPK....',
        '...KttEccEEEEEEccEttK...',
        '..KtPEcEEOOYYOOcEEEPtK..',
        '..KtEcEEcEEEEEEcEEcEtK..',
        '.KtMEcEEcEEWWEEcEEcEMtK.',
        '.KtEcEEccEEEEEEccEEcEtK.',
        '.KtEcEEcEEcWWcEEEEcEtK..',
        '.KtEcEEcEEcWWcEEEEcEtK..',
        '.KtMEcEEcEEEEEEcEEcEMtK.',
        '..KtEcEEcEEWWEEcEEcEtK..',
        '..KtPEcEEOOOOOOcEEEPtK..',
        '...KttEccEEEEEEccEttK...',
        '...KttPEEOOOOOOEEPtTK...',
        '....KtPPEEEEEEEEEPPK....',
        '....KttOOOOOOOOOOttK....',
        '...KPttOOYYYYYYOOttPK...',
        '..KPPttOOOOOOOOOOttPPK..',
        '..KttttttttttttttttttK..',
        '...KKKKKKKKKKKKKKKKKK...',
        '........................',
        '........................',
        '........................',
      ],
      [
        '......KKOEEEEEEOKK......',
        '.....KEEOWWWWWWOEEK.....',
        '....KPtEcEEEEEEcEtPK....',
        '...KttECcEEYYEEcCEttK...',
        '..KtPEcEEcEEEEcEEcEPtK..',
        '..KtEcEEcEcWWcEcEEcEtK..',
        '.KtMEcEccEWWWWOccEEcEMtK',
        '.KtEcEEcEEWWWWEEEEcEtK..',
        '.KtEcEEcEEcWWcEEEEcEtK..',
        '.KtEcEEcEEWWWWEEEEcEtK..',
        '.KtMEcEccEWWWWOccEEcEMtK',
        '..KtEcEEcEcWWcEcEEcEtK..',
        '..KtPEcEEcEEEEcEEcEPtK..',
        '...KttECcEEEEEEcCEttK...',
        '...KttPEccEEEEccEPttK...',
        '....KtPPEEEEEEEEEPPK....',
        '....KttOOYYYYYYOOttK....',
        '...KPttOOYYWWYYOOttPK...',
        '..KPPttOOOOOOOOOOttPPK..',
        '..KttttttttttttttttttK..',
        '...KKKKKKKKKKKKKKKKKK...',
        '........................',
        '........................',
        '........................',
      ],
      [
        '.......KKOEEEEOKK.......',
        '.....KKEEOYYYYOEEKK.....',
        '....KPtEEOWWWWOOEtPK....',
        '...KttEccEEEEEEccEttK...',
        '..KtPEcEEcOOOOcEEEPtK...',
        '..KtEcEEcEEEEEEcEEcEtK..',
        '.KtMEcEEcEEWWEEcEEcEMtK.',
        '.KtEcEEcEEWWWWEEEEcEtK..',
        '.KtEcEEccWWWWWWccEEcEtK.',
        '.KtEcEEcEEWWWWEEEEcEtK..',
        '.KtMEcEEcEEWWEEcEEcEMtK.',
        '..KtEcEEcEEEEEEcEEcEtK..',
        '..KtPEcEEcOOOOcEEEPtK...',
        '...KttEccEEEEEEccEttK...',
        '...KttPEEccWWccEEPttK...',
        '....KtPPEEEEEEEEEPPK....',
        '....KttOOOOOOOOOOttK....',
        '...KPttOOEEEEEEOOttPK...',
        '..KPPttOOOOOOOOOOttPPK..',
        '..KttttttttttttttttttK..',
        '...KKKKKKKKKKKKKKKKKK...',
        '........................',
        '........................',
        '........................',
      ],
    ] as readonly SpriteGrid[],
    signal_beacon: [
      [
        '.......KKCCCCCCCK.......',
        '.....KKCCccccccCCKK.....',
        '....KMnCCccWWccCCnMK....',
        '...KmnCccCCCCCCccCnmK...',
        '..KmNCcCCCCWWCCCCcCNmK..',
        '..KmCcCCcCCCCCCcCCcCmK..',
        '.KmMCcCCcCCWWCCcCCcCMmK.',
        '.KmCcCCccCCCCCCccCCcCmK.',
        '.KmCcCCcCCcWWcCCCCcCmK..',
        '.KmCcCCcCCcWWcCCCCcCmK..',
        '.KmMCcCCcCCCCCCcCCcCMmK.',
        '..KmCcCCcCCWWCCcCCcCmK..',
        '..KmNCcCCCCWWCCCCcCNmK..',
        '...KmnCccCCCCCCccCnmK...',
        '...KmnMCCccccccCCMnMK...',
        '....KmMMCCCCCCCCCMmK....',
        '....KmmNNNNNNNNNNmmK....',
        '...KMmmNNccccccNNmmMK...',
        '..KMMmmNNNNNNNNNNmmMMK..',
        '..KmmmmmmmmmmmmmmmmmmK..',
        '...KKKKKKKKKKKKKKKKKK...',
        '........................',
        '........................',
        '........................',
      ],
      [
        '......KKcCCCCCCcKK......',
        '.....KCCcWWWWWWcCCK.....',
        '....KMnCcCCCCCCcCnMK....',
        '...KmnCCcCCWWCCcCCnmK...',
        '..KmNCcCCcCCCCcCCcCNmK..',
        '..KmCcCCcCcWWcCcCCcCmK..',
        '.KmMCcCccCWWWWCccCCcCMmK',
        '.KmCcCCcCCWWWWCCCCcCmK..',
        '.KmCcCCcCCcWWcCCCCcCmK..',
        '.KmCcCCcCCWWWWCCCCcCmK..',
        '.KmMCcCccCWWWWCccCCcCMmK',
        '..KmCcCCcCcWWcCcCCcCmK..',
        '..KmNCcCCcCCCCcCCcCNmK..',
        '...KmnCCcCCCCCCcCCnmK...',
        '...KmnMCccCCCCccCMnMK...',
        '....KmMMCCCCCCCCCMmK....',
        '....KmmNNccccccNNmmK....',
        '...KMmmNNccWWccNNmmMK...',
        '..KMMmmNNNNNNNNNNmmMMK..',
        '..KmmmmmmmmmmmmmmmmmmK..',
        '...KKKKKKKKKKKKKKKKKK...',
        '........................',
        '........................',
        '........................',
      ],
      [
        '.......KKcCCCCcKK.......',
        '.....KKCCcWWWWcCCKK.....',
        '....KMnCCcWWWWcCCnMK....',
        '...KmnCccCCCCCCccCnmK...',
        '..KmNCcCCcCCCCcCCcCNmK..',
        '..KmCcCCcCCCCCCcCCcCmK..',
        '.KmMCcCCcCCWWCCcCCcCMmK.',
        '.KmCcCCcCCWWWWCCCCcCmK..',
        '.KmCcCCccWWWWWWccCCcCmK.',
        '.KmCcCCcCCWWWWCCCCcCmK..',
        '.KmMCcCCcCCWWCCcCCcCMmK.',
        '..KmCcCCcCCCCCCcCCcCmK..',
        '..KmNCcCCcCCCCcCCcCNmK..',
        '...KmnCccCCCCCCccCnmK...',
        '...KmnMCCccWWccCCMnMK...',
        '....KmMMCCCCCCCCCMmK....',
        '....KmmNNNNNNNNNNmmK....',
        '...KMmmNNCCCCCCNNmmMK...',
        '..KMMmmNNNNNNNNNNmmMMK..',
        '..KmmmmmmmmmmmmmmmmmmK..',
        '...KKKKKKKKKKKKKKKKKK...',
        '........................',
        '........................',
        '........................',
      ],
    ] as readonly SpriteGrid[],
  },

  /** 3-frame 24x24 prominent golden/cyan return warp vortex (`⇄ Campfire Sanctuary`). */
  returnPortal: [
    [
      '.......KKYYYYYYKK.......',
      '.....KKYYccccccYYKK.....',
      '....KYYOOcWWWWcOOYYK....',
      '...KYYOccCCCCCCccOYYK...',
      '..KYOcCCCYYWWYYCCCcOYK..',
      '..KYOcCcCCCCCCCCcCcOYK..',
      '.KYOCCCcCCWWWWCCcCCCOYK.',
      '.KYOCCCcCWWccWWCcCCCOYK.',
      '.KYOCCCcCWWccWWCcCCCOYK.',
      '.KYOCCCcCCWWWWCCcCCCOYK.',
      '..KYOcCcCCCCCCCCcCcOYK..',
      '..KYOcCCCYYWWYYCCCcOYK..',
      '...KYYOccCCCCCCccOYYK...',
      '....KYYOOcWWWWcOOYYK....',
      '.....KKYYccccccYYKK.....',
      '......KmmYYYYYYmmK......',
      '.....KMmmOOOOOOmmMK.....',
      '....KMMmmYYYYYYmmMMK....',
      '....KmmmmmmmmmmmmmmK....',
      '.....KKKKKKKKKKKKKK.....',
      '........................',
      '........................',
      '........................',
      '........................',
    ],
    [
      '......KKcYYYYYYcKK......',
      '.....KYOYWWWWWWYOYK.....',
      '....KYOcCCCCCCCCcOYK....',
      '...KYYCcYYWWWWYYcCYYK...',
      '..KYOCCcCCCCCCCCcCCOYK..',
      '..KYOCcCCcWWWWcCCcCOYK..',
      '.KYOCCcCCWWWWWWCCcCCOYK.',
      '.KYOCCcCCWWccWWCCcCCOYK.',
      '.KYOCCcCCWWWWWWCCcCCOYK.',
      '.KYOCCcCCcWWWWcCCcCCOYK.',
      '..KYOCcCCCCCCCCCCcCOYK..',
      '..KYOCCcYYYYYYYYcCCOYK..',
      '...KYYCcCCCCCCCCcCYYK...',
      '....KYOcCCCCCCCCcOYK....',
      '.....KYOYccccccYOYK.....',
      '......KmmYYYYYYmmK......',
      '.....KMmmYYWWYYmmMK.....',
      '....KMMmmYYYYYYmmMMK....',
      '....KmmmmmmmmmmmmmmK....',
      '.....KKKKKKKKKKKKKK.....',
      '........................',
      '........................',
      '........................',
      '........................',
    ],
    [
      '.......KKcYYYYcKK.......',
      '.....KKYYcCCCCcYYKK.....',
      '....KYYOOcWWWWcOOYYK....',
      '...KYYCccCCCCCCccCYYK...',
      '..KYOcCCCcYYYYcCCCcOYK..',
      '..KYOcCCcCCCCCCcCCcOYK..',
      '.KYOCCCcCCcWWcCCcCCCOYK.',
      '.KYOCCCccWWWWWWccCCCOYK.',
      '.KYOCCCcCCWWWWCCcCCCOYK.',
      '.KYOCCCcCCcWWcCCcCCCOYK.',
      '..KYOcCCcCCCCCCcCCcOYK..',
      '..KYOcCCCcYYYYcCCCcOYK..',
      '...KYYCccCCCCCCccCYYK...',
      '....KYYOOccWWccOOYYK....',
      '.....KKYYccccccYYKK.....',
      '......KmmYYYYYYmmK......',
      '.....KMmmOOOOOOmmMK.....',
      '....KMMmmYYYYYYmmMMK....',
      '....KmmmmmmmmmmmmmmK....',
      '.....KKKKKKKKKKKKKK.....',
      '........................',
      '........................',
      '........................',
      '........................',
    ],
  ] as readonly SpriteGrid[],

  /** 24x24 Cyber-Chasm Obsidian Era Monolith with purple & cyan circuit runes. */
  eraObelisk: [
    '...........KK...........',
    '..........KccK..........',
    '.........KcAAcK.........',
    '..........KAAK..........',
    '..........KKKK..........',
    '.........KMmmMK.........',
    '........KMmmmmMK........',
    '........KmCAACKm........',
    '.......KmCAAACmmK.......',
    '.......KmmmAAmmmK.......',
    '.......KmmCAACmmK.......',
    '......KmmAAAAACmmK......',
    '......KmAAmCCmAAmK......',
    '......KmmAAmmAAmmK......',
    '.....KmmmAAAAAAmmmK.....',
    '.....KmmCAmnnmACmmK.....',
    '.....KmmmccccccmmmK.....',
    '....KMmmmmmAAmmmmmMK....',
    '....KMMmmmmmmmmmmMMK....',
    '...KMmmMmmmAAmmmMmmMK...',
    '..KMMmmmmmAAAAmmmmMMMK..',
    '..KmmmmmmmmmmmmmmmmmmK..',
    '..KKKKKKKKKKKKKKKKKKKK..',
    '........................',
  ] as SpriteGrid,

  /** 24x24 Bio-Forge alien biomechanical glass containment pod. */
  bioPod: [
    '.......KKKKKKKKKK.......',
    '......KmMMMMMMMMmK......',
    '.....KmmOOOOOOOOmmK.....',
    '.....KmKKKKKKKKKKmK.....',
    '....KnNCcCCCCCCcCNnK....',
    '....KnNCcEEEEEEcCNnK....',
    '....KnNCEEEWWEEECNnK....',
    '....KnNCEEWEEWEECNnK....',
    '...EKnNCEEEEEEEECNnKE...',
    '..EEKnNCEEEccEEECNnKEE..',
    '..E.KnNCEEcEEcEECNnK.E..',
    '....KnNCcEEEEEEcCNnK....',
    '....KnNCcCCCCCCcCNnK....',
    '.....KmKKKKKKKKKKmK.....',
    '....KmmOOOOOOOOOOmmK....',
    '....KmPPTTTTTTTTPPmK....',
    '...KmPPOOOYYYYOOOPPmK...',
    '...KmPPOOOOOOOOOOPPmK...',
    '..KMmPPPPOOOOOOOOmmMK...',
    '..KMmmmmOOOOOOOOOmmmMK..',
    '..KmmmmmOOOOOOOOOmmmmK..',
    '.KmmmmmmmmmmmmmmmmmmmmK.',
    '.KKKKKKKKKKKKKKKKKKKKKK.',
    '........................',
  ] as SpriteGrid,

  /** 24x24 Signal Beacon high-orbit alien radio observatory dish. */
  beaconDish: [
    '...........cc...........',
    '..........cWWc..........',
    '.........CcCCcC.........',
    '..........KCCK..........',
    '......KKKKKccKKKKK......',
    '....KKMMMMcWWcMMMMKK....',
    '...KMMmmmmCCCCmmmmMMK...',
    '..KMmmCCCcWWWWcCCCmmMK..',
    '..KMmCCccCCCCCCccCCmMK..',
    '...KMmmmmCCCCCCmmmmMK...',
    '....KKMmmmmmmmmmmMKK....',
    '......KKKKMnnMKKKK......',
    '.........KMmmMK.........',
    '........KMmCCmMK........',
    '........KMmmmmMK........',
    '.......KMmMccMmMK.......',
    '.......KMmmCCmmMK.......',
    '......KMmMmCCmMmMK......',
    '......KMmmmmmmmmMK......',
    '....KKMmmmCCCCmmmMKK....',
    '...KMmmmmmmmmmmmmmmMK...',
    '..KMMmmmmNNNNNNmmmmMMK..',
    '..KKKKKKKKKKKKKKKKKKKK..',
    '........................',
  ] as SpriteGrid,

  /** 24x16 woven crimson & amber hearth mat placed under The Dog. */
  wovenMat: [
    '........................',
    '..rrrrrrrrrrrrrrrrrrrr..',
    '.rRRRRRRRRRRRRRRRRRRRRr.',
    'FrROYYORROYYYYORROYYORFr',
    'FrROYYORROYYYYORROYYORFr',
    '.rRROORRROYYYYORRROORRr.',
    'FrROYYORROYYYYORROYYORFr',
    'FrROYYORROYYYYORROYYORFr',
    '.rRROORRROYYYYORRROORRr.',
    'FrROYYORROYYYYORROYYORFr',
    'FrROYYORROYYYYORROYYORFr',
    '.rRRRRRRRRRRRRRRRRRRRRr.',
    '..rrrrrrrrrrrrrrrrrrrr..',
    '........................',
    '........................',
    '........................',
  ] as SpriteGrid,

  /** 16x24 campfire comms radio antenna beside RASS hologram. */
  commsAntenna: [
    '.......cW.......',
    '......cCCc......',
    '.......KK.......',
    '.......MK.......',
    '......KMMK......',
    '.......MK.......',
    '....KKKMMKKK....',
    '...KCCCMMCCCK...',
    '.......MK.......',
    '......KMMK......',
    '.....KMmmMK.....',
    '......KMMK......',
    '.....KMCCMK.....',
    '.....KMmmMK.....',
    '....KMmmmmMK....',
    '....KMmCCmMK....',
    '...KMmmmmmmMK...',
    '...KMmMnnMmMK...',
    '..KMmmmmmmmmMK..',
    '..KMmCCCCCCmMK..',
    '..KmmmmmmmmmmK..',
    '..KKKKKKKKKKKK..',
    '................',
    '................',
  ] as SpriteGrid,

  /** 24x16 carved timber bench where Ms. Devil lounges. */
  timberBench: [
    '........................',
    '........................',
    '..KKKKKKKKKKKKKKKKKKKK..',
    '.KTTTTTTTTTTTTTTTTTTTTK.',
    '.KPPPPPPPPPPPPPPPPPPPPK.',
    '..KKKKKKKKKKKKKKKKKKKK..',
    '.KTTTTTTTTTTTTTTTTTTTTK.',
    '.KPPYYPPPPPPPPPPPPYYPPK.',
    '.KPPPPPPPPPPPPPPPPPPPPK.',
    '..KttttttttttttttttttK..',
    '..KttK............KttK..',
    '..KttK............KttK..',
    '..KKK..............KKK..',
    '........................',
    '........................',
    '........................',
  ] as SpriteGrid,

  /** 16x16 Mimic Roast Chest (closed & open). */
  roastChest: {
    closed: [
      '................',
      '................',
      '..KKKKKKKKKKKK..',
      '.KYYYYYYYYYYYYK.',
      'KYPPPPPPPPPPPPYK',
      'KYPPPPPYYPPPPPYK',
      'KKKKKKKKKKKKKKKK',
      'KYPPPKYRRYKPPPYK',
      'KYYYYKYYYYKYYYYK',
      'KPPPPKKKKKKPPPPK',
      'KPPPPMmmmmMPPPPK',
      'KYYYYPPPPPPYYYYK',
      'KPPPPPPPPPPPPPPK',
      '.KKKKKKKKKKKKKK.',
      '................',
      '................',
    ] as SpriteGrid,
    open: [
      '.KKKKKKKKKKKKKK.',
      'KYYYYYYYYYYYYYYK',
      'KYPPPPPPPPPPPPYK',
      'KYYYYYYYYYYYYYYK',
      '.KKKKKKKKKKKKKK.',
      '.KWWKWWKKWWKWWK.',
      'KYYKKKKKKKKKKYYK',
      'KPKKRRRRRRRRKKPK',
      'KYKROOOYYOOORKYK',
      'KPKRRRRRRRRRRKPK',
      'KYYYYPPPPPPYYYYK',
      'KPPPPPPPPPPPPPPK',
      'KPPPPMmmmmMPPPPK',
      '.KKKKKKKKKKKKKK.',
      '................',
      '................',
    ] as SpriteGrid,
  },

  /** 12x12 pixel heart bubble for petting The Dog. */
  heart: [
    '..KKK..KKK..',
    '.KRRRKKRRRK.',
    'KRWRRRRRRRRK',
    'KRRRRRRRRRRK',
    'KRRRRRRRRRRK',
    '.KRRRRRRRRK.',
    '..KRRRRRRK..',
    '...KRRRRK...',
    '....KRRK....',
    '.....KK.....',
    '............',
    '............',
  ] as SpriteGrid,
};

/**
 * Draw any palette-mapped sprite grid directly onto a CanvasRenderingContext2D at (x, y).
 * Safe for both PixiJS offscreen texture baking and Canvas2D fallback rendering.
 */
export function drawMatrixFrame(
  ctx: CanvasRenderingContext2D,
  matrix: SpriteGrid,
  palette: SpritePalette = SPRITE_PALETTE,
  x = 0,
  y = 0,
  pixelSize = 1,
): void {
  const height = matrix.length;
  const step = Math.max(1, Math.round(pixelSize));

  for (let row = 0; row < height; row += 1) {
    const line = matrix[row];
    for (let col = 0; col < line.length; col += 1) {
      const code = line[col];
      if (code === '.' || code === ' ') continue;
      // Support lowercase 'k' as obsidian outline fallback if referenced by legacy callers.
      const color = palette[code] ?? (code === 'k' ? palette.K : undefined);
      if (!color) continue;
      ctx.fillStyle = color;
      ctx.fillRect(
        Math.round(x + col * step),
        Math.round(y + row * step),
        step,
        step,
      );
    }
  }
}

/**
 * Render a sprite grid into an offscreen HTMLCanvasElement with crisp pixel sizing.
 */
export function renderMatrixToCanvas(
  matrix: SpriteGrid,
  palette: SpritePalette = SPRITE_PALETTE,
  pixelSize = 3,
): HTMLCanvasElement {
  const rows = matrix.length;
  const cols = matrix[0]?.length ?? 1;
  const scale = Math.max(1, Math.round(pixelSize));
  const canvas = document.createElement('canvas');
  canvas.width = cols * scale;
  canvas.height = rows * scale;

  const ctx = canvas.getContext('2d');
  if (ctx) {
    ctx.imageSmoothingEnabled = false;
    drawMatrixFrame(ctx, matrix, palette, 0, 0, scale);
  }
  return canvas;
}

/**
 * Convert an offscreen canvas into a PixiJS Texture locked to `scaleMode: 'nearest'`.
 */
function canvasToTexture<T>(
  canvas: HTMLCanvasElement,
  TextureClass?: TextureClassLike<T> | null,
  CanvasSourceClass?: CanvasSourceClassLike,
): T {
  if (!TextureClass) {
    return canvas as unknown as T;
  }

  let texture: T;
  if (CanvasSourceClass) {
    const source = new CanvasSourceClass({
      resource: canvas,
      scaleMode: 'nearest',
    });
    texture = TextureClass.from(source);
  } else {
    texture = TextureClass.from(canvas);
    const texObj = texture as unknown as TextureLike;
    if (texObj?.source) {
      texObj.source.scaleMode = 'nearest';
      if (texObj.source.style) {
        texObj.source.style.scaleMode = 'nearest';
      }
    }
  }
  return texture;
}

/**
 * Build all procedural sprite frames onto offscreen canvases and optionally wrap
 * them in nearest-neighbor PixiJS Textures via `TextureClass`.
 * Passing `null`/`undefined` returns raw offscreen canvases directly for Canvas2D fallback.
 */
export function createSpriteTextureSet<T = HTMLCanvasElement>(
  TextureClass?: TextureClassLike<T> | null,
  opts: SpriteBuildOptions = {},
): SpriteTextureSet<T> {
  const pixelSize = opts.pixelSize ?? 3;
  // Slightly tighter pixel scale (2x) for 24x24 & 32x24 monuments so world proportions stay balanced.
  const monumentScale = Math.max(2, Math.round(pixelSize * 0.75));

  const makePair = (grid: SpriteGrid, scale = pixelSize) => {
    const canvas = renderMatrixToCanvas(grid, SPRITE_PALETTE, scale);
    const texture = canvasToTexture(canvas, TextureClass, opts.CanvasSourceClass);
    return { canvas, texture };
  };

  const borisCanvases: Record<BorisSpriteChannel, HTMLCanvasElement[]> = {
    down: [],
    up: [],
    left: [],
    right: [],
    idleMug: [],
  };
  const borisTextures: Record<BorisSpriteChannel, T[]> = {
    down: [],
    up: [],
    left: [],
    right: [],
    idleMug: [],
  };

  for (const channel of ['down', 'up', 'left', 'right', 'idleMug'] as const) {
    for (const grid of BORIS_SPRITE_FRAMES[channel]) {
      const { canvas, texture } = makePair(grid, pixelSize);
      borisCanvases[channel].push(canvas);
      borisTextures[channel].push(texture);
    }
  }

  const sleepingDogPairs = SLEEPING_DOG_FRAMES.map((grid) => makePair(grid, pixelSize));
  const dogWakePairs = DOG_WAKE_FRAMES.map((grid) => makePair(grid, pixelSize));
  const rassPairs = RASS_DRONE_FRAMES.map((grid) => makePair(grid, pixelSize));
  const devilPairs = MS_DEVIL_FRAMES.map((grid) => makePair(grid, pixelSize));
  const campfirePairs = WORLD_OBJECT_SPRITES.campfire.map((grid) => makePair(grid, monumentScale));
  const shelterPair = makePair(WORLD_OBJECT_SPRITES.shelter, monumentScale);
  const armoryPair = makePair(WORLD_OBJECT_SPRITES.armoryLodge, monumentScale);
  const portalAlienPairs = WORLD_OBJECT_SPRITES.portalAlien.map((grid) =>
    makePair(grid, monumentScale),
  );
  const portalByRoomPairs: Record<AlienRoomPortalId, Array<{ canvas: HTMLCanvasElement; texture: T }>> = {
    cyber_chasm: WORLD_OBJECT_SPRITES.portalByRoom.cyber_chasm.map((g) => makePair(g, monumentScale)),
    bio_forge: WORLD_OBJECT_SPRITES.portalByRoom.bio_forge.map((g) => makePair(g, monumentScale)),
    signal_beacon: WORLD_OBJECT_SPRITES.portalByRoom.signal_beacon.map((g) =>
      makePair(g, monumentScale),
    ),
  };
  const returnPortalPairs = WORLD_OBJECT_SPRITES.returnPortal.map((grid) =>
    makePair(grid, monumentScale),
  );
  const obeliskPair = makePair(WORLD_OBJECT_SPRITES.eraObelisk, monumentScale);
  const bioPodPair = makePair(WORLD_OBJECT_SPRITES.bioPod, monumentScale);
  const beaconDishPair = makePair(WORLD_OBJECT_SPRITES.beaconDish, monumentScale);
  const wovenMatPair = makePair(WORLD_OBJECT_SPRITES.wovenMat, monumentScale);
  const commsAntennaPair = makePair(WORLD_OBJECT_SPRITES.commsAntenna, monumentScale);
  const timberBenchPair = makePair(WORLD_OBJECT_SPRITES.timberBench, monumentScale);
  const chestClosedPair = makePair(WORLD_OBJECT_SPRITES.roastChest.closed, pixelSize);
  const chestOpenPair = makePair(WORLD_OBJECT_SPRITES.roastChest.open, pixelSize);
  const heartPair = makePair(WORLD_OBJECT_SPRITES.heart, Math.max(2, pixelSize - 1));

  const sleepingDogCanvases = sleepingDogPairs.map((p) => p.canvas);
  const sleepingDogTextures = sleepingDogPairs.map((p) => p.texture);

  debugLog('Generated SPEC-022 24-color procedural sprite sheet', {
    paletteColors: Object.keys(SPRITE_PALETTE).length,
    borisWalkFrames:
      borisCanvases.down.length +
      borisCanvases.up.length +
      borisCanvases.left.length +
      borisCanvases.right.length,
    borisIdleMugFrames: borisCanvases.idleMug.length,
    sleepingDogFrames: sleepingDogPairs.length,
    dogWakeFrames: dogWakePairs.length,
    rassFrames: rassPairs.length,
    msDevilFrames: devilPairs.length,
    campfireFrames: campfirePairs.length,
    portalFrames: portalAlienPairs.length,
    returnPortalFrames: returnPortalPairs.length,
    hasPixiTextureClass: Boolean(TextureClass),
    pixelSize,
  });

  return {
    pixelSize,
    canvases: {
      boris: borisCanvases,
      sleepingDog: sleepingDogCanvases,
      dogWake: dogWakePairs.map((p) => p.canvas),
      whiteDog: sleepingDogCanvases,
      rassDrone: rassPairs.map((p) => p.canvas),
      msDevil: devilPairs.map((p) => p.canvas),
      worldObjects: {
        campfire: campfirePairs.map((p) => p.canvas),
        shelter: shelterPair.canvas,
        armoryLodge: armoryPair.canvas,
        portalAlien: portalAlienPairs.map((p) => p.canvas),
        portalByRoom: {
          cyber_chasm: portalByRoomPairs.cyber_chasm.map((p) => p.canvas),
          bio_forge: portalByRoomPairs.bio_forge.map((p) => p.canvas),
          signal_beacon: portalByRoomPairs.signal_beacon.map((p) => p.canvas),
        },
        returnPortal: returnPortalPairs.map((p) => p.canvas),
        eraObelisk: obeliskPair.canvas,
        bioPod: bioPodPair.canvas,
        beaconDish: beaconDishPair.canvas,
        wovenMat: wovenMatPair.canvas,
        commsAntenna: commsAntennaPair.canvas,
        timberBench: timberBenchPair.canvas,
        relicPedestal: bioPodPair.canvas,
        trophyPedestal: armoryPair.canvas,
        beaconTower: beaconDishPair.canvas,
        roastChest: {
          closed: chestClosedPair.canvas,
          open: chestOpenPair.canvas,
        },
        heart: heartPair.canvas,
      },
    },
    boris: borisTextures,
    sleepingDog: sleepingDogTextures,
    dogWake: dogWakePairs.map((p) => p.texture),
    whiteDog: sleepingDogTextures,
    rassDrone: rassPairs.map((p) => p.texture),
    msDevil: devilPairs.map((p) => p.texture),
    worldObjects: {
      campfire: campfirePairs.map((p) => p.texture),
      shelter: shelterPair.texture,
      armoryLodge: armoryPair.texture,
      portalAlien: portalAlienPairs.map((p) => p.texture),
      portalByRoom: {
        cyber_chasm: portalByRoomPairs.cyber_chasm.map((p) => p.texture),
        bio_forge: portalByRoomPairs.bio_forge.map((p) => p.texture),
        signal_beacon: portalByRoomPairs.signal_beacon.map((p) => p.texture),
      },
      returnPortal: returnPortalPairs.map((p) => p.texture),
      eraObelisk: obeliskPair.texture,
      bioPod: bioPodPair.texture,
      beaconDish: beaconDishPair.texture,
      wovenMat: wovenMatPair.texture,
      commsAntenna: commsAntennaPair.texture,
      timberBench: timberBenchPair.texture,
      relicPedestal: bioPodPair.texture,
      trophyPedestal: armoryPair.texture,
      beaconTower: beaconDishPair.texture,
      roastChest: {
        closed: chestClosedPair.texture,
        open: chestOpenPair.texture,
      },
      heart: heartPair.texture,
    },
  };
}
