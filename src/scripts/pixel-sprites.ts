/**
 * Path: src/scripts/pixel-sprites.ts
 * Purpose: Zero-dependency procedural 16x16 and 24x24 pixel-art sprite sheet
 *          generator using palette-mapped character grids rendered onto offscreen
 *          canvases. Produces nearest-neighbor PixiJS v8 Texture instances AND
 *          reusable offscreen HTMLCanvasElement frames for Canvas2D fallback.
 * Spec Reference: SPEC-021 (021-hero-wall-full-game-overworld)
 *
 * Debug Operator Notes:
 * - Set `window.__RASS_OVERWORLD_DEBUG__ = true` to inspect generated texture
 *   dimensions, scaleMode bindings, and offscreen canvas counts in DevTools.
 */

export type SpriteDirection = 'down' | 'up' | 'left' | 'right';
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
    boris: Record<SpriteDirection, HTMLCanvasElement[]>;
    whiteDog: HTMLCanvasElement[];
    rassDrone: HTMLCanvasElement[];
    msDevil: HTMLCanvasElement[];
    worldObjects: {
      campfire: HTMLCanvasElement[];
      eraObelisk: HTMLCanvasElement;
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
  boris: Record<SpriteDirection, T[]>;
  whiteDog: T[];
  rassDrone: T[];
  msDevil: T[];
  worldObjects: {
    campfire: T[];
    eraObelisk: T;
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
 * Unified 16-bit SNES RPG color palette shared across party characters and
 * biome landmarks. '.' or ' ' denotes transparent pixels.
 */
export const SPRITE_PALETTE: Record<string, string> = {
  K: '#090d16', // Obsidian outline
  k: '#1e293b', // Slate pupil / inner trim
  B: '#1C3B54', // Boris Sherpa cloak & armor base
  b: '#2d587a', // Boris armor mid-tone highlight
  d: '#102436', // Boris cloak shadow
  Y: '#facc15', // Gold trim, devil horns, trophy gold, flame core
  y: '#ca8a04', // Aged gold shadow
  S: '#F4E3C3', // Cream dog coat (Emy/Kiba/Yue) & warm skin tone
  s: '#d6c29c', // Cream shadow / warm parchment
  W: '#ffffff', // Specular white highlight
  P: '#854d0e', // Expedition leather pack & wood
  p: '#b45309', // Copper leather highlight
  C: '#06b6d4', // RASS cyan hull & starfield beacon cyan
  c: '#67e8f9', // Bright cyan plasma highlight
  N: '#0e7490', // Deep cyan hull shadow
  O: '#f97316', // Campfire amber flame & RASS thruster glow
  o: '#ea580c', // Cyber-forge copper & magma crust
  R: '#ef4444', // Ms. Devil crimson wings, mimic tongue & ruby
  r: '#991b1b', // Deep crimson shadow
  A: '#a855f7', // Arcane purple obelisk runes
  a: '#d8b4fe', // Bright purple rune highlight
  M: '#64748b', // Basalt highlight
  m: '#334155', // Stone mid-tone
  n: '#1e293b', // Obsidian monolith body
  E: '#15803d', // Sanctuary moss accent
  T: '#78350f', // Warm brown dog eyes & charred logs
};

/**
 * Boris (Level 39 LATAM AI Sherpa): 4 directions (down, up, left, right) x 4-frame
 * walk cycle = 16 crisp 16x16 frames. Depicts Sherpa hooded cloak, #1C3B54 armor,
 * #facc15 gold trim, and expedition backpack.
 */
export const BORIS_SPRITE_FRAMES: Readonly<Record<SpriteDirection, readonly SpriteGrid[]>> = {
  down: [
    // Frame 0: neutral stance
    [
      '.....KKKKKK.....',
      '....KYYYYYYK....',
      '...KYBBBBBBYK...',
      '..KYBbbbbbbBYK..',
      '..KPKSSSSSSKPK..',
      '..KPKSkSSkSKPK..',
      '...KPKSSSSKPK...',
      '...KKYYYYYYKK...',
      '..KPdBBBBBBdPK..',
      '.KSKdBYbbYBdKSK.',
      '.KK.KBBBBBBK.KK.',
      '....KBYbbYBK....',
      '....KBB..BBK....',
      '....Kdd..ddK....',
      '....KPP..PPK....',
      '...KKKK..KKKK...',
    ],
    // Frame 1: left stride forward, right arm swing
    [
      '.....KKKKKK.....',
      '....KYYYYYYK....',
      '...KYBBBBBBYK...',
      '..KYBbbbbbbBYK..',
      '..KPKSSSSSSKPK..',
      '..KPKSkSSkSKPK..',
      '...KPKSSSSKPK...',
      '...KKYYYYYYKK...',
      '..KPdBBBBBBdPK..',
      '.KSKdBYbbYBdK...',
      '.KK.KBBBBBBKSK..',
      '....KBYbbYBK....',
      '...KBB....BBK...',
      '...KPP....ddK...',
      '..KKKK....PPK...',
      '..........KKK...',
    ],
    // Frame 2: passing stride
    [
      '.....KKKKKK.....',
      '....KYYYYYYK....',
      '...KYBBBBBBYK...',
      '..KYBBbbbbBBYK..',
      '..KPKSSSSSSKPK..',
      '..KPKSkSSkSKPK..',
      '...KPKSSSSKPK...',
      '...KKYYYYYYKK...',
      '..KPdBBBBBBdPK..',
      '..KKdBYbbYBdKK..',
      '....KBBBBBBK....',
      '....KBYbbYBK....',
      '....KBB..BBK....',
      '....KPP..ddK....',
      '....KKK..PPK....',
      '.........KKK....',
    ],
    // Frame 3: right stride forward, left arm swing
    [
      '.....KKKKKK.....',
      '....KYYYYYYK....',
      '...KYBBBBBBYK...',
      '..KYBbbbbbbBYK..',
      '..KPKSSSSSSKPK..',
      '..KPKSkSSkSKPK..',
      '...KPKSSSSKPK...',
      '...KKYYYYYYKK...',
      '..KPdBBBBBBdPK..',
      '...KdBYbbYBdKSK.',
      '..KSKBBBBBBK.KK.',
      '....KBYbbYBK....',
      '...KBB....BBK...',
      '...Kdd....PPK...',
      '...KPP....KKKK..',
      '...KKK..........',
    ],
  ],
  up: [
    // Frame 0: neutral north view showing expedition pack & hood
    [
      '.....KKKKKK.....',
      '....KYYYYYYK....',
      '...KYBBBBBBYK...',
      '..KYBbbbbbbBYK..',
      '..KBBBBBBBBBBK..',
      '..KBBddddddBBK..',
      '...KKYYYYYYKK...',
      '..KPPpPPPPpPPK..',
      '.KBPPpYYYYpPPBK.',
      '.KBPPPPPPPPPPBK.',
      '.KKpPPppppPPpKK.',
      '...KKBBBBBBKK...',
      '....KBB..BBK....',
      '....Kdd..ddK....',
      '....KPP..PPK....',
      '...KKKK..KKKK...',
    ],
    // Frame 1: left boot lifted
    [
      '.....KKKKKK.....',
      '....KYYYYYYK....',
      '...KYBBBBBBYK...',
      '..KYBbbbbbbBYK..',
      '..KBBBBBBBBBBK..',
      '..KBBddddddBBK..',
      '...KKYYYYYYKK...',
      '..KPPpPPPPpPPK..',
      '.KBPPpYYYYpPPBK.',
      '.KBPPPPPPPPPPBK.',
      '.KKpPPppppPPpKK.',
      '...KKBBBBBBKK...',
      '....KBB..BBK....',
      '....KPP..ddK....',
      '....KKK..PPK....',
      '.........KKK....',
    ],
    // Frame 2: passing stride
    [
      '.....KKKKKK.....',
      '....KYYYYYYK....',
      '...KYBBBBBBYK...',
      '..KYBBbbbbBBYK..',
      '..KBBBBBBBBBBK..',
      '..KBBddddddBBK..',
      '...KKYYYYYYKK...',
      '..KPPpPPPPpPPK..',
      '.KBPPpYYYYpPPBK.',
      '.KBPPPPPPPPPPBK.',
      '.KKpPPppppPPpKK.',
      '...KKBBBBBBKK...',
      '....KBB..BBK....',
      '....Kdd..ddK....',
      '....KPP..PPK....',
      '....KKK..KKK....',
    ],
    // Frame 3: right boot lifted
    [
      '.....KKKKKK.....',
      '....KYYYYYYK....',
      '...KYBBBBBBYK...',
      '..KYBbbbbbbBYK..',
      '..KBBBBBBBBBBK..',
      '..KBBddddddBBK..',
      '...KKYYYYYYKK...',
      '..KPPpPPPPpPPK..',
      '.KBPPpYYYYpPPBK.',
      '.KBPPPPPPPPPPBK.',
      '.KKpPPppppPPpKK.',
      '...KKBBBBBBKK...',
      '....KBB..BBK....',
      '....Kdd..PPK....',
      '....KPP..KKK....',
      '....KKK.........',
    ],
  ],
  left: [
    // Frame 0: neutral west profile (pack visible on back right)
    [
      '.....KKKKKK.....',
      '....KYYYYYYK....',
      '...KYBBBBBBYK...',
      '..KYBbbBBBBYYK..',
      '..KYKSSSSBBPPK..',
      '..KKkSSSSBBPPK..',
      '...KKSSSSBPPPK..',
      '...KKYYYYBPPPK..',
      '..KBBBBBbpPPPK..',
      '..KBSKBBbpPPK...',
      '..KBBBBBbpPK....',
      '...KBYbbYBK.....',
      '....KBB..BBK....',
      '....Kdd..ddK....',
      '....KPP..PPK....',
      '...KKKK..KKKK...',
    ],
    // Frame 1: stride wide
    [
      '.....KKKKKK.....',
      '....KYYYYYYK....',
      '...KYBBBBBBYK...',
      '..KYBbbBBBBYYK..',
      '..KYKSSSSBBPPK..',
      '..KKkSSSSBBPPK..',
      '...KKSSSSBPPPK..',
      '...KKYYYYBPPPK..',
      '..KBBBBBbpPPPK..',
      '.KSKBBBBbpPPK...',
      '..KBBBBBbpPK....',
      '...KBYbbYBK.....',
      '...KBB...BBK....',
      '..Kdd.....ddK...',
      '.KPP.......PPK..',
      '.KKKK.....KKKK..',
    ],
    // Frame 2: passing stride
    [
      '.....KKKKKK.....',
      '....KYYYYYYK....',
      '...KYBBBBBBYK...',
      '..KYBbbBBBBYYK..',
      '..KYKSSSSBBPPK..',
      '..KKkSSSSBBPPK..',
      '...KKSSSSBPPPK..',
      '...KKYYYYBPPPK..',
      '..KBBBBBbpPPPK..',
      '..KBBKSKbpPPK...',
      '..KBBBBBbpPK....',
      '...KBYbbYBK.....',
      '.....KBBBBK.....',
      '.....KddddK.....',
      '.....KPPPPK.....',
      '....KKKKKKK.....',
    ],
    // Frame 3: stride wide alternate
    [
      '.....KKKKKK.....',
      '....KYYYYYYK....',
      '...KYBBBBBBYK...',
      '..KYBbbBBBBYYK..',
      '..KYKSSSSBBPPK..',
      '..KKkSSSSBBPPK..',
      '...KKSSSSBPPPK..',
      '...KKYYYYBPPPK..',
      '..KBBBBBbpPPPK..',
      '..KBBBBKSKPPK...',
      '..KBBBBBbpPK....',
      '...KBYbbYBK.....',
      '...KBB...BBK....',
      '...Kdd....ddK...',
      '...KPP.....PPK..',
      '..KKKK.....KKKK.',
    ],
  ],
  right: [
    // Frame 0: neutral east profile (pack visible on back left)
    [
      '.....KKKKKK.....',
      '....KYYYYYYK....',
      '...KYBBBBBBYK...',
      '..KYYbbbbBBBYK..',
      '..KPPBBSSSSKYK..',
      '..KPPBBSSSSkKK..',
      '..KPPPBSSSSKK...',
      '..KPPPBYYYYKK...',
      '..KPPPpbBBBBBK..',
      '...KPPpbBBKSBK..',
      '....KPpbBBBBBK..',
      '.....KBYbbYBK...',
      '....KBB..BBK....',
      '....Kdd..ddK....',
      '....KPP..PPK....',
      '...KKKK..KKKK...',
    ],
    // Frame 1: stride wide
    [
      '.....KKKKKK.....',
      '....KYYYYYYK....',
      '...KYBBBBBBYK...',
      '..KYYbbbbBBBYK..',
      '..KPPBBSSSSKYK..',
      '..KPPBBSSSSkKK..',
      '..KPPPBSSSSKK...',
      '..KPPPBYYYYKK...',
      '..KPPPpbBBBBBK..',
      '...KPPpbBBBBKSK.',
      '....KPpbBBBBBK..',
      '.....KBYbbYBK...',
      '....KBB...BBK...',
      '...Kdd.....ddK..',
      '..KPP.......PPK.',
      '.KKKK.....KKKK..',
    ],
    // Frame 2: passing stride
    [
      '.....KKKKKK.....',
      '....KYYYYYYK....',
      '...KYBBBBBBYK...',
      '..KYYbbbbBBBYK..',
      '..KPPBBSSSSKYK..',
      '..KPPBBSSSSkKK..',
      '..KPPPBSSSSKK...',
      '..KPPPBYYYYKK...',
      '..KPPPpbBBBBBK..',
      '...KPPpbKSKBBK..',
      '....KPpbBBBBBK..',
      '.....KBYbbYBK...',
      '.....KBBBBK.....',
      '.....KddddK.....',
      '.....KPPPPK.....',
      '.....KKKKKKK....',
    ],
    // Frame 3: stride wide alternate
    [
      '.....KKKKKK.....',
      '....KYYYYYYK....',
      '...KYBBBBBBYK...',
      '..KYYbbbbBBBYK..',
      '..KPPBBSSSSKYK..',
      '..KPPBBSSSSkKK..',
      '..KPPPBSSSSKK...',
      '..KPPPBYYYYKK...',
      '..KPPPpbBBBBBK..',
      '...KPPKSKBBBBK..',
      '....KPpbBBBBBK..',
      '.....KBYbbYBK...',
      '....KBB...BBK...',
      '...Kdd....ddK...',
      '..KPP.....PPK...',
      '.KKKK....KKKK...',
    ],
  ],
};

/**
 * White Dog memorial companion (Emy, Kiba, and Yue tribute):
 * 4-frame 16x16 trot cycle with wagging tail, #F4E3C3 cream coat, warm eyes, and amber collar.
 */
export const WHITE_DOG_FRAMES: readonly SpriteGrid[] = [
  // Frame 0: tail high, legs wide trot
  [
    '................',
    '........KK..KK..',
    '.......KSSKKSSK.',
    '......KSSSSSSSSK',
    '.KK...KSSKTKSSKK',
    '.KSSK.KSSSSSSKK.',
    '..KSSKKSSSSSOOK.',
    '...KSSSSSSSSWWK.',
    '...KSSSSSSSSSSK.',
    '...KSSssssssSSK.',
    '....KSSKKKKSSK..',
    '...KSSK....KSSK.',
    '..KSSK......KSSK',
    '..KKK........KKK',
    '................',
    '................',
  ],
  // Frame 1: tail wag mid, body lifted 1px in mid-trot
  [
    '........KK..KK..',
    '.......KSSKKSSK.',
    '......KSSSSSSSSK',
    '......KSSKTKSSKK',
    '......KSSSSSSKK.',
    '.KKK..KSSSSSOOK.',
    'KSSSKKSSSSSSWWK.',
    '.KSSSSSSSSSSSSK.',
    '..KSSSssssssSSK.',
    '...KSSKKKKKKSSK.',
    '....KSSK..KSSK..',
    '....KSSK..KSSK..',
    '....KKK....KKK..',
    '................',
    '................',
    '................',
  ],
  // Frame 2: tail dipped, paws crossed forward
  [
    '................',
    '........KK..KK..',
    '.......KSSKKSSK.',
    '......KSSSSSSSSK',
    '......KSSKTKSSKK',
    '......KSSSSSSKK.',
    '..KK..KSSSSSOOK.',
    '.KSSKKSSSSSSWWK.',
    'KSSKSSSSSSSSSSK.',
    '.KK.KSSssssssSK.',
    '....KSSKKKKSSK..',
    '....KSSK..KSSK..',
    '...KSSK..KSSK...',
    '...KKK...KKK....',
    '................',
    '................',
  ],
  // Frame 3: tail wagging back up, passing trot stride
  [
    '........KK..KK..',
    '.......KSSKKSSK.',
    '......KSSSSSSSSK',
    '..KK..KSSKTKSSKK',
    '.KSSK.KSSSSSSKK.',
    '..KSSKKSSSSSOOK.',
    '...KSSSSSSSSWWK.',
    '...KSSSSSSSSSSK.',
    '...KSSssssssSSK.',
    '....KSSKKKKSSK..',
    '....KSSK..KSSK..',
    '.....KSSKKSSK...',
    '.....KKK..KKK...',
    '................',
    '................',
    '................',
  ],
];

/**
 * RASS Drone: 2-frame 16x16 kinetic hover loop (#06b6d4 cyan hull + #f97316 thruster glow).
 */
export const RASS_DRONE_FRAMES: readonly SpriteGrid[] = [
  // Frame 0: steady hover, cyan antenna tip
  [
    '.......cc.......',
    '.......KK.......',
    '.....KKCCKK.....',
    '...KKCCCCCCKK...',
    '..KCCccccccCCK..',
    '..KCNKKKKKKNCK..',
    '.KCNKccYYccKNCK.',
    '.KCNKKKKKKKKNCK.',
    '..KCCCCCCCCCCK..',
    '...KNNNNNNNNK...',
    '....KKO..OKK....',
    '....KOO..OOK....',
    '.....OY..YO.....',
    '.....O....O.....',
    '................',
    '................',
  ],
  // Frame 1: 1px upward kinetic bob, pulsing gold antenna & wider thruster flare
  [
    '.......YY.......',
    '.....KKCCKK.....',
    '...KKCCCCCCKK...',
    '..KCCccccccCCK..',
    '..KCNKKKKKKNCK..',
    '.KCNKcWWWWcKNCK.',
    '.KCNKKKKKKKKNCK.',
    '..KCCCCCCCCCCK..',
    '...KNNNNNNNNK...',
    '....KKO..OKK....',
    '...KOOo..oOOK...',
    '....oYY..YYo....',
    '....O.O..O.O....',
    '................',
    '................',
    '................',
  ],
];

/**
 * Ms. Devil: 2-frame 16x16 darting familiar loop (#ef4444 crimson wings + #facc15 horns).
 */
export const MS_DEVIL_FRAMES: readonly SpriteGrid[] = [
  // Frame 0: crimson wings raised high
  [
    '...YK......KY...',
    '...YKK....KKY...',
    '..KRRKKKKKKRRK..',
    '.KRRrRRRRRRrRRK.',
    'KRRrKRRRRRRKrRRK',
    'KRr.KRYRRYRK.rRK',
    'KK..KRRRRRRK..KK',
    '....KRRRRRRK....',
    '..KKKRRrrRRK....',
    '.KRK.KRRRRK.....',
    '.KK..KR..RK.....',
    '.....KK..KK.....',
    '................',
    '................',
    '................',
    '................',
  ],
  // Frame 1: crimson wings swept down in nimble dart
  [
    '................',
    '...YK......KY...',
    '...YKK....KKY...',
    '....KRRRRRRK....',
    '...KRRRRRRRRK...',
    '...KRYRRYRRRK...',
    '..KKRRRRRRRRKK..',
    '.KRRrKRRRRKrRRK.',
    'KRRr.KROORK.rRRK',
    'KRr..KRRRRK..rRK',
    'KK...KR..RK...KK',
    '....KK....KK....',
    '...KRK..........',
    '....K...........',
    '................',
    '................',
  ],
];

/**
 * Interactive 24x24 and 16x16 world landmark & object sprites:
 * - campfire (3-frame 24x24 flickering amber #f97316 flame)
 * - eraObelisk (24x24 obsidian obelisk with #a855f7 purple runes)
 * - relicPedestal (24x24 Cyber-Forge copper/magma pedestal #ea580c)
 * - trophyPedestal (24x24 gilded Trophy Armory dais #facc15)
 * - beaconTower (24x24 starfield cyan #06b6d4 Mountain Signal Beacon)
 * - roastChest (16x16 closed & open Mimic Roast Chest)
 * - heart (12x12 pixel heart bubble for petting the White Dog)
 */
export const WORLD_OBJECT_SPRITES = {
  campfire: [
    // Frame 0: tall central amber/gold tongue + left spark
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
      '.....OOoOOOOOOOooO......',
      '.....ooOOOOOOOOooo......',
      '....KTToOOOOOOoTTK......',
      '...KTTPPoOOOOoPPTTK.....',
      '..KTTPPPTooooTPPPTTK....',
      '..KKTTTTPPPPPPTTTTKK....',
      '.KmmKTTTTTTTTTTTTKmmK...',
      'KMmmMKTTPPPPPPTTKMmmMK..',
      'KmnnmKKTTTTTTTTKKmnnmK..',
      '.KnnKKMmmmKKmmmMKKnnK...',
      '..KKKmnnnmKKmnnnmKKK....',
      '.....KnnnKKKKnnnK.......',
      '......KKKKKKKKKK........',
      '........................',
    ],
    // Frame 1: flickering left lean + right ember spark
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
      '.....OooOOOOOOOooO......',
      '....KooOOOOOOOOoooK.....',
      '....KTToOOOOOOoTTK......',
      '...KTTPPoOOOOoPPTTK.....',
      '..KTTPPPTooooTPPPTTK....',
      '..KKTTTTPPPPPPTTTTKK....',
      '.KmmKTTTTTTTTTTTTKmmK...',
      'KMmmMKTTPPPPPPTTKMmmMK..',
      'KmnnmKKTTTTTTTTKKmnnmK..',
      '.KnnKKMmmmKKmmmMKKnnK...',
      '..KKKmnnnmKKmnnnmKKK....',
      '.....KnnnKKKKnnnK.......',
      '......KKKKKKKKKK........',
      '........................',
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
      '.....OOoOOOOOOOooOO.....',
      '.....ooOOOOOOOOoooK.....',
      '....KTToOOOOOOoTTK......',
      '...KTTPPoOOOOoPPTTK.....',
      '..KTTPPPTooooTPPPTTK....',
      '..KKTTTTPPPPPPTTTTKK....',
      '.KmmKTTTTTTTTTTTTKmmK...',
      'KMmmMKTTPPPPPPTTKMmmMK..',
      'KmnnmKKTTTTTTTTKKmnnmK..',
      '.KnnKKMmmmKKmmmMKKnnK...',
      '..KKKmnnnmKKmnnnmKKK....',
      '.....KnnnKKKKnnnK.......',
      '......KKKKKKKKKK........',
      '........................',
    ],
  ] as readonly SpriteGrid[],

  eraObelisk: [
    '...........KK...........',
    '..........KaaK..........',
    '.........KaAAaK.........',
    '..........KAAK..........',
    '..........KKKK..........',
    '.........KMnnMK.........',
    '........KMnnnnMK........',
    '........KmnAAnMK........',
    '.......KmnAAAAmnK.......',
    '.......KmnnaannmK.......',
    '.......KmnnAAnnmK.......',
    '......KmnnAAAAmnmK......',
    '......KmnAAnnAAmmK......',
    '......KmnnAAnnnmmK......',
    '.....KmnnnAAAAmmmnK.....',
    '.....KmnnAAnnnAmmnK.....',
    '.....KmnnnaaaanmmnK.....',
    '....KMnnnnnAAnnnnnMK....',
    '....KMMmmmmmmmmmmMMK....',
    '...KMnnMmmmAAmmmMnnMK...',
    '..KMMnnnnnAAAAmnnnnMMK..',
    '..KnnnnnnnnnnnnnnnnnnK..',
    '..KKKKKKKKKKKKKKKKKKKK..',
    '........................',
  ] as SpriteGrid,

  relicPedestal: [
    '...........KK...........',
    '..........KccK..........',
    '.........KcCCcK.........',
    '........KcCWYCcK........',
    '.........KcCCcK.........',
    '..........KccK..........',
    '...........KK...........',
    '......o..........o......',
    '.....KooKKKKKKKKooK.....',
    '....KoooPPPPPPPPoooK....',
    '....KoKKYYYYYYYYKKoK....',
    '.....KooPPPPPPPPooK.....',
    '......KooommmmoooK......',
    '......KopmOOOOmpOK......',
    '.....KKopmoYYompoKK.....',
    '.....KooomOOOOmoooK.....',
    '....KooopmoOOompoooK....',
    '....KoppmooooooopppK....',
    '...KKppmoOOOOOOomppKK...',
    '..KMMmmmoOYYYYOommmMMK..',
    '..KmnnnooOOOOOOoonnnmK..',
    '.KnnnnnnnnnnnnnnnnnnnnK.',
    '.KKKKKKKKKKKKKKKKKKKKKK.',
    '........................',
  ] as SpriteGrid,

  trophyPedestal: [
    '........KKKKKKKK........',
    '.......KYYYYYYYYK.......',
    '......KYYWWYYWWYYK......',
    '......KYYYyyyyYYYK......',
    '.......KYYyYYyYYK.......',
    '......KKYYYYYYYYKK......',
    '.....KYKYYYYYYYYKYK.....',
    '.....KYKYYYRRYYYKYK.....',
    '......KKYYYYYYYYKK......',
    '........KKYYYYKK........',
    '.........KYYYYK.........',
    '........KYYyyYYK........',
    '......KKYYYYYYYYKK......',
    '.....KYYYyyyyyyYYYK.....',
    '....KKKKKKKKKKKKKKKK....',
    '....KMMmmmmmmmmmmMMK....',
    '...KMmnnRRRRRRRRnnmMK...',
    '...KmnnnRRYYYYYRnnnmK...',
    '..KMmnnnRRRRRRRRnnnmMK..',
    '..KmnnnnnnnnnnnnnnnnnK..',
    '.KMmmmmmmmmmmmmmmmmmmMK.',
    '.KnnnnnnnnnnnnnnnnnnnnK.',
    '.KKKKKKKKKKKKKKKKKKKKKK.',
    '........................',
  ] as SpriteGrid,

  beaconTower: [
    '...........cc...........',
    '..........cWWc..........',
    '.........CcCCcC.........',
    '..........KCCK..........',
    '........KKKccKKK........',
    '.......KCCccccCCK.......',
    '......KCCcWWWWcCCK......',
    '......KCCcCCCCcCCK......',
    '.......KKNCCCCNKK.......',
    '........KMNccNMK........',
    '.........KMnnMK.........',
    '........KMnCCnMK........',
    '........KMnnnnMK........',
    '.......KMnMccMnMK.......',
    '.......KMnnCCnnMK.......',
    '......KMnMnCCnMnMK......',
    '......KMnnnnnnnnMK......',
    '.....KMnnMCCCCMnnMK.....',
    '.....KMnnnnnnnnnnMK.....',
    '....KMMnnCCCCCCnnMMK....',
    '...KMnnnnnnnnnnnnnnMK...',
    '..KMMmmmmNNNNNNmmmmMMK..',
    '..KKKKKKKKKKKKKKKKKKKK..',
    '........................',
  ] as SpriteGrid,

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

  heart: [
    '..KKK..KKK..',
    '.KRRRKkRRRK.',
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
      const color = palette[code];
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
 * Build all 16x16 and 24x24 procedural sprite frames onto offscreen canvases and
 * optionally wrap them in nearest-neighbor PixiJS Textures via `TextureClass`.
 * Passing `null`/`undefined` returns raw offscreen canvases directly for Canvas2D fallback.
 */
export function createSpriteTextureSet<T = HTMLCanvasElement>(
  TextureClass?: TextureClassLike<T> | null,
  options: SpriteBuildOptions = {},
): SpriteTextureSet<T> {
  const pixelSize = options.pixelSize ?? 3;
  // Slightly tighter pixel scale (2x -> 48x48px) for 24x24 monuments so world proportions stay balanced.
  const monumentScale = Math.max(2, Math.round(pixelSize * 0.75));

  const makePair = (grid: SpriteGrid, scale = pixelSize) => {
    const canvas = renderMatrixToCanvas(grid, SPRITE_PALETTE, scale);
    const texture = canvasToTexture(canvas, TextureClass, options.CanvasSourceClass);
    return { canvas, texture };
  };

  const borisCanvases: Record<SpriteDirection, HTMLCanvasElement[]> = {
    down: [],
    up: [],
    left: [],
    right: [],
  };
  const borisTextures: Record<SpriteDirection, T[]> = {
    down: [],
    up: [],
    left: [],
    right: [],
  };

  for (const dir of ['down', 'up', 'left', 'right'] as const) {
    for (const grid of BORIS_SPRITE_FRAMES[dir]) {
      const { canvas, texture } = makePair(grid, pixelSize);
      borisCanvases[dir].push(canvas);
      borisTextures[dir].push(texture);
    }
  }

  const whiteDogPairs = WHITE_DOG_FRAMES.map((grid) => makePair(grid, pixelSize));
  const rassPairs = RASS_DRONE_FRAMES.map((grid) => makePair(grid, pixelSize));
  const devilPairs = MS_DEVIL_FRAMES.map((grid) => makePair(grid, pixelSize));
  const campfirePairs = WORLD_OBJECT_SPRITES.campfire.map((grid) =>
    makePair(grid, monumentScale),
  );
  const obeliskPair = makePair(WORLD_OBJECT_SPRITES.eraObelisk, monumentScale);
  const relicPair = makePair(WORLD_OBJECT_SPRITES.relicPedestal, monumentScale);
  const trophyPair = makePair(WORLD_OBJECT_SPRITES.trophyPedestal, monumentScale);
  const beaconPair = makePair(WORLD_OBJECT_SPRITES.beaconTower, monumentScale);
  const chestClosedPair = makePair(WORLD_OBJECT_SPRITES.roastChest.closed, pixelSize);
  const chestOpenPair = makePair(WORLD_OBJECT_SPRITES.roastChest.open, pixelSize);
  const heartPair = makePair(WORLD_OBJECT_SPRITES.heart, Math.max(2, pixelSize - 1));

  debugLog('Generated procedural pixel sprite sheet', {
    borisFrames:
      borisCanvases.down.length +
      borisCanvases.up.length +
      borisCanvases.left.length +
      borisCanvases.right.length,
    whiteDogFrames: whiteDogPairs.length,
    rassFrames: rassPairs.length,
    msDevilFrames: devilPairs.length,
    campfireFrames: campfirePairs.length,
    hasPixiTextureClass: Boolean(TextureClass),
    pixelSize,
  });

  return {
    pixelSize,
    canvases: {
      boris: borisCanvases,
      whiteDog: whiteDogPairs.map((p) => p.canvas),
      rassDrone: rassPairs.map((p) => p.canvas),
      msDevil: devilPairs.map((p) => p.canvas),
      worldObjects: {
        campfire: campfirePairs.map((p) => p.canvas),
        eraObelisk: obeliskPair.canvas,
        relicPedestal: relicPair.canvas,
        trophyPedestal: trophyPair.canvas,
        beaconTower: beaconPair.canvas,
        roastChest: {
          closed: chestClosedPair.canvas,
          open: chestOpenPair.canvas,
        },
        heart: heartPair.canvas,
      },
    },
    boris: borisTextures,
    whiteDog: whiteDogPairs.map((p) => p.texture),
    rassDrone: rassPairs.map((p) => p.texture),
    msDevil: devilPairs.map((p) => p.texture),
    worldObjects: {
      campfire: campfirePairs.map((p) => p.texture),
      eraObelisk: obeliskPair.texture,
      relicPedestal: relicPair.texture,
      trophyPedestal: trophyPair.texture,
      beaconTower: beaconPair.texture,
      roastChest: {
        closed: chestClosedPair.texture,
        open: chestOpenPair.texture,
      },
      heart: heartPair.texture,
    },
  };
}
