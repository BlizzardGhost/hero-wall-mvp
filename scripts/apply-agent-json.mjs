// Run: node scripts/apply-agent-json.mjs
import fs from "node:fs";

const src = "src/data/hero.agent.json";
const out = "src/data/hero.json";

const agent = JSON.parse(fs.readFileSync(src, "utf8"));

// normalize badges to a simple shape your UI can read safely
const normalize = (arr = [], status) =>
  arr.map((title, i) => ({
    id: `${status}-${i + 1}`,
    title,
    status
  }));

const ui = {
  hero: agent.hero,
  abstract: agent.abstract,
  badges: {
    active: normalize(agent?.badges?.active, "active"),
    pending: normalize(agent?.badges?.pending, "pending")
  }
};

fs.writeFileSync(out, JSON.stringify(ui, null, 2));
console.log(`Wrote ${out}`);