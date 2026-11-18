/*
 * Path: src/data/game-content.ts
 * Purpose: Canonical SPEC-022 Cozy Campfire Sanctuary & Techno-Organic Alien Frontiers
 *          game content, room hub definitions, 7-state FSM types, SNES palette tokens,
 *          Character Dossier stats, 2-3 line chunked dialogue scripts (Boris, RASS,
 *          Ms. Devil, The Dog, Terminal), Hall of Eras, Relic Vault, Trophy Armory Lodge
 *          (21 badges), Signal Beacon, Mimic Roast Chest, and Credits script.
 * Spec Reference: SPEC-022 (022-hero-wall-studio-cozy-rebuild)
 *
 * Operator Notes:
 * - Single source of truth consumed by SnesDialogueBox.astro, CharacterDossier.astro,
 *   world-biomes.ts, and overworld-engine.ts.
 * - Dialogue copy is pre-chunked into concise 2-3 line bursts (`chunks`) so mobile
 *   and desktop floating boxes never turn into scrolling corporate text walls.
 * - All 21 trophy cards are wrapped directly from `./badges.ts` without mutation.
 * - Opt-in debug inspection via `window.__RASS_OVERWORLD_DEBUG__`.
 */

import { badges } from './badges.ts';
import type { Badge, Tier } from './badges.ts';

export type { Badge, Tier };
export { badges };

/**
 * Persistent storage key shared by overworld-engine.ts and UI settings toggles.
 */
export const STUDIO_STORAGE_KEY = 'hw_studio_state_v1' as const;

/**
 * Four discrete connected rooms in the SPEC-022 Cozy Sanctuary & Alien Frontiers rebuild:
 * 1 central Campfire Sanctuary hub + 3 techno-organic alien frontier rooms.
 */
export type RoomId = 'campfire' | 'cyber_chasm' | 'bio_forge' | 'signal_beacon';

/**
 * Backward-compatible type alias so room-aware and biome-aware callers share identical union checks.
 */
export type BiomeId = RoomId;

/**
 * Seven-state finite-state-machine governing the single-canvas game loop and overlays.
 */
export type GameState =
  | 'EXPLORING'
  | 'PORTAL_WARP'
  | 'DIALOGUE'
  | 'START_MENU'
  | 'INSPECT_RELIC'
  | 'CHARACTER_SHEET'
  | 'MIMIC_ROAST';

/**
 * Canonical speaker nameplate tags displayed in `#snesSpeakerName`.
 */
export type SpeakerTag = '[BORIS]' | '[RASS]' | '[MS. DEVIL]' | '[THE DOG]' | '[TERMINAL]';

/**
 * Warm campfire hearth + contrasting techno-organic alien frontier 16-bit palette tokens.
 */
export const SNES_PALETTE = {
  amber: '#f97316',
  grass: '#15803d',
  runePurple: '#a855f7',
  forgeCopper: '#ea580c',
  starCyan: '#06b6d4',
  obsidian: '#090d16',
  gold: '#facc15',
  navyTop: '#172554',
  navyBottom: '#090d16',
  cream: '#F4E3C3',
  armorBlue: '#1C3B54',
  holoCyan: '#38C7E7',
  crimson: '#dc2626',
  bioEmerald: '#10b981',
  hearthWood: '#7c2d12',
} as const;

export interface RoomConfig {
  id: RoomId;
  index: number;
  hotkey: '1' | '2' | '3' | '4';
  name: string;
  shortLabel: string;
  subtitle: string;
  townMapSummary: string;
  accentCss: string;
  accentHex: number;
  surface: 'grass' | 'stone' | 'metal';
  width: number;
  height: number;
  /** Default spawn when entering from Town Map or initial boot. */
  spawnX: number;
  spawnY: number;
  /** Landing spawn inside Campfire Sanctuary when returning from an alien room portal. */
  returnLandingX: number;
  returnLandingY: number;
  /** Default Return Portal position inside alien rooms (`x: 130, y: 375`). */
  returnPortalX: number;
  returnPortalY: number;
}

