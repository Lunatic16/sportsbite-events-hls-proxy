import type { SBEvent } from "@/lib/sportsbite";

export type StatusFilter = "all" | "live" | "upcoming";

export function sportLabel(sport: string): string {
  return sport
    .split("-")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

export function isSameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** "20:45" if today, otherwise "Sat, Nov 15 · 20:45" in the viewer's timezone. */
export function formatKickoff(timestamp: number, now: number): string {
  const d = new Date(timestamp);
  const time = d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  if (isSameLocalDay(d, new Date(now))) return time;
  const day = d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
  return `${day} · ${time}`;
}

export function formatCountdown(deltaMs: number): string {
  if (deltaMs <= 0) return "starting";
  const totalMin = Math.floor(deltaMs / 60_000);
  const days = Math.floor(totalMin / 1440);
  const hours = Math.floor((totalMin % 1440) / 60);
  const mins = totalMin % 60;
  if (days > 0) return `in ${days}d ${hours}h`;
  if (hours > 0) return `in ${hours}h ${mins.toString().padStart(2, "0")}m`;
  return `in ${mins}m`;
}

/** Live events first, then upcoming by kickoff time, then the rest by kickoff desc. */
export function sortEvents(events: SBEvent[], now: number): SBEvent[] {
  const rank = (e: SBEvent) => (e.status === "live" ? 0 : e.timestamp >= now ? 1 : 2);
  return [...events].sort((a, b) => {
    const r = rank(a) - rank(b);
    if (r !== 0) return r;
    return rank(a) === 2 ? b.timestamp - a.timestamp : a.timestamp - b.timestamp;
  });
}

export function eventDisplayTeams(event: SBEvent): { home: string; away: string } | null {
  const home = event.teams?.home?.name?.trim();
  const away = event.teams?.away?.name?.trim();
  if (home && away) return { home, away };
  return null;
}
