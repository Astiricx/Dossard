import type { PlannedMetrics } from '../../domain/index.ts';
import type { PlannedWarning } from '../../engine/index.ts';
import { WARNING_LABELS } from './labels.ts';
import { formatDistance, formatDuration } from './model/format.ts';

interface Props {
  metrics: PlannedMetrics;
  warnings: readonly PlannedWarning[];
  onOpenProfile?: () => void;
}

/** Totaux prévus de la séance, recalculés par le moteur à chaque modification. */
export function SummaryBar({ metrics, warnings, onOpenProfile }: Props) {
  const stats = [
    { label: 'Durée', value: metrics.durationS === null ? '—' : formatDuration(metrics.durationS) },
    { label: 'Distance', value: metrics.distanceM === null ? '—' : formatDistance(metrics.distanceM) },
    { label: 'Charge prévue', accent: true, value: metrics.load === null ? '—' : String(Math.round(metrics.load)), hint: '100 = 1 h au seuil' },
  ];
  return (
    <div>
      <dl className="grid grid-cols-3 gap-3">
        {stats.map((stat) => (
          <div key={stat.label}>
            <dt className="text-xs text-mute">{stat.label}</dt>
            <dd className={`text-3xl font-semibold tabular-nums tracking-tight ${stat.accent ? 'text-racing' : 'text-ink'}`}>{stat.value}</dd>
            {stat.hint ? <p className="text-[11px] text-mute">{stat.hint}</p> : null}
          </div>
        ))}
      </dl>
      {warnings.length > 0 ? (
        <ul className="mt-3 space-y-1 text-xs text-mute">
          {warnings.map((warning) => (
            <li key={warning}>
              {WARNING_LABELS[warning]}{' '}
              {warning === 'unresolved_target' && onOpenProfile ? (
                <button type="button" className="font-medium text-racing underline" onClick={onOpenProfile}>Compléter mon profil</button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
