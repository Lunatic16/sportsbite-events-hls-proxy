/**
 * Quick offline check of buildM3U formatting paths (upcoming + servers=all),
 * run with: bun scripts/test-m3u-format.ts
 */
import { buildM3U } from "../src/lib/iptv-playlist";
import type { SBEvent } from "../src/lib/sportsbite";

const now = Date.now();

const upcoming: SBEvent = {
  id: "evt-1",
  slug: "knicks-pacers",
  title: "New York Knicks vs. Indiana Pacers",
  sport: "basketball",
  tournament: { name: "NBA", logo: "https://sportsbite.org/img/c/nba.webp" },
  starts_at: new Date(now + 3600_000).toISOString(),
  timestamp: now + 3600_000,
  date: "2026-11-14",
  kickoff_time: "19:30",
  status: "upcoming",
  teams: {
    home: { name: "New York Knicks", logo: "https://sportsbite.org/img/t/knicks.webp" },
    away: { name: "Indiana Pacers", logo: null },
  },
  embed_url: null,
  watch_url: "https://sportsbite.org/e/knicks-pacers",
  streams: [
    { id: "s-upcoming1", name: "Server 1", embed_url: "https://embed.sportsbite.org/selfhost/e/s-upcoming1", quality: "1080p", language: "EN" },
    { id: "s-upcoming2", name: "Server 2", embed_url: "https://embed.sportsbite.org/selfhost/e/s-upcoming2", quality: "720p", language: null },
  ],
};

const live: SBEvent = {
  ...structuredClone(upcoming),
  id: "evt-2",
  slug: "live-game",
  title: 'Team "A" vs Team B',
  sport: "american-football",
  status: "live",
  timestamp: now - 1800_000,
  streams: [{ id: "s-live1", name: "Server 1", embed_url: "https://embed.sportsbite.org/selfhost/e/s-live1" }],
};

const finished: SBEvent = {
  ...structuredClone(live),
  id: "evt-3",
  slug: "finished-game",
  title: "Finished Game",
  status: "upcoming",
  timestamp: now - 2 * 3600_000, // beyond 20 min grace -> must be dropped
};

const out = buildM3U([finished, upcoming, live], { baseUrl: "https://relay.example.com", servers: "all" });
console.log(out.replace(/\r\n/g, "\n"));

// Assertions
const assert = (cond: boolean, label: string) => {
  if (!cond) {
    console.error(`FAIL: ${label}`);
    process.exit(1);
  }
  console.log(`ok: ${label}`);
};
assert(out.includes("[LIVE] Team A vs Team B"), "live prefix + quote stripping");
assert(out.includes("American Football"), "sport label hyphen handling");
assert(out.includes("UTC"), "kickoff UTC marker present");
assert(out.includes("Server 1 · 1080p · EN"), "servers=all suffix with quality+language");
assert(out.includes("https://relay.example.com/api/hls/play/s-upcoming1"), "absolute channel URL");
assert(out.includes('tvg-logo="https://relay.example.com/api/img?u='), "logo relayed through /api/img");
assert(!out.includes("Finished Game"), "finished event dropped");
assert(out.split("\r\n").length === out.split("\n").length, "CRLF-only line endings");
