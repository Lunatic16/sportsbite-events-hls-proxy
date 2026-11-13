"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Hls, { type ErrorData, type Level } from "hls.js";
import { AlertTriangle, Check, Copy, ExternalLink, Gauge, Loader2, RotateCcw, Server } from "lucide-react";
import type { SBEvent, SBStream } from "@/lib/sportsbite";
import { copyTextToClipboard } from "@/lib/clipboard";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { formatKickoff } from "./utils";

type PlayState = "loading" | "playing" | "error";

interface LevelInfo {
  index: number;
  height: number;
  bitrate: number;
}

// hls.js is imported statically (SSR-safe in v1.x) — dynamic import proved
// unreliable under the dev bundler, and the engine only runs after mount
// guards (`Hls.isSupported()`) anyway.

export function describeHlsError(data: ErrorData): string {
  const code = data.response?.code;
  if (code === 425) {
    return "The pre-match window is not open yet — streams unlock about 30 minutes before kickoff. Try again closer to match time.";
  }
  if (code === 404) {
    return "No live feed is published on this server right now. Try another server, or check back at kickoff.";
  }
  if (code === 429) {
    return "Rate limited by the upstream provider — wait a few seconds and retry.";
  }
  if (data.details?.includes("manifestLoadError")) {
    return "Could not load the stream manifest. The match may have ended or the server is offline.";
  }
  return `Playback error${data.details ? ` (${data.details.replace(/.*Error$/i, "issue")})` : ""}${code ? ` · HTTP ${code}` : ""}.`;
}