/**
 * Authoritative configuration map for all 4 discrete rooms (`960x540` logical 16:9 canvas).
 * Alien rooms spawn Boris directly beside the glowing Return Portal (`x: 130, y: 375`).
 */
export const ROOM_CONFIGS: Readonly<Record<RoomId, RoomConfig>> = {
  campfire: {
    id: 'campfire',
    index: 1,
    hotkey: '1',
    name: 'Campfire Sanctuary',
    shortLabel: 'Campfire',
    subtitle: 'Cozy clearing hearth, sleeping companion, advisors & 3 perimeter portals',
    townMapSummary: 'Central hearth, Trophy Armory Lodge & portals to all 3 alien realms.',
    accentCss: SNES_PALETTE.amber,
    accentHex: 0xf97316,
    surface: 'grass',
    width: 960,
    height: 540,
    spawnX: 480,
    spawnY: 388,
    returnLandingX: 480,
    returnLandingY: 388,
    returnPortalX: 480,
    returnPortalY: 388,
  },
  cyber_chasm: {
    id: 'cyber_chasm',
    index: 2,
    hotkey: '2',
    name: 'Cyber-Chasm · Hall of Eras',
    shortLabel: 'Cyber-Chasm',
    subtitle: 'Obsidian monoliths beneath neon purple & cyan synth aurora',
    townMapSummary: '5 Chronicle Monoliths etching Boris’s journey from 2010 to Sovereign Age.',
    accentCss: SNES_PALETTE.runePurple,
    accentHex: 0xa855f7,
    surface: 'stone',
    width: 960,
    height: 540,
    spawnX: 204,
    spawnY: 375,
    returnLandingX: 176,
    returnLandingY: 294,
    returnPortalX: 130,
    returnPortalY: 375,
  },
  bio_forge: {
    id: 'bio_forge',
    index: 3,
    hotkey: '3',
    name: 'Bio-Forge Spire · Relic Vault',
    shortLabel: 'Bio-Forge',
    subtitle: 'Biomechanical tendrils & pulsing glass containment pods for shipped AI systems',
    townMapSummary: 'Relic Vault housing KidsLab 3.0, Infusio AI Studio, and Camp David Compass.',
    accentCss: SNES_PALETTE.bioEmerald,
    accentHex: 0x10b981,
    surface: 'metal',
    width: 960,
    height: 540,
    spawnX: 204,
    spawnY: 375,
    returnLandingX: 668,
    returnLandingY: 274,
    returnPortalX: 130,
    returnPortalY: 375,
  },
  signal_beacon: {
    id: 'signal_beacon',
    index: 4,
    hotkey: '4',
    name: 'Signal Beacon · High-Orbit',
    shortLabel: 'Signal Beacon',
    subtitle: 'High-orbit alien radio observatory overlooking deep space',
    townMapSummary: 'Deep-space relay dish opening Email, WhatsApp, and Calendar channels.',
    accentCss: SNES_PALETTE.starCyan,
    accentHex: 0x06b6d4,
    surface: 'metal',
    width: 960,
    height: 540,
    spawnX: 204,
    spawnY: 375,
    returnLandingX: 784,
    returnLandingY: 336,
    returnPortalX: 130,
    returnPortalY: 375,
  },
} as const;

/**
 * Ordered manifest of rooms used by HUD labels, Town Map fast travel, and room cycling (`1`-`4`).
 */
export const BIOME_LIST: readonly RoomConfig[] = [
  ROOM_CONFIGS.campfire,
  ROOM_CONFIGS.cyber_chasm,
  ROOM_CONFIGS.bio_forge,
  ROOM_CONFIGS.signal_beacon,
] as const;

export interface CharacterAttribute {
  id: 'web' | 'ai' | 'narrative' | 'ops';
  label: string;
  value: number;
  color: string;
}

