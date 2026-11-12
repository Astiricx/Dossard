// ZoneChart.tsx — temps passé dans chaque zone, en barres horizontales. Chaque ligne se lit aussi
// sans la couleur : numéro et nom de la zone, bornes, durée et pourcentage sont écrits.
import { ZONE_COLORS, ZONE_LABELS } from '../workout-builder/labels.ts';
import { formatDuration } from '../workout-builder/model/format.ts';
import type { ZoneBreakdown, ZoneTime } from './model/zone-time.ts';

interface Props {
  breakdown: ZoneBreakdown;
  /** Bornes d'une zone en clair : « 140–160 bpm », « plus vite que 4:05 /km ». */
  formatRange: (zone: ZoneTime) => string;
}

export function ZoneChart({ breakdown, formatRange }: Props) {
  const longest = Math.max(...breakdown.zones.map((z) => z.share), 0.0001);
  return (
    <ul className="space-y-1.5" aria-label="Temps passé dans chaque zone">
      {breakdown.zones.map((zone) => (
        <li key={zone.zone} className="grid grid-cols-[7.5rem_minmax(0,1fr)_3.25rem_2.75rem] items-center gap-x-3 text-xs">
          <span className="min-w-0">
            <span className="block truncate font-medium text-ink">Z{zone.zone}{zone.zone === 5 ? '+' : ''} {ZONE_LABELS[zone.zone]}</span>
            <span className="block truncate text-[11px] text-mute tabular-nums">{formatRange(zone)}</span>
          </span>
          {/* La barre la plus longue occupe toute la largeur : les autres se comparent à elle. */}
          <span className="h-4 rounded-sm bg-line/60" aria-hidden="true">
            <span className="block h-4 rounded-sm" style={{ width: `${(zone.share / longest) * 100}%`, minWidth: zone.seconds > 0 ? 2 : 0, backgroundColor: ZONE_COLORS[zone.zone] }} />
          </span>
          <span className="text-right font-medium text-ink tabular-nums">{formatDuration(zone.seconds)}</span>
          <span className="text-right text-mute tabular-nums">{Math.round(zone.share * 100)} %</span>
        </li>
      ))}
    </ul>
  );
}
