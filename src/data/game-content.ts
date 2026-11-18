/*
 * Path: src/data/game-content.ts
 * Purpose: Canonical SPEC-021 16-bit RPG Overworld game data, FSM types, SNES color palette,
 *          5-biome definitions, verbatim dialogue scripts, Character Dossier stats,
 *          Hall of Eras, Relic Vault, Signal Beacon, Mimic Roast Chest, and all 21 Trophy Cards.
 * Spec Reference: SPEC-021 (021-hero-wall-full-game-overworld)
 *
 * Operator Notes:
 * - All dialogue and lore copy matches `task_1794700000_hero_wall_full_game_overworld.json`
 *   verbatim so Canvas/Pixi hotspots, SnesDialogueBox, and CharacterDossier share one source of truth.
 * - All 21 trophy cards are wrapped directly from `./badges` without mutating legacy card definitions.
 */

import { badges } from './badges.ts';
import type { Badge, Tier } from './badges.ts';

export type { Badge, Tier };
export { badges };

/**
 * Top-level overworld game finite-state-machine states.
 */
export type GameState =
  | 'EXPLORING'
  | 'DIALOGUE'
  | 'INSPECT_RELIC'
  | 'CHARACTER_SHEET'
  | 'MIMIC_ROAST';

/**
 * Five contiguous biomes across the 2400px panoramic SNES overworld.
 */
export type BiomeId = 'sanctuary' | 'eras' | 'relics' | 'trophies' | 'beacon';

/**
 * Core SNES 16-bit palette tokens (warm campfire amber, lush moss, arcane rune purple,
 * forge copper, starfield cyan, obsidian ruins, gilded gold, navy dialogue chrome, dog cream).
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
} as const;

export interface BiomeMeta {
  id: BiomeId;
  index: number;
  hotkey: string;
  name: string;
  shortLabel: string;
  subtitle: string;
  accentCss: string;
  accentHex: number;
  xStart: number;
  xEnd: number;
  spawnX: number;
}

/**
 * Ordered biome manifest used by HUD fast-travel pills, world-biomes rendering,
 * and camera/hotspot region indicators.
 */