export interface TechLoadoutChip {
  name: string;
  tip: string;
}

/**
 * Character Dossier sheet opened via [START] -> Dossier, [C], or Campfire prompt.
 * Preserves Boris's real portrait photo inside `.pixel-gold-bezel`.
 */
export const CHARACTER_DOSSIER = {
  hotkey: 'C or START',
  image: '/img/boris-portrait.png',
  imageNote: 'Preserve Boris real photo in pixel gold bezel',
  name: 'Boris Quijano',
  class: 'LATAM AI Sherpa / Narrative Architect',
  level: 'Level 39 (Sovereign Age)',
  levelNumber: 39,
  protocol: 'RASS v39.1.5 Embodied',
  location: 'El Salvador (UTC-6)',
  vitals: 'HP: 100/100 (Sovereignty) | MP: 999/999 (Strategic Mana)',
  hp: { current: 100, max: 100, label: 'Sovereignty' },
  mp: { current: 999, max: 999, label: 'Strategic Mana' },
  loadout: 'Weapon: Multi-Agent Fleet | Armor: Siege Resilience | Relic: Library of Kairosis',
  loadoutSlots: [
    { slot: 'Weapon', value: 'Multi-Agent Fleet' },
    { slot: 'Armor', value: 'Siege Resilience' },
    { slot: 'Relic', value: 'Library of Kairosis' },
  ],
  attributesSummary:
    'Web Architecture: 95% | AI Systems: 92% | Narrative Design: 93% | Ops & Automation: 88%',
  attributes: [
    { id: 'web', label: 'Web Architecture', value: 95, color: SNES_PALETTE.starCyan },
    { id: 'ai', label: 'AI Systems', value: 92, color: SNES_PALETTE.runePurple },
    { id: 'narrative', label: 'Narrative Design', value: 93, color: SNES_PALETTE.gold },
    { id: 'ops', label: 'Ops & Automation', value: 88, color: SNES_PALETTE.amber },
  ] as readonly CharacterAttribute[],
  abstract:
    'Crossing the threshold from corporate IT and agency scale to sovereign edge intelligence in El Salvador. Carrying the flame as builder, strategist, and teacher. Execution = Sovereignty.',
  techLoadout: [
    { name: 'Figma', tip: 'Design Systems' },
    { name: 'Notion', tip: 'Docs & Ops' },
    { name: 'Node', tip: 'Backend Runtime' },
    { name: 'Bun', tip: 'Fast Runtime & Bundler' },
    { name: 'Tailwind', tip: 'Rapid UI' },
    { name: 'Zapier', tip: 'No-Code Automations' },
    { name: 'Pipedream', tip: 'API Workflows' },
    { name: 'Astro', tip: 'Islands & Speed' },
    { name: 'Vercel', tip: 'Edge Deploys' },
    { name: 'Cloudflare', tip: 'CDN & Security' },
    { name: 'Gemini', tip: 'Edge AI Models' },
    { name: 'Sora', tip: 'Text to Video' },
    { name: 'Genspark', tip: 'Image Gen' },
  ] as readonly TechLoadoutChip[],
  companionNote:
    'Beside the amber campfire embers, The Dog sleeps curled on a woven mat—ears twitching softly in the glow while RASS watches telemetry and Ms. Devil audits every claim. A sovereign sherpa never walks alone.',
} as const;

/**
 * Campfire Sanctuary hearth monologue broken into 2-3 line chunks for SNES pagination.
 */
