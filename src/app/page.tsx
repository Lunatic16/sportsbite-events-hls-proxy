"use client";

import { useCallback, useMemo, useState, useEffect } from "react";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { AlertTriangle, Database, Radio, Server, Timer, Trophy, Zap } from "lucide-react";
import type { SBEvent, SBScheduleResponse } from "@/lib/sportsbite";
import { Button } from "@/components/ui/button";
import { HeaderBar } from "@/components/watch/header-bar";
import { FilterBar, type Filters } from "@/components/watch/filter-bar";
import { EventCard, EventCardSkeleton } from "@/components/watch/event-card";
import { PlayerDialog } from "@/components/watch/player-dialog";
import {
  MultiViewOverlay,
  MultiViewTray,
  MULTIVIEW_MAX,
  type MultiViewLayout,
} from "@/components/watch/multiview-player";
import { sortEvents } from "@/components/watch/utils";

const PAGE_LIMIT = 100;
const REFRESH_MS = 60_000;

interface ScheduleParams {
  sport: string | null;
  status: "all" | "live" | "upcoming";
  date: string | null;
}

async function fetchSchedulePage(params: ScheduleParams, page: number): Promise<SBScheduleResponse> {
  const sp = new URLSearchParams({ page: String(page), limit: String(PAGE_LIMIT) });
  if (params.sport) sp.set("sport", params.sport);
  if (params.date) sp.set("date", params.date);
  if (params.status !== "all") sp.set("status", params.status);
  const res = await fetch(`/api/schedule?${sp.toString()}`);
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `Schedule request failed (${res.status})`);
  }
  return (await res.json()) as SBScheduleResponse;
}

function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

function StatCard({
  icon,
  label,
  value,
  accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border/60 bg-card/50 px-4 py-3">
      <span
        className={`flex h-8 w-8 items-center justify-center rounded-lg border ${
          accent
            ? "border-rose-500/30 bg-rose-500/10 text-rose-400"
            : "border-emerald-500/25 bg-emerald-500/10 text-emerald-400"
        }`}
        aria-hidden="true"
      >
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-lg font-semibold leading-tight tabular-nums">{value}</p>
        <p className="truncate text-[11px] text-muted-foreground">{label}</p>
      </div>
    </div>
  );
}