export const BIOME_LIST: readonly BiomeMeta[] = [
  {
    id: 'sanctuary',
    index: 1,
    hotkey: '1',
    name: '1. Sanctuary Campfire',
    shortLabel: 'Sanctuary',
    subtitle: 'Lush moss grass and warm amber hearth in El Salvador',
    accentCss: SNES_PALETTE.amber,
    accentHex: 0xf97316,
    xStart: 0,
    xEnd: 480,
    spawnX: 220,
  },
  {
    id: 'eras',
    index: 2,
    hotkey: '2',
    name: '2. Hall of Eras',
    shortLabel: 'Eras',
    subtitle: 'Obsidian monolith ruins glowing with arcane purple runes',
    accentCss: SNES_PALETTE.runePurple,
    accentHex: 0xa855f7,
    xStart: 480,
    xEnd: 960,
    spawnX: 720,
  },
  {
    id: 'relics',
    index: 3,
    hotkey: '3',
    name: '3. Cyber-Forge Relic Vault',
    shortLabel: 'Relics',
    subtitle: 'Copper and magma pedestals housing shipped AI systems',
    accentCss: SNES_PALETTE.forgeCopper,
    accentHex: 0xea580c,
    xStart: 960,
    xEnd: 1440,
    spawnX: 1200,
  },
  {
    id: 'trophies',
    index: 4,
    hotkey: '4',
    name: '4. Trophy Armory',
    shortLabel: 'Trophies',
    subtitle: 'Gilded hall displaying 21 battle-forged achievement cards',
    accentCss: SNES_PALETTE.gold,
    accentHex: 0xfacc15,
    xStart: 1440,
    xEnd: 1920,
    spawnX: 1680,
  },
  {
    id: 'beacon',
    index: 5,
    hotkey: '5',
    name: '5. Mountain Signal Beacon',
    shortLabel: 'Beacon',
    subtitle: 'Starfield cyan summit relay open for expedition coordinates',
    accentCss: SNES_PALETTE.starCyan,
    accentHex: 0x06b6d4,
    xStart: 1920,
    xEnd: 2400,
    spawnX: 2140,
  },
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
 * Character Dossier sheet opened via [C] / [START] or Sanctuary Campfire dialogue choice.
 * Preserves Boris's real portrait photo inside a retro pixelated gold bezel.
 */
export const CHARACTER_DOSSIER = {
  hotkey: 'C or START',
  image: '/img/boris-portrait.png',
  imageNote: 'Preserve Boris real photo in pixel frame',
  name: 'Boris Quijano',
  class: 'LATAM AI Sherpa / Narrative Architect',
  level: 'Level 39 (Sovereign Age)',
  levelNumber: 39,
  protocol: 'RASS v39.1.3',
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
  memorialTribute:
    'In memory of Emy, Kiba, and Yue. Companions who walked the hard road through Medellín and whose spirit guards the perimeter here in El Salvador. A sovereign sherpa never walks alone.',
} as const;

/**
 * Sanctuary Citadel campfire monologue and quick branching choices.
 */
export const SANCTUARY_CAMPFIRE = {
  title: 'SANCTUARY CITADEL · CAMPFIRE',
  speaker: 'Boris (Level 39 Sherpa)',
  text: "Pull up a seat by the fire, traveler. You’ve reached sovereign ground in El Salvador. Out here, we don't worship AI hype or collect empty certifications. We forge battle-tested agent systems, teach the next generation at KidsLab, and build digital autonomy. Explore the ruins to inspect our history, open the Relic Vault to examine live production systems, or climb to the Signal Beacon if you want to collaborate.",
  choices: [
    'Open Character Dossier [C]',
    'Pet Companion Dog [B]',
    'Roast Hype Chest [R]',
  ] as const,
} as const;

/**
 * White Dog memorial encounter honoring Emy, Kiba, and Yue.
 */
export const MEMORIAL_DOG = {
  title: 'FAITHFUL COMPANION · EMY, KIBA & YUE',
  speaker: 'White Dog',
  text: '(The white dog wags its tail softly, looking up with warm, steady eyes. A quiet chime rings out.) Woof! In memory of Emy, Kiba, and Yue. Companions who walked the hard road through Medellín and whose spirit guards the perimeter here in El Salvador. A sovereign sherpa never walks alone.',
  effect: '+10 Morale Restored',
} as const;

/**
 * Cockpit advisor banter between RASS Drone and Ms. Devil.
 */
export const COMPANION_DRONES = {
  title: 'COCKPIT ADVISORS · RASS & MS. DEVIL',
  speakers: [
    {
      name: 'RASS Drone',
      text: 'All sensors nominal, Captain. Edge telemetry synced, memory persistent, zero serverless hallucinations. Where are we deploying next?',
    },
    {
      name: 'Ms. Devil',
      text: "Don't let him wander around the map admiring the scenery, RASS. The difference between a builder and a dreamer is observable output. Let's see what relics he actually shipped.",
    },
  ] as const,
} as const;

export interface EraEntry {
  id: string;
  year: string;
  era: string;
  lore: string;
  accent: string;
}

/**
 * Five career and endurance obelisks inside Biome 2 (Hall of Eras).
 */
export const HALL_OF_ERAS: readonly EraEntry[] = [
  {
    id: 'era-0',
    year: '2010 - 2013',
    era: 'Stone Age · App Apprentice',
    lore: 'The foundations of corporate IT, server racks, and design systems. Monolith etched with scars: Corporate collapse and total skill reset.',
    accent: '#94a3b8',
  },
  {
    id: 'era-1',
    year: '2014 - 2018',
    era: 'Steel Age · Hero Reborn',
    lore: 'Agency scale, high-ticket US client delivery, and full-stack systems. Monolith etched: Overload burnout from carrying entire systems solo.',
    accent: SNES_PALETTE.starCyan,
  },
  {
    id: 'era-2',
    year: '2019 - 2022',
    era: 'Crystal Age · Wandering Nomad',
    lore: 'Remote LATAM infrastructure and international consulting. Monolith etched: Relational and personal implosion. The wilderness years.',
    accent: SNES_PALETTE.runePurple,
  },
  {
    id: 'era-3',
    year: '2023 - 2025',
    era: 'Graphene Age · Siege & AI Systems',
    lore: 'Autonomous multi-agent pipelines and generative media workflows. Monolith etched: The Medellín Siege Mode unlocked. Chaos turned into discipline.',
    accent: SNES_PALETTE.amber,
  },
  {
    id: 'era-4',
    year: '2026 - Present',
    era: 'Sovereign Age · Sanctuary & Fleet Ops',
    lore: 'Embodied edge intelligence (RASS), KidsLab 3.0, and El Salvador sanctuary. Monolith glowing gold: 365-day loop closed. Full sovereignty reclaimed.',
    accent: SNES_PALETTE.gold,
  },
] as const;

export interface RelicEntry {
  id: string;
  name: string;
  category: string;
  stats: string;
  lore: string;
  url: string;
  btn: string;
}

/**
 * Three production artifacts displayed on pedestals inside Biome 3 (Cyber-Forge Relic Vault).
 */
export const RELIC_VAULT: readonly RelicEntry[] = [
  {
    id: 'relic-0',
    name: 'KidsLab 3.0 Core Matrix',
    category: 'EdTech & Human-First STEM Ecosystem',
    stats: '105+ Students across LATAM | 80% Retention | Game Creator Lab',
    lore: 'AI-powered intake routing meets human mentorship. Teaching kids to build worlds, not just consume screens.',
    url: 'https://kidslab.education',
    btn: 'Enter Academy',
  },
  {
    id: 'relic-1',
    name: 'Infusio AI Studio Engine',
    category: 'Boutique AI Engineering & Edge Automation',
    stats: '5+ Autonomous Edge Agents | Headless Astro 5 Architecture',
    lore: 'Autonomous intake concierges and pragmatic AI workflows for real-world businesses.',
    url: 'https://infusio.pro',
    btn: 'Inspect Studio',
  },
  {
    id: 'relic-2',
    name: 'Camp David Field Compass',
    category: 'Brand Direction & Operational Launch',
    stats: 'Full Visual Identity & Digital Launch Coordination',
    lore: 'Grounded field execution built to withstand reality.',
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
 * All 21 battle-forged achievement cards wrapped directly from `./badges`,
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
 * Trophy Armory metadata for Biome 4 pedestal dialogue and Character Dossier armory tab.
 */
export const TROPHY_ARMORY = {
  title: 'TROPHY ARMORY · 21 BATTLE CARDS',
  speaker: 'Armory Archivist',
  lore_intro:
    '21 battle-forged achievements commemorating survival, discipline, and system architecture.',
  items: TROPHY_CARDS.length,
  format: 'Interactive pedestal popup with XP, rarity tier, and lore quote upon interaction.',
} as const;

export interface SignalChannel {
  type: 'Email' | 'WhatsApp' | 'Calendar';
  label: string;
  val: string;
}

/**
 * Mountain Signal Beacon transmission channels in Biome 5.
 */
export const SIGNAL_BEACON = {
  title: 'SIGNAL BEACON · TRANSMISSION TOWER',
  speaker: 'Radio Operator',
  text: 'Frequencies open, traveler. If you require an AI systems engineer, technical leader, or narrative architect for your expedition, transmit your coordinates.',
  channels: [
    { type: 'Email', label: 'Transmit Email', val: 'mailto:boris.quijano@live.com' },
    { type: 'WhatsApp', label: 'Direct Radio (+503 7118 0568)', val: 'https://wa.me/50371180568' },
    { type: 'Calendar', label: 'Schedule Council Session', val: 'https://cal.com/borisquijano' },
  ] as readonly SignalChannel[],
} as const;

/**
 * Mimic Roast Chest satirical hype drops triggered via [R], [SELECT], or chest hotspot.
 */
export const ROAST_CHEST = {
  title: 'MIMIC CHEST · HYPE INCINERATOR',
  speaker: 'Mimic Roast Chest',
  items: [
    "Item looted: 'Certified Prompt Engineer Diploma'. You set it on fire to cook sausages at the campfire.",
    "Item looted: '99+ LinkedIn AI Influencer Hacks'. Deflated into a small puff of hot air.",
    "Item looted: '14-Day AI Millionaire Masterclass'. Requires 0 XP to discard immediately.",
  ] as readonly string[],
  verdict: 'Prompt whisperer certificate: burned.',
} as const;