export const SANCTUARY_CAMPFIRE = {
  title: 'CAMPFIRE SANCTUARY · HEARTH',
  speaker: '[BORIS]' as SpeakerTag,
  chunks: [
    "Pull up a seat by the fire, traveler. You've reached sovereign ground in El Salvador—quiet timber, warm iron, and steady embers.",
    "Out here, we don't worship AI hype or empty certificates. We forge battle-tested multi-agent systems, teach builders at KidsLab, and ship real autonomy.",
    'Step into the three perimeter portals to cross into Cyber-Chasm, Bio-Forge Spire, and Signal Beacon—or visit the Trophy Armory Lodge right here at camp.',
  ] as readonly string[],
  text: "Pull up a seat by the fire, traveler. You've reached sovereign ground in El Salvador. Out here, we don't worship AI hype or empty certifications. We forge battle-tested multi-agent systems, teach at KidsLab, and step through perimeter portals into alien frontiers.",
  choices: [
    'Open Character Dossier [C]',
    'Pet The Dog [B]',
    'Open [START] Menu [M]',
    'Roast Hype Chest [R]',
  ] as const,
} as const;

/**
 * Sleeping companion encounter at the campfire woven mat.
 * Strictly referred to solely as The Dog (`[THE DOG]`).
 */
export const SLEEPING_DOG = {
  title: 'CAMPFIRE SANCTUARY · THE DOG',
  speaker: '[THE DOG]' as SpeakerTag,
  subtitle: 'Resting on a crimson woven mat by the campfire embers',
  chunks: [
    '(Curled up on a warm woven mat beside the stone hearth, The Dog breathes softly—one ear twitching as sparks drift overhead.)',
    '(A gentle nudge wakes warm brown eyes and a happy thump of tail against the mat. A quiet 16-bit hearth chime rings out.)',
  ] as readonly string[],
  text: '(The Dog rests curled on a woven mat by the campfire embers, chest rising gently with an ear twitch. Looking up warmly, its tail thumps softly as a quiet chime rings out.)',
  effect: '+10 Morale Restored',
} as const;

/**
 * Campfire advisor scripts for RASS (hovering near the radio antenna) and Ms. Devil (lounging on the bench).
 */
export const COMPANION_DRONES = {
  title: 'CAMPFIRE ADVISORS · RASS & MS. DEVIL',
  speakers: [
    {
      id: 'rass',
      name: '[RASS]' as SpeakerTag,
      role: 'RASS Architect · Holographic AI Companion',
      location: 'Campfire Radio Antenna',
      chunks: [
        'All edge sensors nominal, Captain. Single-canvas lock holds 60 FPS across WebGPU and Canvas2D with zero memory leaks.',
        'All three perimeter portals are stabilized: Cyber-Chasm West, Bio-Forge North, and Signal Beacon East. Ready to warp on your signal.',
      ] as readonly string[],
      text: 'All edge sensors nominal, Captain. Single-canvas lock holds 60 FPS across WebGPU and Canvas2D. Three perimeter portals are stabilized and ready for warp.',
    },
    {
      id: 'ms-devil',
      name: '[MS. DEVIL]' as SpeakerTag,
      role: 'Ms. Devil Skeptic · Adversarial QA & Anti-Bloat',
      location: 'Carved Timber Bench',
      chunks: [
        "Don't let the cozy embers soften your edge, Sherpa. No corporate navbars, no endless text walls—only proof that ships and survives.",
        "Walk through the Bio-Forge portal and inspect the live relics if you want to back up the lore. Or crack open that Mimic Chest and burn the hype.",
      ] as readonly string[],
      text: "Don't let the cozy embers soften your edge, Sherpa. No corporate navbars, no bloated prose—step through the Bio-Forge portal and show the proof that shipped.",
    },
  ] as const,
} as const;

export interface EraEntry {
  id: string;
  year: string;
  era: string;
  lore: string;
  chunks: readonly string[];
  accent: string;
}

/**
 * Five obsidian chronicle monoliths inside Room 2 (`cyber_chasm` — Hall of Eras).
 */
