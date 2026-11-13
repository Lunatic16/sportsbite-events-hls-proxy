"use client";

import { Clock, LayoutGrid, Play, Server } from "lucide-react";
import type { SBEvent, SBTeam } from "@/lib/sportsbite";
import { proxyAsset } from "@/lib/asset-proxy";
import { Button } from "@/components/ui/button";
import { eventDisplayTeams, formatCountdown, formatKickoff, sportLabel } from "./utils";

function TeamLogo({ team, side }: { team: SBTeam; side: "home" | "away" }) {
  const logo = proxyAsset(team.logo);
  if (logo) {
    return (
      <img
        src={logo}
        alt={`${team.name} logo`}
        width={36}
        height={36}
        loading="lazy"
        className="h-9 w-9 shrink-0 rounded-md object-contain"
      />
    );
  }
  return (
    <div
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border/70 bg-muted text-xs font-semibold text-muted-foreground"
      aria-hidden="true"
    >
      {team.name ? team.name.charAt(0).toUpperCase() : side === "home" ? "H" : "A"}
    </div>
  );
}

function TeamRow({ team, side }: { team: SBTeam; side: "home" | "away" }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <TeamLogo team={team} side={side} />
      <span className="truncate text-sm font-medium">{team.name || "TBD"}</span>
    </div>
  );
}

interface EventCardProps {
  event: SBEvent;
  now: number;
  onWatch: (event: SBEvent) => void;
  inMultiView: boolean;
  multiFull: boolean;
  onToggleMultiView: (event: SBEvent) => void;
}

export function EventCard({ event, now, onWatch, inMultiView, multiFull, onToggleMultiView }: EventCardProps) {
  const isLive = event.status === "live";
  const hasStreams = event.streams.length > 0;
  const teams = eventDisplayTeams(event);
  const delta = event.timestamp - now;

  return (
    <article
      className={`group relative flex flex-col overflow-hidden rounded-xl border bg-card/70 p-4 transition-all duration-200 ${
        isLive
          ? "border-rose-500/25 shadow-[0_0_24px_-12px_rgba(244,63,94,0.35)]"
          : "border-border/60"
      } hover:-translate-y-0.5 hover:border-emerald-500/40 hover:shadow-[0_0_30px_-14px_rgba(16,185,129,0.45)]`}
    >
      {/* Tournament + status */}
      <div className="mb-3 flex items-center gap-2">
        {(() => {
          const tLogo = proxyAsset(event.tournament.logo);
          return tLogo ? (
            <img
              src={tLogo}
              alt={`${event.tournament.name} logo`}
              width={16}
              height={16}
              loading="lazy"
              className="h-4 w-4 shrink-0 rounded object-contain"
            />
          ) : null;
        })()}
        <span className="truncate text-xs text-muted-foreground">{event.tournament.name}</span>
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          <span className="rounded-md border border-border/60 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">
            {sportLabel(event.sport)}
          </span>
          {isLive ? (
            <span className="inline-flex items-center gap-1.5 rounded-md border border-rose-500/30 bg-rose-500/10 px-1.5 py-0.5 text-[10px] font-bold text-rose-400">
              <span className="live-dot h-1.5 w-1.5 rounded-full bg-rose-500" aria-hidden="true" />
              LIVE
            </span>
          ) : (
            delta > 0 && (
              <span className="rounded-md border border-emerald-500/25 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-400">
                {formatCountdown(delta)}
              </span>
            )
          )}
        </span>
      </div>

      {/* Teams or single-title layout */}
      {teams ? (
        <div className="flex flex-col gap-2.5 py-1">
          <TeamRow team={event.teams.home} side="home" />
          <div className="flex items-center gap-3 pl-[2.15rem]">
            <span className="text-[10px] font-bold tracking-widest text-muted-foreground/70">VS</span>
            <div className="h-px flex-1 bg-border/50" />
          </div>
          <TeamRow team={event.teams.away} side="away" />
        </div>
      ) : (
        <div className="flex min-h-[5.5rem] items-center">
          <p className="text-base font-semibold leading-snug">{event.title}</p>
        </div>
      )}

      {/* Footer: kickoff + streams + watch */}
      <div className="mt-4 flex items-center gap-2 border-t border-border/50 pt-3">
        <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
          <Clock className="h-3.5 w-3.5" aria-hidden="true" />
          {formatKickoff(event.timestamp, now)}
        </span>
        <span className="hidden min-[420px]:flex items-center gap-1 truncate text-[11px] text-muted-foreground">
          <Server className="h-3 w-3" aria-hidden="true" />
          {hasStreams
            ? `${event.streams.length} server${event.streams.length > 1 ? "s" : ""}`
            : "no server yet"}
        </span>
        {inMultiView && (
          <span className="mr-1.5 hidden items-center rounded-md border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-400 sm:flex">
            multi
          </span>
        )}
        <button
          type="button"
          onClick={() => onToggleMultiView(event)}
          disabled={!hasStreams || (!inMultiView && multiFull)}
          aria-label={
            inMultiView
              ? `Remove ${event.title} from multi-view`
              : `Add ${event.title} to multi-view`
          }
          aria-pressed={inMultiView}
          title={
            !hasStreams
              ? "No stream yet"
              : inMultiView
                ? "Remove from multi-view"
                : multiFull
                  ? "Multi-view is full (4 events)"
                  : "Add to multi-view"
          }
          className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-md border transition-colors ${
            inMultiView
              ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-300"
              : !hasStreams || (!inMultiView && multiFull)
                ? "cursor-not-allowed border-border/60 text-muted-foreground/40"
                : "border-border/70 text-muted-foreground hover:border-emerald-500/40 hover:text-emerald-300"
          }`}
        >
          <LayoutGrid className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
        <Button
          size="sm"
          className={`ml-auto h-8 shrink-0 gap-1.5 ${
            hasStreams
              ? "bg-emerald-500 text-emerald-950 hover:bg-emerald-400"
              : "cursor-not-allowed bg-muted/50 text-muted-foreground hover:bg-muted/50"
          }`}
          disabled={!hasStreams}
          onClick={() => onWatch(event)}
          aria-label={hasStreams ? `Watch ${event.title}` : `${event.title} has no stream yet`}
        >
          <Play className="h-3.5 w-3.5" aria-hidden="true" />
          {isLive && hasStreams ? "Watch live" : hasStreams ? "Watch" : "Upcoming"}
        </Button>
      </div>
    </article>
  );
}

export function EventCardSkeleton() {
  return (
    <div className="animate-pulse rounded-xl border border-border/60 bg-card/50 p-4">
      <div className="mb-3 h-4 w-1/2 rounded bg-muted" />
      <div className="flex flex-col gap-2.5 py-2">
        <div className="flex items-center gap-2.5">
          <div className="h-9 w-9 rounded-md bg-muted" />
          <div className="h-4 w-2/3 rounded bg-muted" />
        </div>
        <div className="flex items-center gap-3 pl-[2.15rem]">
          <div className="h-px flex-1 bg-border/50" />
        </div>
        <div className="flex items-center gap-2.5">
          <div className="h-9 w-9 rounded-md bg-muted" />
          <div className="h-4 w-1/2 rounded bg-muted" />
        </div>
      </div>
      <div className="mt-4 flex border-t border-border/50 pt-3">
        <div className="ml-auto h-8 w-20 rounded-md bg-muted" />
      </div>
    </div>
  );
}
