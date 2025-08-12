// src/data/badges.ts
export type Tier = 'ultimate' | 'prestige' | 'special' | 'locked';

export type Badge = {
  name: string;
  caption: string;
  icon: string;        // ex: "badge_lv2_rass.png" (public/badges/... on disk)
  xp?: number | null;
  tier: Tier;
  earned: boolean;
  tooltip?: string;
  lore?: string;
  category: 'system' | 'urban' | 'burn' | 'utility' | 'treasure' | 'discipline' | 'food' | 'mystery';
  date?: string;
};

export const badges: Badge[] = [
  { name:'Lvl 2 — RASS Protocol Initiate', caption:'First operational activation of the RASS Protocol.', icon:'badge_lv2_rass.png', xp:150, tier:'ultimate', earned:true, tooltip:'Where the systems awoke.', lore:'The moment you stopped running solo and brought RASS online — the AI ally who never sleeps.', category:'system' },
  { name:'Lvl 12 — Command Architect', caption:'Mastery over project flow and command systems.', icon:'badge_lv12_command.png', xp:300, tier:'ultimate', earned:true, tooltip:'Architect of your own fate.', lore:'Your battlemap became more than notes — it became a war room.', category:'system' },
  { name:'Lvl 17 — System Evolution', caption:'Transition into Siege Mode & multi-project coordination without collapse.', icon:'badge_lv17_evolution.png', xp:400, tier:'ultimate', earned:true, tooltip:'Adapt, evolve, dominate.', lore:'This is the point where chaos became order — and stayed that way.', category:'system' },

  { name:'Urban Forager I', caption:'Complete a supply run with 3+ temptations resisted.', icon:'badge_urban_forager1.png', xp:80, tier:'prestige', earned:true, tooltip:'City’s full of traps — you walked past them.', lore:'Street-level discipline in a world designed to make you spend.', category:'urban' },
  { name:'Controlled Burn', caption:'Strategic asset liquidation to secure operations.', icon:'badge_controlled_burn.png', xp:100, tier:'prestige', earned:true, tooltip:'Burn it down to build it right.', lore:'You sold what you had to save what mattered.', category:'burn' },
  { name:'Utility Defender', caption:'2+ months of essential utilities locked in.', icon:'badge_utility_defender.png', xp:120, tier:'prestige', earned:true, tooltip:'The lights stay on. Always.', lore:'Stability is a weapon.', category:'utility' },
  { name:'Treasure Hunter', caption:'Discover unexpected resources/sats in the field.', icon:'badge_treasure_hunter.png', xp:100, tier:'prestige', earned:true, tooltip:'Not all treasure is gold.', lore:'Street smarts meets survival instinct.', category:'treasure' },

  { name:'Impulse Shield', caption:'Resist 3+ dopamine traps in a single day.', icon:'badge_impulse_shield.png', xp:90, tier:'special', earned:true, tooltip:'Temptation denied.', lore:'The armor you forged against your own instincts.', category:'discipline' },
  { name:'Grease Avoidance', caption:'Choose healthy over fried 3+ times in a week.', icon:'badge_grease_avoid.png', xp:70, tier:'special', earned:true, tooltip:'The fryer can’t have you.', lore:'Small victories keep the bigger wars winnable.', category:'food' },

  { name:'Siege Mode Stability', caption:'Maintain Siege Mode for 7 days without breach.', icon:'badge_siege_stability.png', xp:250, tier:'prestige', earned:false, tooltip:'Hold the line.', lore:'The endurance trial of your command system.', category:'system' },
  { name:'Kitchen Constant Improvement', caption:'Maintain 5-day streak of improved food ops.', icon:'badge_kitchen_improve.png', xp:60, tier:'special', earned:false, tooltip:'The kitchen is your forge.', lore:'Crafting meals that fuel the fight.', category:'food' },

  // Mystery cards: treat as locked tier; use category:"mystery" for styling/lore
  { name:'? — Surprise Unlock #1', caption:'Unknown achievement.', icon:'badge_mystery.png', xp:null, tier:'locked', earned:false, tooltip:'Not yet revealed…', lore:'This one hides in the shadows, waiting for the right quest.', category:'mystery' },
  { name:'? — Surprise Unlock #2', caption:'Unknown achievement.', icon:'badge_mystery.png', xp:null, tier:'locked', earned:false, tooltip:'It’s watching you.', lore:'The story hasn’t caught up to this yet.', category:'mystery' },
  { name:'? — Surprise Unlock #3', caption:'Unknown achievement.', icon:'badge_mystery.png', xp:null, tier:'locked', earned:false, tooltip:'Only the worthy will see it.', lore:'Waiting at the edge of the map.', category:'mystery' },
];