export const HALL_OF_ERAS: readonly EraEntry[] = [
  {
    id: 'era-0',
    year: '2010 - 2013',
    era: 'Stone Age · App Apprentice',
    lore: 'The foundations of corporate IT, server racks, and design systems. Monolith etched with scars: Corporate collapse and total skill reset.',
    chunks: [
      '2010–2013 · Stone Age: Foundations of corporate IT, server racks, and early design systems forged from scratch.',
      'Monolith scar: Corporate collapse forced a total skill reset—and proved resilience outlasts job titles.',
    ],
    accent: '#94a3b8',
  },
  {
    id: 'era-1',
    year: '2014 - 2018',
    era: 'Steel Age · Hero Reborn',
    lore: 'Agency scale, high-ticket US client delivery, and full-stack systems. Monolith etched: Overload burnout from carrying entire systems solo.',
    chunks: [
      '2014–2018 · Steel Age: Agency scale, high-ticket US client delivery, and end-to-end full-stack architecture.',
      'Monolith scar: Carrying entire delivery pipelines solo taught why resilient systems beat lone-wolf heroics.',
    ],
    accent: SNES_PALETTE.starCyan,
  },
  {
    id: 'era-2',
    year: '2019 - 2022',
    era: 'Crystal Age · Wandering Nomad',
    lore: 'Remote LATAM infrastructure and international consulting. Monolith etched: Relational and personal implosion. The wilderness years.',
    chunks: [
      '2019–2022 · Crystal Age: Remote LATAM infrastructure and cross-border consulting across shifting terrain.',
      'Monolith scar: The wilderness years stripped away everything fragile until only core craft remained.',
    ],
    accent: SNES_PALETTE.runePurple,
  },
  {
    id: 'era-3',
    year: '2023 - 2025',
    era: 'Graphene Age · Siege & AI Systems',
    lore: 'Autonomous multi-agent pipelines and generative media workflows. Monolith etched: The Medellín Siege Mode unlocked. Chaos turned into discipline.',
    chunks: [
      '2023–2025 · Graphene Age: Autonomous multi-agent pipelines and practical generative engineering workflows.',
      'Monolith mark: Medellín Siege Mode unlocked—turning raw chaos into repeatable daily discipline.',
    ],
    accent: SNES_PALETTE.amber,
  },
  {
    id: 'era-4',
    year: '2026 - Present',
    era: 'Sovereign Age · Sanctuary & Fleet Ops',
    lore: 'Embodied edge intelligence (RASS), KidsLab 3.0, and El Salvador sanctuary. Monolith glowing gold: 365-day loop closed. Full sovereignty reclaimed.',
    chunks: [
      '2026–Present · Sovereign Age: Embodied edge intelligence (RASS), KidsLab 3.0, and El Salvador Sanctuary.',
      'Monolith glowing gold: The 365-day loop closed cleanly. Full operational sovereignty reclaimed.',
    ],
    accent: SNES_PALETTE.gold,
  },
] as const;

export interface RelicEntry {
  id: string;
  name: string;
  category: string;
  stats: string;
  lore: string;
  chunks: readonly string[];
  url: string;
  btn: string;
}

/**
 * Three production artifacts contained in pulsing bio-glass pods inside Room 3 (`bio_forge`).
 */
