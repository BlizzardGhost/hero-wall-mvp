export type Relic = {
  title: string;
  img: string;   // /public/relics/*
  href?: string; // external link
};

export const relics: Relic[] = [
  {
    title: "Kidslab",
    img: "/relics/kidslab-lat.png",
    href: "https://kidslab.lat"
  },
  {
    title: "Infusion",
    img: "/relics/infusion.png",
    href: "https://infusion-site.vercel.app/" // keep Vercel link for now
  },
  {
    title: "Esencia Branding",
    img: "/relics/esencia.png",
    href: "https://esenciabranding.com"
  }
];