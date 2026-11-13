import { NextRequest } from "next/server";
import { ScheduleError } from "@/lib/sportsbite";
import {
  buildM3U,
  collectPlaylistEvents,
  parsePlaylistQuery,
  resolveBaseUrl,
} from "@/lib/iptv-playlist";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /playlist.m3u8
 *
 * Dynamic IPTV playlist. Every schedulable event becomes a channel whose URL
 * is this server's own /api/hls/play/{streamId} endpoint — point TiviMate,
 * IPTV Smarters, VLC, Kodi, Jellyfin … at this single URL.
 *
 * Query parameters:
 *   sport    — filter by sport slug (e.g. football)
 *   date     — filter by date, YYYY-MM-DD
 *   status   — all (default) | live | upcoming
 *   limit    — max events included, 1–1000 (default 300)
 *   servers  — first (default, one channel per event) | all (one per stream)
 *
 * Errors still return M3U-compatible text (an `# ERROR` comment) so players
 * show a readable message instead of a parse failure, with the proper HTTP
 * status code.
 */
export async function GET(request: NextRequest) {
  const query = parsePlaylistQuery(request);

  try {
    const { events } = await collectPlaylistEvents(query);
    const baseUrl = resolveBaseUrl(request);
    const body = buildM3U(events, {
      baseUrl,
      servers: query.servers,
      maxEvents: query.maxEvents,
    });

    return new Response(body, {
      status: 200,
      headers: {
        "Content-Type": "audio/x-mpegurl; charset=utf-8",
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
        "Content-Disposition": 'inline; filename="sportsrelay.m3u8"',
      },
    });
  } catch (err) {
    const status = err instanceof ScheduleError ? err.status : 502;
    const message =
      err instanceof Error ? err.message.replace(/[\r\n]+/g, " ") : "Playlist generation failed";

    return new Response(`#EXTM3U\r\n# ERROR: ${message}\r\n`, {
      status,
      headers: {
        "Content-Type": "audio/x-mpegurl; charset=utf-8",
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
      },
    });
  }
}