export const RELIC_VAULT: readonly RelicEntry[] = [
  {
    id: 'relic-0',
    name: 'KidsLab 3.0 Core Matrix',
    category: 'EdTech & Human-First STEM Ecosystem',
    stats: '105+ Students across LATAM | 80% Retention | Game Creator Lab',
    lore: 'AI-powered intake routing meets human mentorship. Teaching kids to build worlds, not just consume screens.',
    chunks: [
      'KidsLab 3.0 Core Matrix · 105+ LATAM students & 80% retention across interactive STEM cohorts.',
      'AI-assisted admissions routing paired with human mentorship—teaching kids to build worlds, not scroll.',
    ],
    url: 'https://kidslab.education',
    btn: 'Enter Academy',
  },
  {
    id: 'relic-1',
    name: 'Infusio AI Studio Engine',
    category: 'Boutique AI Engineering & Edge Automation',
    stats: '5+ Autonomous Edge Agents | Headless Astro 5 Architecture',
    lore: 'Autonomous intake concierges and pragmatic AI workflows for real-world businesses.',
    chunks: [
      'Infusio AI Studio Engine · 5+ autonomous edge agents wired into lean headless web architectures.',
      'Pragmatic intake concierges and production automations engineered for measurable operational ROI.',
    ],
    url: 'https://infusio.pro',
    btn: 'Inspect Studio',
  },
  {
    id: 'relic-2',
    name: 'Camp David Field Compass',
    category: 'Brand Direction & Operational Launch',
    stats: 'Full Visual Identity & Digital Launch Coordination',
    lore: 'Grounded field execution built to withstand reality.',
    chunks: [
      'Camp David Field Compass · Complete visual identity and grounded digital launch coordination.',
      'Built for real-world durability without corporate noise—calibrated right inside the Bio-Forge.',
    ],
    url: '#',
    btn: 'View Compass',
  },
] as const;

export interface TrophyCard extends Badge {
  id: string;
  cardNumber: string;
  rarityLabel: 'ULTIMATE RARE' | 'PRESTIGE' | 'SPECIAL' | 'LOCKED';
  isPending: boolean;
  isMystery: boolean;
}

const TIER_ORDER: Record<Tier, number> = {
  ultimate: 0,
  prestige: 1,
  special: 2,
  locked: 3,
};

const RARITY_LABELS: Record<Tier, TrophyCard['rarityLabel']> = {
  ultimate: 'ULTIMATE RARE',
  prestige: 'PRESTIGE',
  special: 'SPECIAL',
  locked: 'LOCKED',
};

/**
 * All 21 battle-forged achievement cards wrapped directly from `./badges.ts`,
 * sorted consistently by rarity tier (Ultimate -> Prestige -> Special -> Locked).
 */
export const TROPHY_CARDS: readonly TrophyCard[] = [...badges]
  .sort((a, b) => {
    const tierDelta = TIER_ORDER[a.tier] - TIER_ORDER[b.tier];
    if (tierDelta !== 0) return tierDelta;
    return (b.date ?? '').localeCompare(a.date ?? '');
  })
  .map((badge, index) => ({
    ...badge,
    id: `trophy-${String(index + 1).padStart(2, '0')}`,
    cardNumber: `#HQ-${String(index + 1).padStart(3, '0')}`,
    rarityLabel: RARITY_LABELS[badge.tier],
    isPending: !badge.earned && badge.tier !== 'locked',
    isMystery: !badge.earned && badge.tier === 'locked',
  }));

/**
 * Trophy Armory Lodge metadata at the Campfire Sanctuary clearing edge and Character Dossier Tab 4.
 */
export const TROPHY_ARMORY = {
  title: 'TROPHY ARMORY LODGE · 21 BATTLE CARDS',
  speaker: '[TERMINAL]' as SpeakerTag,
  lore_intro:
    '21 battle-forged achievements commemorating survival, discipline, and system architecture.',
  chunks: [
    'Welcome to the Trophy Armory Lodge at the Sanctuary clearing edge—21 battle-forged cards tracking grit and craft.',
    'Cycle cards right here or open the full Armory Archive inside your Character Dossier [START -> Badges].',
  ] as readonly string[],
  items: TROPHY_CARDS.length,
  format: 'Interactive lodge archive with XP, rarity tier, and lore quote upon inspection.',
} as const;

export interface SignalChannel {
  type: 'Email' | 'WhatsApp' | 'Calendar';
  label: string;
  val: string;
}

/**
 * High-Orbit Signal Beacon observatory transmission channels inside Room 4 (`signal_beacon`).
 */