export default function Home() {
  const [filters, setFilters] = useState<Filters>({ sport: null, status: "all", date: null, search: "" });
  const [watching, setWatching] = useState<SBEvent | null>(null);
  const [multiIds, setMultiIds] = useState<string[]>([]);
  const [multiOpen, setMultiOpen] = useState(false);
  const [multiLayout, setMultiLayout] = useState<MultiViewLayout>("grid");
  const now = useNow(30_000);

  const onChange = useCallback((patch: Partial<Filters>) => {
    setFilters((f) => ({ ...f, ...patch }));
  }, []);

  // Main schedule query (server-filtered, paginated, auto-refresh every 60s).
  const schedule = useInfiniteQuery({
    queryKey: ["schedule", { sport: filters.sport, status: filters.status, date: filters.date }],
    queryFn: ({ pageParam }) =>
      fetchSchedulePage({ sport: filters.sport, status: filters.status, date: filters.date }, pageParam),
    initialPageParam: 1,
    getNextPageParam: (last) =>
      last.pagination.page < last.pagination.pages ? last.pagination.page + 1 : undefined,
    refetchInterval: REFRESH_MS,
  });

  // Facet query: one unfiltered (cached) call drives chips, live count and stats.
  const facets = useQuery({
    queryKey: ["facets"],
    queryFn: () => fetchSchedulePage({ sport: null, status: "all", date: null }, 1),
    refetchInterval: REFRESH_MS,
  });

  const events = useMemo(
    () => (schedule.data ? schedule.data.pages.flatMap((p) => p.events) : []),
    [schedule.data],
  );

  const sorted = useMemo(() => sortEvents(events, now), [events, now]);

  const filtered = useMemo(() => {
    const q = filters.search.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter((e) => {
      const haystack = [
        e.title,
        e.teams?.home?.name,
        e.teams?.away?.name,
        e.tournament?.name,
        e.sport,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(q);
    });
  }, [sorted, filters.search]);

  const sports = useMemo(() => {
    const all = facets.data?.events ?? [];
    const counts = new Map<string, number>();
    for (const e of all) counts.set(e.sport, (counts.get(e.sport) ?? 0) + 1);
    return [...counts.entries()]
      .map(([key, count]) => ({ key, count }))
      .sort((a, b) => b.count - a.count);
  }, [facets.data]);

  const liveCount = useMemo(
    () => (facets.data?.events ?? []).filter((e) => e.status === "live").length,
    [facets.data],
  );
  const serverCount = useMemo(
    () => (facets.data?.events ?? []).reduce((n, e) => n + e.streams.length, 0),
    [facets.data],
  );
  const upcomingCount = useMemo(
    () => (facets.data?.events ?? []).filter((e) => e.status !== "live" && e.timestamp >= now).length,
    [facets.data, now],
  );

  const updatedAgo =
    schedule.dataUpdatedAt > 0 ? Math.max(0, Math.round((now - schedule.dataUpdatedAt) / 1000)) : null;

  const isInitialLoading = schedule.isPending;
  const hasError = schedule.isError;

  // Multi-view selection is stored as ids and resolved against live schedule
  // data, so finished/vanished fixtures drop out automatically.
  const multiEvents = useMemo(
    () =>
      multiIds
        .map((id) => events.find((e) => e.id === id))
        .filter((e): e is SBEvent => Boolean(e && e.streams.length > 0)),
    [multiIds, events],
  );

  const toggleMultiView = useCallback((event: SBEvent) => {
    setMultiIds((ids) => {
      if (ids.includes(event.id)) return ids.filter((id) => id !== event.id);
      if (ids.length >= MULTIVIEW_MAX || event.streams.length === 0) return ids;
      return [...ids, event.id];
    });
  }, []);

  const removeFromMulti = useCallback((eventId: string) => {
    setMultiIds((ids) => ids.filter((id) => id !== eventId));
  }, []);

  return (
    <div className="flex min-h-screen flex-col">
      <HeaderBar
        liveCount={liveCount}
        loading={schedule.isFetching}
        onRefresh={() => {
          void schedule.refetch();
          void facets.refetch();
        }}
      />

      <main className="mx-auto w-full max-w-7xl flex-1 px-4 pb-12 pt-6 sm:px-6">
        {/* Stats */}
        <section className="grid grid-cols-2 gap-3 sm:grid-cols-4" aria-label="Relay statistics">
          <StatCard icon={<Zap className="h-4 w-4" />} label="Live now" value={String(liveCount)} accent={liveCount > 0} />
          <StatCard icon={<Timer className="h-4 w-4" />} label="Upcoming" value={String(upcomingCount)} />
          <StatCard icon={<Server className="h-4 w-4" />} label="Stream servers" value={String(serverCount)} />
          <StatCard
            icon={<Database className="h-4 w-4" />}
            label={updatedAgo === null ? "Schedule cache" : `Cache · updated ${updatedAgo}s ago`}
            value={String(facets.data?.pagination.total ?? "—")}
          />
        </section>

        {/* Filters */}
        <section className="mt-5" aria-label="Filters">
          <FilterBar filters={filters} onChange={onChange} sports={sports} />
        </section>

        {/* Schedule grid */}
        <section className="mt-5" aria-label="Schedule">
          {hasError ? (
            <div className="flex flex-col items-center gap-3 rounded-xl border border-rose-500/30 bg-rose-500/5 px-6 py-12 text-center">
              <AlertTriangle className="h-8 w-8 text-rose-400" aria-hidden="true" />
              <p className="text-sm text-zinc-200">
                {(schedule.error as Error)?.message ?? "Failed to load the schedule."}
              </p>
              <Button variant="outline" size="sm" onClick={() => void schedule.refetch()}>
                Try again
              </Button>
            </div>
          ) : isInitialLoading ? (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {Array.from({ length: 8 }, (_, i) => (
                <EventCardSkeleton key={i} />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-3 rounded-xl border border-border/60 bg-card/50 px-6 py-16 text-center">
              <Trophy className="h-8 w-8 text-muted-foreground/60" aria-hidden="true" />
              <p className="text-sm text-muted-foreground">
                No events match the current filters.
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setFilters({ sport: null, status: "all", date: null, search: "" })}
              >
                Reset filters
              </Button>
            </div>
          ) : (
            <>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {filtered.map((event) => (
                  <EventCard
                    key={event.id}
                    event={event}
                    now={now}
                    onWatch={setWatching}
                    inMultiView={multiIds.includes(event.id)}
                    multiFull={multiIds.length >= MULTIVIEW_MAX}
                    onToggleMultiView={toggleMultiView}
                  />
                ))}
              </div>
              {schedule.hasNextPage && (
                <div className="mt-6 flex justify-center">
                  <Button
                    variant="outline"
                    onClick={() => void schedule.fetchNextPage()}
                    disabled={schedule.isFetchingNextPage}
                    className="gap-2"
                  >
                    {schedule.isFetchingNextPage ? (
                      <>
                        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-emerald-400 border-t-transparent" />
                        Loading…
                      </>
                    ) : (
                      <>
                        <Radio className="h-4 w-4" aria-hidden="true" />
                        Load more (
                        {(schedule.data?.pages[0]?.pagination.total ?? filtered.length) - filtered.length} remaining)
                      </>
                    )}
                  </Button>
                </div>
              )}
              <p className="mt-4 text-center text-[11px] text-muted-foreground/70">
                Showing {filtered.length} of {schedule.data?.pages[0]?.pagination.total ?? filtered.length} events ·
                auto-refreshes every 60s through the cached relay
              </p>
            </>
          )}
        </section>
      </main>

      <footer className="mt-auto border-t border-border/60 bg-card/30">
        <div className="mx-auto flex max-w-7xl flex-col gap-1.5 px-4 py-4 text-[11px] leading-relaxed text-muted-foreground/80 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p>
            Unofficial viewer for the public{" "}
            <a
              href="https://sportsbite.org/api"
              target="_blank"
              rel="noreferrer noopener"
              className="text-emerald-400/80 underline-offset-2 hover:underline"
            >
              SportsBite schedule API
            </a>
            . Not affiliated with sportsbite.org. Match data, teams and streams belong to their
            respective owners.
          </p>
          <p className="shrink-0 sm:pl-6">
            HLS relay: <code className="rounded bg-muted/60 px-1 py-0.5">/api/hls/play/&#123;streamId&#125;</code> ·
            IPTV playlist: <code className="rounded bg-muted/60 px-1 py-0.5">/playlist.m3u8</code> ·
            playback via hls.js
          </p>
        </div>
      </footer>

      <PlayerDialog event={watching} open={watching !== null} onOpenChange={(o) => !o && setWatching(null)} />

      {!multiOpen && (
        <MultiViewTray
          events={multiEvents}
          onOpen={() => setMultiOpen(true)}
          onRemove={removeFromMulti}
          onClear={() => setMultiIds([])}
        />
      )}
      {multiOpen && (
        <MultiViewOverlay
          events={multiEvents}
          layout={multiLayout}
          onLayoutChange={setMultiLayout}
          onClose={() => setMultiOpen(false)}
          onRemove={removeFromMulti}
          onClear={() => setMultiIds([])}
        />
      )}
    </div>
  );
}
