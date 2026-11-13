"use client";

import { ExternalLink, RefreshCw, RadioTower, Tv } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { copyTextToClipboard } from "@/lib/clipboard";

interface HeaderBarProps {
  liveCount: number;
  loading: boolean;
  onRefresh: () => void;
}

export function HeaderBar({ liveCount, loading, onRefresh }: HeaderBarProps) {
  const { toast } = useToast();

  const copyPlaylistUrl = async () => {
    const url = `${window.location.origin}/playlist.m3u8`;
    // Works over HTTPS and falls back to execCommand on plain-HTTP origins,
    // where the async Clipboard API does not exist.
    const copied = await copyTextToClipboard(url);
    if (copied) {
      toast({
        title: "IPTV playlist URL copied",
        description: url,
      });
    } else {
      // Last resort: open the playlist so the URL can be copied from the
      // address bar (e.g. hardened browsers that block programmatic copy).
      window.open(url, "_blank", "noopener,noreferrer");
      toast({
        title: "Clipboard unavailable — playlist opened instead",
        description: url,
      });
    }
  };
  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-background/75 backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-7xl items-center gap-3 px-4 sm:px-6">
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-emerald-500/30 bg-emerald-500/15 text-emerald-400">
          <RadioTower className="h-4 w-4" aria-hidden="true" />
        </div>
        <div className="min-w-0">
          <h1 className="text-sm font-semibold leading-tight tracking-tight">SportsRelay</h1>
          <p className="truncate text-[11px] leading-tight text-muted-foreground">
            HLS video proxy · sportsbite.org API
          </p>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {liveCount > 0 && (
            <span
              className="inline-flex items-center gap-1.5 rounded-full border border-rose-500/30 bg-rose-500/10 px-2.5 py-1 text-[11px] font-semibold text-rose-400"
              aria-label={`${liveCount} live events`}
            >
              <span className="live-dot h-1.5 w-1.5 rounded-full bg-rose-500" aria-hidden="true" />
              {liveCount} live
            </span>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => void copyPlaylistUrl()}
            aria-label="Copy the dynamic IPTV playlist URL"
          >
            <Tv className="h-3.5 w-3.5" aria-hidden="true" />
            <span className="hidden sm:inline">IPTV playlist</span>
          </Button>
          <Button variant="outline" size="sm" onClick={onRefresh} disabled={loading}>
            <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} aria-hidden="true" />
            <span className="hidden sm:inline">Refresh</span>
          </Button>
          <a
            href="https://sportsbite.org/api"
            target="_blank"
            rel="noreferrer noopener"
            className="hidden items-center gap-1 rounded-md border border-border/70 px-2.5 py-1.5 text-xs text-muted-foreground transition-colors hover:border-emerald-500/40 hover:text-emerald-400 sm:inline-flex"
          >
            API docs
            <ExternalLink className="h-3 w-3" aria-hidden="true" />
          </a>
        </div>
      </div>
    </header>
  );
}
