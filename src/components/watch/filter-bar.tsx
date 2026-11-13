"use client";

import { ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { sportLabel, type StatusFilter } from "./utils";

export interface Filters {
  sport: string | null;
  status: StatusFilter;
  date: string | null;
  search: string;
}

const STATUSES: { key: StatusFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "live", label: "Live" },
  { key: "upcoming", label: "Upcoming" },
];

function utcDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

interface FilterBarProps {
  filters: Filters;
  onChange: (patch: Partial<Filters>) => void;
  sports: { key: string; count: number }[];
}

export function FilterBar({ filters, onChange, sports }: FilterBarProps) {
  const today = utcDate(new Date());
  const tomorrow = utcDate(new Date(Date.now() + 86_400_000));

  return (
    <div className="flex flex-col gap-3">
      {/* Sport chips */}
      <div className="scrollbar-none -mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
        <button
          type="button"
          onClick={() => onChange({ sport: null })}
          className={`shrink-0 rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors ${
            filters.sport === null
              ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-300"
              : "border-border/70 text-muted-foreground hover:border-emerald-500/30 hover:text-foreground"
          }`}
        >
          All sports
        </button>
        {sports.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => onChange({ sport: s.key })}
            className={`shrink-0 rounded-full border px-3.5 py-1.5 text-xs font-medium transition-colors ${
              filters.sport === s.key
                ? "border-emerald-500/50 bg-emerald-500/15 text-emerald-300"
                : "border-border/70 text-muted-foreground hover:border-emerald-500/30 hover:text-foreground"
            }`}
          >
            {sportLabel(s.key)}
            <span className="ml-1.5 text-[10px] opacity-60">{s.count}</span>
          </button>
        ))}
      </div>

      {/* Status + date + search */}
      <div className="flex flex-wrap items-center gap-2">
        <div
          className="flex rounded-lg border border-border/70 p-0.5"
          role="group"
          aria-label="Status filter"
        >
          {STATUSES.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => onChange({ status: s.key })}
              aria-pressed={filters.status === s.key}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                filters.status === s.key
                  ? "bg-emerald-500/15 text-emerald-300"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-1" role="group" aria-label="Date filter">
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            aria-label="Previous day"
            onClick={() => {
              const base = filters.date ? new Date(`${filters.date}T12:00:00Z`) : new Date();
              base.setUTCDate(base.getUTCDate() - 1);
              onChange({ date: utcDate(base) });
            }}
          >
            <ChevronLeft className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
          <input
            type="date"
            aria-label="Filter by UTC date"
            value={filters.date ?? ""}
            onChange={(e) => onChange({ date: e.target.value || null })}
            className="h-8 rounded-md border border-border/70 bg-transparent px-2 text-xs text-foreground [color-scheme:dark]"
          />
          <Button
            variant="outline"
            size="icon"
            className="h-8 w-8"
            aria-label="Next day"
            onClick={() => {
              const base = filters.date ? new Date(`${filters.date}T12:00:00Z`) : new Date();
              base.setUTCDate(base.getUTCDate() + 1);
              onChange({ date: utcDate(base) });
            }}
          >
            <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
          {filters.date && (
            <Button variant="ghost" size="sm" className="h-8" onClick={() => onChange({ date: null })}>
              <X className="h-3 w-3" aria-hidden="true" />
              Clear
            </Button>
          )}
          {!filters.date && (
            <div className="flex gap-1">
              <button
                type="button"
                onClick={() => onChange({ date: today })}
                className="rounded-md border border-border/70 px-2.5 py-1.5 text-[11px] text-muted-foreground transition-colors hover:border-emerald-500/30 hover:text-foreground"
              >
                Today
              </button>
              <button
                type="button"
                onClick={() => onChange({ date: tomorrow })}
                className="rounded-md border border-border/70 px-2.5 py-1.5 text-[11px] text-muted-foreground transition-colors hover:border-emerald-500/30 hover:text-foreground"
              >
                Tomorrow
              </button>
            </div>
          )}
        </div>

        <div className="relative ml-auto min-w-[180px] flex-1 sm:max-w-xs">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden="true"
          />
          <Input
            value={filters.search}
            onChange={(e) => onChange({ search: e.target.value })}
            placeholder="Search teams or tournaments"
            className="h-8 border-border/70 pl-8 text-xs"
            aria-label="Search events"
          />
        </div>
      </div>
    </div>
  );
}
