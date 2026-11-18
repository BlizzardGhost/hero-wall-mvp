/*
 * Path: src/data/relics.ts
 * Purpose: Featured work entries for Zone 3 (Relic Vault: KidsLab 3.0, Infusio, Camp David).
 * Spec Reference: SPEC-020 (020-hero-wall-16bit-overworld-implementation)
 */

export type Relic = {
  title: string;
  category: string;
  desc: string;
  img?: string;
  href?: string;
  tags: string[];
};

export const relics: Relic[] = [
  {
    title: "KidsLab 3.0",
    category: "AI Education and STEM Ecosystem",
    desc: "Digital STEM academy for 105+ students across LATAM, sustaining 80% retention through human mentoring, Game Creator Lab, and AI intake routing.",
    img: "/relics/kidslab-lat.png",
    href: "https://kidslab.lat",
    tags: ["EdTech", "Game Creator Lab", "STEM LATAM"]
  },
  {
    title: "Infusio",
    category: "AI Systems Studio and B2B Operations",
    desc: "Boutique AI studio building intake concierges, headless web architecture, and edge agent workflows for small businesses.",
    img: "/relics/infusion.png",
    href: "https://infusio.pro",
    tags: ["AI Concierge", "Astro 5", "Edge Workflows"]
  },
  {
    title: "Camp David",
    category: "Brand Systems and Field Operations",
    desc: "Brand direction, visual system design, and digital launch coordination built around grounded field execution.",
    tags: ["Brand Direction", "Digital Ops", "Field Execution"]
  }
];
