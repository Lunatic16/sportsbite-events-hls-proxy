"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import Hls from "hls.js";
import {
  AlertTriangle,
  Columns2,
  Grid2x2,
  Loader2,
  Maximize,
  Minimize,
  Pause,
  Play,
  Plus,
  RotateCcw,
  Rows2,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import type { SBEvent } from "@/lib/sportsbite";
import { Button } from "@/components/ui/button";
import { describeHlsError } from "./player-dialog";

export type MultiViewLayout = "columns" | "rows" | "grid";

export const MULTIVIEW_MAX = 4;

export const LAYOUT_CAPACITY: Record<MultiViewLayout, number> = {
  columns: 2,
  rows: 2,
  grid: 4,
};

const LAYOUT_META: { key: MultiViewLayout; label: string; hint: string; icon: React.ReactNode }[] = [
  { key: "columns", label: "Columns", hint: "2 · side by side", icon: <Columns2 className="h-3.5 w-3.5" aria-hidden="true" /> },
  { key: "rows", label: "Rows", hint: "2 · stacked", icon: <Rows2 className="h-3.5 w-3.5" aria-hidden="true" /> },
  { key: "grid", label: "Grid", hint: "4 · 2×2", icon: <Grid2x2 className="h-3.5 w-3.5" aria-hidden="true" /> },
];

const LAYOUT_GRID: Record<MultiViewLayout, string> = {
  columns: "grid grid-cols-1 gap-3 lg:grid-cols-2",
  rows: "grid grid-cols-1 gap-3",
  grid: "grid grid-cols-1 gap-3 sm:grid-cols-2",
};

/** Column count the layout settles on once the desktop breakpoint kicks in. */
const LG_COLS: Record<MultiViewLayout, number> = {
  columns: 2,
  rows: 1,
  grid: 2,
};

/**
 * Desktop sizing: tiles stretch to equal fractional rows of the viewport
 * (no aspect-ratio lock), so 2 stacked panes are fully visible without
 * scrolling. Mobile keeps aspect-video tiles inside a scrollable column.
 */
const TILE_SIZE = "aspect-video w-full lg:aspect-auto lg:h-full lg:min-h-0";

/* ------------------------------- single tile ------------------------------ */

type PlayState = "loading" | "playing" | "error";

interface MultiViewTileProps {
  event: SBEvent;
  muted: boolean;
  isAudioSource: boolean;
  onTakeAudio: (eventId: string) => void;
  onRemove: (eventId: string) => void;
}

function MultiViewTile({ event, muted, isAudioSource, onTakeAudio, onRemove }: MultiViewTileProps) {
  const streamId = event.streams[0]?.id ?? null;
  const [state, setState] = useState<PlayState>("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [paused, setPaused] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);

  // Reset to loading when the tile is re-pointed at another stream or retried.
  // Done during render (not in an effect) per the React state-adjust pattern.
  const streamKey = `${streamId}:${reloadNonce}`;
  const [prevStreamKey, setPrevStreamKey] = useState(streamKey);
  if (prevStreamKey !== streamKey) {
    setPrevStreamKey(streamKey);
    setState("loading");
    setErrorMsg("");
    setPaused(false);
  }

  // Derive engine availability during render so an unsupported browser shows
  // the error state without any setState inside the attach effect.
  const hlsSupported = typeof Hls.isSupported === "function" && Hls.isSupported();
  const nativeHls = typeof videoEl?.canPlayType === "function" && Boolean(videoEl.canPlayType("application/vnd.apple.mpegurl"));
  const unsupported = Boolean(videoEl) && !hlsSupported && !nativeHls;

  // Attach / detach the HLS engine (same relay entry point as the single player).
  useEffect(() => {
    if (!streamId || !videoEl) return;
    const video = videoEl;
    let cancelled = false;

    const masterUrl = `/api/hls/play/${streamId}`;
    let cleanupMedia: (() => void) | null = null;

    try {
      if (hlsSupported) {
        const hls = new Hls({
          // Main-thread demux (Blob-URL workers stall in some sandboxed browsers);
          // buffers are trimmed harder than the single player because up to 4
          // feeds run concurrently.
          enableWorker: false,
          lowLatencyMode: false,
          backBufferLength: 12,
          maxBufferLength: 10,
          maxMaxBufferLength: 60,
          manifestLoadingTimeOut: 15_000,
          manifestLoadingMaxRetry: 3,
          manifestLoadingRetryDelay: 700,
          manifestLoadingMaxRetryTimeout: 5_000,
          fragLoadingMaxRetry: 6,
          fragLoadingRetryDelay: 900,
        });
        hlsRef.current = hls;

        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          if (cancelled) return;
          setState("playing");
          void video.play().catch(() => {});
        });
        hls.on(Hls.Events.ERROR, (_e, data) => {
          if (cancelled || !data.fatal) return;
          console.error("[relay] multiview fatal hls error", data.details, data.response?.code);
          setErrorMsg(describeHlsError(data));
          setState("error");
        });

        hls.loadSource(masterUrl);
        hls.attachMedia(video);
      } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
        // Safari / iOS native HLS — state flips from media events, never sync.
        const onPlaying = () => {
          if (!cancelled) setState("playing");
        };
        const onMediaError = () => {
          if (!cancelled) {
            setErrorMsg("Native HLS playback failed — the stream may be offline.");
            setState("error");
          }
        };
        video.addEventListener("playing", onPlaying, { once: true });
        video.addEventListener("error", onMediaError, { once: true });
        cleanupMedia = () => {
          video.removeEventListener("playing", onPlaying);
          video.removeEventListener("error", onMediaError);
        };
        video.setAttribute("src", masterUrl);
        void video.play().catch(() => {});
      }
      // Unsupported browsers render the derived `unsupported` error state.
    } catch (err) {
      console.error("[relay] multiview attach failed", err);
      // Deferred so effect-body failures surface as an async state update
      // rather than a cascading synchronous render.
      queueMicrotask(() => {
        if (cancelled) return;
        setErrorMsg(err instanceof Error ? err.message : "Failed to start the relay player.");
        setState("error");
      });
    }

    return () => {
      cancelled = true;
      cleanupMedia?.();
      hlsRef.current?.destroy();
      hlsRef.current = null;
      video.removeAttribute("src");
      try {
        video.load();
      } catch {
        /* ignore */
      }
    };
  }, [streamId, reloadNonce, videoEl]);

  const togglePlay = useCallback(() => {
    const v = videoEl;
    if (!v) return;
    if (v.paused) {
      void v.play().catch(() => {});
      setPaused(false);
    } else {
      v.pause();
      setPaused(true);
    }
  }, [videoEl]);

  const takeAudio = useCallback(() => onTakeAudio(event.id), [onTakeAudio, event.id]);

  return (
    <div className={`group relative overflow-hidden rounded-xl border border-border/70 bg-black ${TILE_SIZE}`}>
      <video
        ref={setVideoEl}
        autoPlay
        playsInline
        muted={muted}
        className="h-full w-full bg-black object-contain"
        aria-label={`Live player for ${event.title}`}
      />

      {/* Top info bar (fades with the controls when the mouse is away) */}
      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-center gap-2 bg-gradient-to-b from-black/80 to-transparent px-3 pb-6 pt-2 opacity-0 transition-opacity duration-200 group-hover:opacity-100 [@media(pointer:coarse)]:opacity-100">
        <span className="truncate text-xs font-semibold text-zinc-100">{event.title}</span>
        {event.status === "live" && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded border border-rose-500/40 bg-rose-500/20 px-1.5 py-0.5 text-[10px] font-bold text-rose-300">
            <span className="live-dot h-1.5 w-1.5 rounded-full bg-rose-500" aria-hidden="true" />
            LIVE
          </span>
        )}
        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          {event.streams.length > 1 && (
            <span className="rounded bg-black/50 px-1.5 py-0.5 text-[10px] text-zinc-300">
              {event.streams[0].name ?? "Server 1"}
            </span>
          )}
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
              isAudioSource
                ? "bg-emerald-500/25 text-emerald-300"
                : "bg-black/50 text-zinc-400"
            }`}
            aria-hidden="true"
          >
            {isAudioSource ? "audio" : "muted"}
          </span>
        </span>
      </div>

      {/* Loading / error overlays */}
      {state === "loading" && !unsupported && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/60">
          <Loader2 className="h-6 w-6 animate-spin text-emerald-400" aria-hidden="true" />
          <p className="text-[11px] text-muted-foreground">Connecting…</p>
        </div>
      )}
      {(state === "error" || unsupported) && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 bg-black/75 px-4 text-center">
          <AlertTriangle className="h-6 w-6 text-rose-400" aria-hidden="true" />
          <p className="text-[11px] leading-relaxed text-zinc-200">
            {unsupported ? "HLS playback is not supported in this browser." : errorMsg}
          </p>
          {!unsupported && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1 text-[11px]"
              onClick={() => setReloadNonce((n) => n + 1)}
            >
              <RotateCcw className="h-3 w-3" aria-hidden="true" />
              Retry
            </Button>
          )}
        </div>
      )}

      {/* Controls (appear on hover / focus, always visible on touch) */}
      <div className="absolute inset-x-0 bottom-0 flex items-center gap-1.5 bg-gradient-to-t from-black/80 to-transparent px-2.5 pb-2 pt-6 opacity-0 transition-opacity duration-200 focus-within:opacity-100 group-hover:opacity-100 [@media(pointer:coarse)]:opacity-100">
        <button
          type="button"
          onClick={togglePlay}
          aria-label={paused ? `Play ${event.title}` : `Pause ${event.title}`}
          className="flex h-8 w-8 items-center justify-center rounded-lg bg-black/60 text-zinc-100 transition-colors hover:bg-black/80 hover:text-emerald-300"
        >
          {paused ? <Play className="h-4 w-4" aria-hidden="true" /> : <Pause className="h-4 w-4" aria-hidden="true" />}
        </button>
        <button
          type="button"
          onClick={takeAudio}
          aria-label={isAudioSource ? `Audio is active for ${event.title}` : `Listen to ${event.title}`}
          aria-pressed={isAudioSource}
          className={`flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${
            isAudioSource
              ? "bg-emerald-500/25 text-emerald-300"
              : "bg-black/60 text-zinc-100 hover:bg-black/80 hover:text-emerald-300"
          }`}
        >
          {isAudioSource ? (
            <Volume2 className="h-4 w-4" aria-hidden="true" />
          ) : (
            <VolumeX className="h-4 w-4" aria-hidden="true" />
          )}
        </button>
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => onRemove(event.id)}
          aria-label={`Remove ${event.title} from multi-view`}
          className="flex h-8 w-8 items-center justify-center rounded-lg bg-black/60 text-zinc-100 transition-colors hover:bg-rose-500/30 hover:text-rose-300"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}

/* --------------------------- empty slot placeholder ----------------------- */

function EmptySlot({ onDismiss }: { onDismiss?: () => void }) {
  return (
    <div className={`relative flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border/60 bg-card/20 text-center ${TILE_SIZE}`}>
      <Plus className="h-6 w-6 text-muted-foreground/50" aria-hidden="true" />
      <p className="px-6 text-[11px] leading-relaxed text-muted-foreground/70">
        Empty slot — add live events from the schedule with the{" "}
        <span className="font-semibold text-muted-foreground">+ Multi</span> button.
      </p>
      {onDismiss && (
        <button
          type="button"
          onClick={onDismiss}
          className="absolute right-2 top-2 flex h-6 w-6 items-center justify-center rounded-md bg-black/40 text-zinc-400 transition-colors hover:text-foreground"
          aria-label="Close multi-view"
        >
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

/* ------------------------------- overlay ---------------------------------- */

interface MultiViewOverlayProps {
  events: SBEvent[];
  layout: MultiViewLayout;
  onLayoutChange: (layout: MultiViewLayout) => void;
  onClose: () => void;
  onRemove: (eventId: string) => void;
  onClear: () => void;
}

export function MultiViewOverlay({
  events,
  layout,
  onLayoutChange,
  onClose,
  onRemove,
  onClear,
}: MultiViewOverlayProps) {
  const [audioEventId, setAudioEventId] = useState<string | null>(events[0]?.id ?? null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [chromeVisible, setChromeVisible] = useState(true);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const chromeIdleTimer = useRef<number | null>(null);

  // Auto-hide the overlay chrome (header bar) while the mouse rests over the
  // streams — like a native video player. Touch devices never trigger it, so
  // controls stay visible there.
  const bumpChrome = useCallback(() => {
    setChromeVisible(true);
    if (chromeIdleTimer.current !== null) window.clearTimeout(chromeIdleTimer.current);
    chromeIdleTimer.current = window.setTimeout(() => setChromeVisible(false), 2500);
  }, []);

  useEffect(
    () => () => {
      if (chromeIdleTimer.current !== null) window.clearTimeout(chromeIdleTimer.current);
    },
    [],
  );

  // Derived: fall back to the first tile when the stored audio source is no
  // longer part of the selection (removed, finished, dropped by a refresh).
  const activeAudioId =
    audioEventId && events.some((e) => e.id === audioEventId)
      ? audioEventId
      : events[0]?.id ?? null;

  // Escape to close + body scroll lock while the overlay is up.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  useEffect(() => {
    const onFsChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  const toggleFullscreen = useCallback(() => {
    try {
      if (document.fullscreenElement) {
        void document.exitFullscreen();
      } else {
        void shellRef.current?.requestFullscreen().catch(() => {});
      }
    } catch {
      /* fullscreen unavailable */
    }
  }, []);

  const takeAudio = useCallback((eventId: string) => setAudioEventId(eventId), []);

  const capacity = LAYOUT_CAPACITY[layout];
  const slots = Math.max(events.length, Math.min(events.length + 1, capacity));
  const gridItems = events.length + Math.max(0, slots - events.length);
  const lgRows = Math.max(1, Math.ceil(gridItems / LG_COLS[layout]));

  return (
    <div
      ref={shellRef}
      role="dialog"
      aria-modal="true"
      aria-label="Multi-view player"
      onMouseMove={bumpChrome}
      className="fixed inset-0 z-50 flex flex-col bg-zinc-950/98 backdrop-blur-sm"
    >
      {/* Header (fades out while the mouse rests over the streams). Revealed
          again by mouse movement, or by keyboard focus (:focus-visible — plain
          mouse-click focus must not pin the header open). */}
      <header
        className={`flex flex-wrap items-center gap-2 border-b border-border/60 px-4 py-2.5 transition-all duration-300 has-[:focus-visible]:pointer-events-auto has-[:focus-visible]:opacity-100 ${
          chromeVisible ? "opacity-100" : "pointer-events-none -translate-y-1 opacity-0"
        }`}
      >
        <h2 className="mr-2 text-sm font-semibold">Multi-view</h2>

        <div className="flex items-center gap-1.5" role="group" aria-label="Layout style">
          {LAYOUT_META.map((l) => (
            <button
              key={l.key}
              type="button"
              onClick={() => onLayoutChange(l.key)}
              aria-pressed={layout === l.key}
              title={`${l.label} — ${l.hint}`}
              className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${
                layout === l.key
                  ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-300"
                  : "border-border/70 text-muted-foreground hover:border-emerald-500/30 hover:text-foreground"
              }`}
            >
              {l.icon}
              <span className="hidden sm:inline">{l.hint}</span>
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-2">
          <span className="hidden items-center gap-1.5 text-[11px] text-muted-foreground md:flex">
            Click{" "}
            <Volume2 className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
            on a tile to switch audio
          </span>
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5"
            onClick={toggleFullscreen}
            aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
          >
            {isFullscreen ? (
              <Minimize className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <Maximize className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            <span className="hidden sm:inline">Fullscreen</span>
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5"
            onClick={onClear}
            disabled={events.length === 0}
          >
            Clear all
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8 gap-1.5"
            onClick={onClose}
            aria-label="Close multi-view"
          >
            <X className="h-3.5 w-3.5" aria-hidden="true" />
            Close
          </Button>
        </div>
      </header>

      {/* Grid: desktop fills the viewport height (2 stacked panes visible),
          mobile keeps the scrollable aspect-video column */}
      <div className="min-h-0 flex-1 overflow-y-auto p-3 sm:p-4 lg:overflow-hidden">
        {events.length === 0 ? (
          <div className="mx-auto mt-10 max-w-md text-center">
            <p className="text-sm text-muted-foreground">
              No events selected. Close this view and add events from the schedule with the{" "}
              <span className="font-semibold text-foreground">+ Multi</span> button.
            </p>
          </div>
        ) : (
          <div
            className={`mx-auto max-w-[1600px] lg:h-full lg:grid-rows-[var(--mv-rows)] ${LAYOUT_GRID[layout]}`}
            style={{ "--mv-rows": `repeat(${lgRows}, minmax(0, 1fr))` } as CSSProperties}
          >
            {events.map((e) => (
              <MultiViewTile
                key={e.id}
                event={e}
                muted={activeAudioId !== e.id}
                isAudioSource={activeAudioId === e.id}
                onTakeAudio={takeAudio}
                onRemove={onRemove}
              />
            ))}
            {Array.from({ length: Math.max(0, slots - events.length) }, (_, i) => (
              <EmptySlot key={`slot-${i}`} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* --------------------------------- tray ----------------------------------- */

interface MultiViewTrayProps {
  events: SBEvent[];
  onOpen: () => void;
  onRemove: (eventId: string) => void;
  onClear: () => void;
}

/** Floating selection tray shown on the schedule page while picking events. */
export function MultiViewTray({ events, onOpen, onRemove, onClear }: MultiViewTrayProps) {
  if (events.length === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-40 flex justify-center px-4">
      <div className="pointer-events-auto flex max-w-full items-center gap-2 rounded-2xl border border-emerald-500/30 bg-zinc-900/95 px-3 py-2.5 shadow-[0_8px_40px_-12px_rgba(16,185,129,0.4)] backdrop-blur-md">
        <span className="flex shrink-0 items-center gap-1.5 text-xs font-semibold text-emerald-300">
          <Grid2x2 className="h-4 w-4" aria-hidden="true" />
          Multi-view
          <span className="rounded-md bg-emerald-500/15 px-1.5 py-0.5 text-[11px] tabular-nums">
            {events.length}/{MULTIVIEW_MAX}
          </span>
        </span>

        <div className="flex max-w-[46vw] items-center gap-1.5 overflow-x-auto sm:max-w-[36vw]" role="list" aria-label="Selected events">
          {events.map((e) => (
            <span
              key={e.id}
              role="listitem"
              className="flex shrink-0 items-center gap-1.5 rounded-lg border border-border/70 bg-card/80 py-1 pl-2.5 pr-1 text-[11px] text-zinc-200"
            >
              <span className="max-w-[140px] truncate">{e.title}</span>
              <button
                type="button"
                onClick={() => onRemove(e.id)}
                aria-label={`Remove ${e.title} from multi-view`}
                className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-zinc-400 transition-colors hover:bg-rose-500/20 hover:text-rose-300"
              >
                <X className="h-3 w-3" aria-hidden="true" />
              </button>
            </span>
          ))}
        </div>

        <Button size="sm" className="h-8 shrink-0 gap-1.5 bg-emerald-500 text-emerald-950 hover:bg-emerald-400" onClick={onOpen}>
          <Play className="h-3.5 w-3.5" aria-hidden="true" />
          Watch {events.length > 1 ? `${events.length}` : "together"}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-8 shrink-0 px-2 text-muted-foreground hover:text-foreground"
          onClick={onClear}
          aria-label="Clear multi-view selection"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>
    </div>
  );
}
