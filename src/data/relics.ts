export type Relic = {
  title: string;
  category: string;
  desc: string;
  img: string;
  href?: string;
  tags: string[];
};

export const relics: Relic[] = [
  {
    title: "KidsLab 3.0",
    category: "AI Education & STEM Ecosystem",
    desc: "Digital STEM learning academy for 105+ students across LATAM with 80% retention and AI personalized intake.",
    img: "/relics/kidslab-lat.png",
    href: "https://kidslab.lat",
    tags: ["EdTech", "AI Agents", "STEM LATAM"]
  },
  {
    title: "Infusio",
    category: "AI Boutique Studio & B2B Solutions",
    desc: "High-performance AI multi-agent architectures, headless CMS edge infrastructure, and autonomous workflows.",
    img: "/relics/infusion.png",
    href: "https://infusio.pro",
    tags: ["Multi-Agent Fleet", "Astro 5", "Edge Intelligence"]
  },
  {
    title: "Esencia Branding",
    category: "Strategic Branding & Visual Narrative",
    desc: "End-to-end brand identity, narrative architecture, and executive creative direction across US and LATAM.",
    img: "/relics/esencia.png",
    href: "https://esenciabranding.com",
    tags: ["Brand Strategy", "UX Design", "Creative Direction"]
  }
];