interface PlayerDialogProps {
  event: SBEvent | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function PlayerDialog({ event, open, onOpenChange }: PlayerDialogProps) {
  const [streamId, setStreamId] = useState<string | null>(null);
  const [state, setState] = useState<PlayState>("loading");
  const [errorMsg, setErrorMsg] = useState<string>("");
  const [levels, setLevels] = useState<LevelInfo[]>([]);
  const [selectedLevel, setSelectedLevel] = useState<number>(-1);
  const [liveLevel, setLiveLevel] = useState<number>(-1);
  const [copied, setCopied] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);
  // Callback-ref state: Radix mounts the dialog portal in a commit after the
  // open prop flips, so a plain useRef is still null on the first attach pass.
  const [videoEl, setVideoEl] = useState<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);

  const streams: SBStream[] = event?.streams ?? [];
  const activeStream = streams.find((s) => s.id === streamId) ?? streams[0] ?? null;

  // Reset player state whenever a new event opens.
  useEffect(() => {
    if (open && event) {
      setStreamId(event.streams[0]?.id ?? null);
      setLevels([]);
      setSelectedLevel(-1);
      setLiveLevel(-1);
      setCopied(false);
    }
  }, [open, event]);

  // Attach / detach the HLS engine.
  useEffect(() => {
    if (!open || !activeStream || !videoEl) return;
    const video = videoEl;

    let cancelled = false;
    setState("loading");
    setErrorMsg("");
    setLevels([]);
    setSelectedLevel(-1);

    const masterUrl = `/api/hls/play/${activeStream.id}`;

    try {
      if (Hls.isSupported()) {
        const hls = new Hls({
          // Main-thread demuxing: the transmux WebWorker is created from a
          // Blob URL, which is blocked in some sandboxed browsers and stalls
          // appends. Demux of a single 540p feed is cheap on the main thread.
          enableWorker: false,
          lowLatencyMode: false,
          backBufferLength: 30,
          maxBufferLength: 24,
          maxMaxBufferLength: 120,
          manifestLoadingTimeOut: 15_000,
          manifestLoadingMaxRetry: 3,
          manifestLoadingRetryDelay: 700,
          manifestLoadingMaxRetryTimeout: 5_000,
          fragLoadingMaxRetry: 6,
          fragLoadingRetryDelay: 900,
        });
        hlsRef.current = hls;

        hls.on(Hls.Events.MANIFEST_PARSED, (_e, data) => {
          if (cancelled) return;
          const mapped: LevelInfo[] = data.levels
            .map((l: Level, i: number) => ({ index: i, height: l.height ?? 0, bitrate: l.bitrate }))
            .filter((l) => l.height > 0)
            .sort((a, b) => b.height - a.height);
          setLevels(mapped);
          setState("playing");
          void video.play().catch(() => {});
        });
        hls.on(Hls.Events.LEVEL_SWITCHED, (_e, data) => {
          if (!cancelled) setLiveLevel(data.level);
        });
        hls.on(Hls.Events.ERROR, (_e, data) => {
          if (cancelled || !data.fatal) return;
          console.error("[relay] fatal hls error", data.details, data.response?.code);
          setErrorMsg(describeHlsError(data));
          setState("error");
        });

        hls.loadSource(masterUrl);
        hls.attachMedia(video);
      } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
        // Safari / iOS native HLS.
        video.setAttribute("src", masterUrl);
        setState("playing");
        void video.play().catch(() => {});
      } else {
        setErrorMsg("HLS playback is not supported in this browser.");
        setState("error");
      }
    } catch (err) {
      console.error("[relay] attach failed", err);
      setErrorMsg(err instanceof Error ? err.message : "Failed to start the relay player.");
      setState("error");
    }

    return () => {
      cancelled = true;
      hlsRef.current?.destroy();
      hlsRef.current = null;
      video.removeAttribute("src");
      try {
        video.load();
      } catch {
        /* ignore */
      }
    };
  }, [open, activeStream?.id, reloadNonce, videoEl]);

  const pickLevel = useCallback((index: number) => {
    const hls = hlsRef.current;
    if (hls) hls.currentLevel = index;
    setSelectedLevel(index);
  }, []);

  const pickStream = useCallback((id: string) => {
    setStreamId(id);
    setReloadNonce((n) => n + 1);
  }, []);

  const copyProxyUrl = useCallback(async () => {
    if (!activeStream) return;
    const url = `${window.location.origin}/api/hls/play/${activeStream.id}`;
    const copied = await copyTextToClipboard(url);
    if (copied) {
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } else {
      // Clipboard blocked (plain HTTP or hardened browser) — open the URL so
      // it can be copied from the address bar.
      window.open(url, "_blank", "noopener,noreferrer");
    }
  }, [activeStream]);

  const activeHeight =
    selectedLevel === -1
      ? levels.find((l) => l.index === liveLevel)?.height
      : levels.find((l) => l.index === selectedLevel)?.height;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(1100px,96vw)] max-w-none gap-0 overflow-hidden rounded-2xl border-border/80 bg-card p-0">
        <DialogHeader className="flex flex-row items-center gap-3 space-y-0 border-b border-border/60 px-5 py-3.5 text-left">
          <div className="min-w-0 flex-1">
            <DialogTitle className="truncate text-sm font-semibold">
              {event?.title ?? "Stream"}
            </DialogTitle>
            <DialogDescription className="mt-0.5 flex items-center gap-2 truncate text-xs text-muted-foreground">
              {event?.tournament.name}
              {event && <span aria-hidden="true">·</span>}
              {event && <span>{formatKickoff(event.timestamp, Date.now())}</span>}
              {event?.status === "live" && (
                <span className="inline-flex items-center gap-1.5 rounded border border-rose-500/30 bg-rose-500/10 px-1.5 py-0.5 text-[10px] font-bold text-rose-400">
                  <span className="live-dot h-1.5 w-1.5 rounded-full bg-rose-500" aria-hidden="true" />
                  LIVE
                </span>
              )}
            </DialogDescription>
          </div>
        </DialogHeader>

        {/* Video area */}
        <div className="relative aspect-video w-full bg-black">
          <video
            ref={setVideoEl}
            controls
            autoPlay
            playsInline
            className="h-full w-full bg-black"
            aria-label={event ? `Live player for ${event.title}` : "Live player"}
          />
          {state === "loading" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/70">
              <Loader2 className="h-8 w-8 animate-spin text-emerald-400" aria-hidden="true" />
              <p className="text-xs text-muted-foreground">Connecting to relay…</p>
            </div>
          )}
          {state === "error" && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-black/80 px-6 text-center">
              <AlertTriangle className="h-8 w-8 text-rose-400" aria-hidden="true" />
              <p className="max-w-md text-sm text-zinc-200">{errorMsg}</p>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setReloadNonce((n) => n + 1)}
                className="gap-1.5"
              >
                <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                Retry
              </Button>
            </div>
          )}
        </div>

        {/* Control bar */}
        <div className="flex flex-col gap-3 border-t border-border/60 px-5 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
              <Server className="h-3.5 w-3.5" aria-hidden="true" />
              Server
            </span>
            <div className="flex flex-wrap gap-1.5">
              {streams.map((s, i) => (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => pickStream(s.id)}
                  aria-pressed={activeStream?.id === s.id}
                  className={`rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${
                    activeStream?.id === s.id
                      ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-300"
                      : "border-border/70 text-muted-foreground hover:border-emerald-500/30 hover:text-foreground"
                  }`}
                >
                  {s.name ?? `Server ${i + 1}`}
                  <span className="ml-1.5 text-[10px] opacity-70">
                    {[s.quality, s.language].filter(Boolean).join(" · ")}
                  </span>
                </button>
              ))}
            </div>

            {levels.length > 1 && (
              <div className="flex flex-wrap items-center gap-1.5 sm:ml-4">
                <span className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  <Gauge className="h-3.5 w-3.5" aria-hidden="true" />
                  Quality
                </span>
                <button
                  type="button"
                  onClick={() => pickLevel(-1)}
                  aria-pressed={selectedLevel === -1}
                  className={`rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${
                    selectedLevel === -1
                      ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-300"
                      : "border-border/70 text-muted-foreground hover:border-emerald-500/30 hover:text-foreground"
                  }`}
                >
                  Auto{selectedLevel === -1 && activeHeight ? ` · ${activeHeight}p` : ""}
                </button>
                {levels.map((l) => (
                  <button
                    key={l.index}
                    type="button"
                    onClick={() => pickLevel(l.index)}
                    aria-pressed={selectedLevel === l.index}
                    className={`rounded-lg border px-2.5 py-1.5 text-xs transition-colors ${
                      selectedLevel === l.index
                        ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-300"
                        : "border-border/70 text-muted-foreground hover:border-emerald-500/30 hover:text-foreground"
                    }`}
                  >
                    {l.height}p
                    <span className="ml-1 text-[10px] opacity-70">
                      {Math.round(l.bitrate / 1000)}k
                    </span>
                  </button>
                ))}
              </div>
            )}

            <div className="ml-auto flex items-center gap-2">
              <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={copyProxyUrl}>
                {copied ? (
                  <Check className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
                ) : (
                  <Copy className="h-3.5 w-3.5" aria-hidden="true" />
                )}
                {copied ? "Copied" : "Copy relay URL"}
              </Button>
              {event && (
                <a
                  href={event.watch_url}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border/70 px-2.5 text-xs text-muted-foreground transition-colors hover:border-emerald-500/40 hover:text-emerald-400"
                >
                  Source
                  <ExternalLink className="h-3 w-3" aria-hidden="true" />
                </a>
              )}
            </div>
          </div>

          <p className="text-[10px] leading-relaxed text-muted-foreground/80">
            Relay path: <code className="rounded bg-muted/60 px-1 py-0.5">/api/hls/play/{activeStream?.id}</code>{" "}
            → rewritten master manifest → proxied segments from signed CDN edge.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