export const SIGNAL_BEACON = {
  title: 'SIGNAL BEACON · HIGH-ORBIT OBSERVATORY',
  speaker: '[TERMINAL]' as SpeakerTag,
  chunks: [
    'Orbital uplink locked. Frequencies are open across deep space if you need an AI systems architect or technical leader.',
    'Select a direct transmission channel below to send email coordinates, open WhatsApp radio, or book a council session.',
  ] as readonly string[],
  text: 'Frequencies open, traveler. If you require an AI systems engineer, technical leader, or narrative architect for your expedition, transmit your coordinates.',
  channels: [
    { type: 'Email', label: 'Transmit Email', val: 'mailto:boris.quijano@live.com' },
    { type: 'WhatsApp', label: 'Direct Radio (+503 7118 0568)', val: 'https://wa.me/50371180568' },
    { type: 'Calendar', label: 'Schedule Council Session', val: 'https://cal.com/borisquijano' },
  ] as readonly SignalChannel[],
} as const;

/**
 * Mimic Roast Chest satirical hype drops triggered via [R], [SELECT], or campfire chest hotspot.
 */
export const ROAST_CHEST = {
  title: 'MIMIC CHEST · HYPE INCINERATOR',
  speaker: '[MS. DEVIL]' as SpeakerTag,
  items: [
    "Item looted: 'Certified Prompt Engineer Diploma'. You set it on fire to cook sausages at the campfire.",
    "Item looted: '99+ LinkedIn AI Influencer Hacks'. Deflated into a small puff of hot air.",
    "Item looted: '14-Day AI Millionaire Masterclass'. Requires 0 XP to discard immediately.",
  ] as readonly string[],
  verdict: 'Prompt whisperer certificate: burned.',
} as const;

/**
 * Studio Credits & Democracy of Three governance script accessible from the `[START]` pause menu.
 */
export const CREDITS_SCRIPT = {
  title: 'HERO WALL STUDIO · CREDITS',
  speaker: '[TERMINAL]' as SpeakerTag,
  governance: 'Democracy of Three across 3 Execution Tiers',
  democracyOfThree: [
    { role: 'Boris · Director', focus: 'Immersion, Metaphor & Sherpa Vision' },
    { role: 'RASS · Architect', focus: '60 FPS Systems, Ergonomics & Edge Telemetry' },
    { role: 'Ms. Devil · Skeptic', focus: 'Adversarial QA, Anti-Bloat & Warp Juice' },
  ] as const,
  chunks: [
    'Hero Wall Studio Rebuild (SPEC-022) — Directed under the Democracy of Three: Boris (Director), RASS (Architect), and Ms. Devil (Skeptic).',
    'Built with Astro 5, TypeScript, PixiJS v8 WebGPU + Canvas2D fallback, zero-asset 16-bit Web Audio synthesis, and native Baseline HTML APIs.',
    'Sanctuary anchored in El Salvador (UTC-6). Execution = Sovereignty. Thanks for walking the frontier, traveler.',
  ] as readonly string[],
  text: 'Hero Wall Studio Rebuild (SPEC-022) — Democracy of Three: Boris (Director), RASS (Architect), Ms. Devil (Skeptic). Built with Astro 5, PixiJS v8 WebGPU/Canvas2D, and 0-KB 16-bit Web Audio synthesis.',
} as const;

/**
 * Classic Pokémon-style `[START]` command menu descriptors shared with SnesDialogueBox.astro.
 */
export const START_MENU_COMMANDS = [
  { action: 'dossier', label: 'Dossier', hint: 'Stats & Lore' },
  { action: 'relics', label: 'Inventory / Relics', hint: 'Bio-Forge' },
  { action: 'town-map', label: 'Town Map', hint: '4 Portals' },
  { action: 'badges', label: `Badges (${TROPHY_CARDS.length})`, hint: 'Armory' },
  { action: 'transmit', label: 'Transmit', hint: 'Comms' },
  { action: 'settings', label: 'Settings', hint: 'Audio & CRT' },
  { action: 'credits', label: 'Credits', hint: 'Studio' },
] as const;
