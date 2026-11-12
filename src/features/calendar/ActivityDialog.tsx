// ActivityDialog.tsx — la fiche d'une activité réalisée : ses mesures, sa charge et la façon dont
// elle a été calculée, son analyse (courbes, zones, ressenti), et son rapprochement avec une séance prévue.
import { useEffect, useRef } from 'react';
import type { ActivityId, Workout, WorkoutId } from '../../domain/index.ts';
import { useApp } from '../../app/store.ts';
import { ActivityAnalysis } from '../analysis/ActivityAnalysis.tsx';
import { METHOD_TEXT, QUALITY_TEXT, WARNING_TEXT } from '../import/labels.ts';
import { formatDistance, formatDuration, formatPace, paceUnit } from '../workout-builder/model/format.ts';
import { CheckIcon, CloseIcon, fieldLabel, ghostButton, iconButton, Select, SportBadge } from '../workout-builder/ui.tsx';
import { longDate } from './model/weeks.ts';

const NONE = '';
const NO_IDS: readonly WorkoutId[] = [];

export function ActivityDialog({ id, onClose }: { id: ActivityId; onClose: () => void }) {
  const activity = useApp((s) => s.calendar.activities[id]);
  const workouts = useApp((s) => s.calendar.workouts);
  const dayIds = useApp((s) => (activity ? s.calendar.workoutIdsByDate[activity.localDate] : undefined) ?? NO_IDS);
  const { linkActivity, removeActivity } = useApp((s) => s.actions);
  const closeButton = useRef<HTMLButtonElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    closeButton.current?.focus();
    const onKey = (event: KeyboardEvent): void => { if (event.key === 'Escape') close.current(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  if (activity === undefined) return null;

  const linked = Object.values<Workout>(workouts).find((w) => w.activityId === id);
  // Rapprochement manuel : toute séance du même jour, libre ou déjà reliée à cette activité.
  const choices = dayIds.map((workoutId) => workouts[workoutId]).filter((w): w is Workout => w !== undefined && (w.activityId === null || w.activityId === id));
  const { summary, load } = activity;
  const local = new Date(Date.parse(activity.startTime) + activity.utcOffsetMin * 60_000);
  const clock = `${String(local.getUTCHours()).padStart(2, '0')}:${String(local.getUTCMinutes()).padStart(2, '0')}`;
  const power = load?.metrics.normalizedPowerW ?? summary.normalizedPowerW;
  const metrics: readonly (readonly [string, string | null])[] = [
    ['Durée', formatDuration(summary.movingS)],
    ['Distance', summary.distanceM !== undefined ? formatDistance(summary.distanceM) : null],
    [activity.sport === 'bike' ? 'Vitesse moyenne' : 'Allure moyenne', summary.avgSpeedMps === undefined ? null
      : activity.sport === 'bike' ? `${(summary.avgSpeedMps * 3.6).toFixed(1).replace('.', ',')} km/h` : `${formatPace(summary.avgSpeedMps, activity.sport)} ${paceUnit(activity.sport)}`],
    ['FC moyenne', summary.avgHrBpm !== undefined ? `${summary.avgHrBpm} bpm` : null],
    ['Puissance normalisée', power !== undefined ? `${Math.round(power)} W` : null],
    ['Dénivelé positif', summary.elevationGainM !== undefined ? `${summary.elevationGainM} m` : null],
  ];
  const setLink = (value: string): void => {
    if (value === NONE) { if (linked) linkActivity(linked.id, null); return; }
    linkActivity(value as WorkoutId, id, 'manual');
  };

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/70 sm:items-center sm:p-4"
      onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="activite-titre"
        className="carbon-card max-h-[90dvh] w-full overflow-y-auto rounded-t-2xl border border-line p-4 sm:max-w-3xl sm:rounded-2xl">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className="inline-flex items-center gap-1 text-xs font-semibold text-done [&>svg]:size-4"><CheckIcon />Réalisé</p>
            <h2 id="activite-titre" className="truncate text-lg font-semibold text-ink">{activity.title}</h2>
            <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-mute tabular-nums">
              <SportBadge sport={activity.sport} />{longDate(activity.localDate)}, {clock}
              {activity.source.device !== undefined ? <span>{activity.source.device}</span> : null}
            </p>
          </div>
          <button type="button" ref={closeButton} className={iconButton} aria-label="Fermer" onClick={onClose}><CloseIcon /></button>
        </div>

        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 md:grid-cols-6">
          {metrics.map(([label, value]) => value === null ? null : (
            <div key={label}>
              <dt className="text-[11px] text-mute">{label}</dt>
              <dd className="text-lg font-semibold tracking-tight text-ink tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>

        <div className="mt-4 rounded-lg border border-line bg-raised/60 p-3">
          <div className="flex items-baseline gap-3">
            <p className="text-3xl font-semibold tracking-tight text-done tabular-nums">{load !== null ? Math.round(load.value) : '—'}</p>
            <div className="min-w-0 text-xs text-mute">
              <p className="font-medium text-ink">Charge réalisée</p>
              {load !== null
                ? <p>D’après {METHOD_TEXT[load.method]}, estimation {QUALITY_TEXT[load.quality]}.{linked?.planned.load != null ? ` Prévu : ${Math.round(linked.planned.load)}.` : ''}</p>
                : <p>Non calculable pour cette activité.</p>}
            </div>
          </div>
          {load !== null && (load.metrics.trimp !== undefined || load.metrics.intensityFactor !== undefined) ? (
            <p className="mt-2 text-xs text-mute tabular-nums">
              {[load.metrics.intensityFactor !== undefined ? `Intensité ${Math.round(load.metrics.intensityFactor * 100)} % du seuil` : null,
                load.metrics.trimp !== undefined ? `TRIMP ${Math.round(load.metrics.trimp)}` : null,
                load.metrics.hrTss !== undefined ? `charge cardiaque ${Math.round(load.metrics.hrTss)}` : null].filter((part) => part !== null).join(', ')}
            </p>
          ) : null}
          {load !== null && load.warnings.length > 0 ? (
            <ul className="mt-2 list-disc space-y-0.5 pl-4 text-xs text-mute">{load.warnings.map((warning) => <li key={warning}>{WARNING_TEXT[warning]}</li>)}</ul>
          ) : null}
        </div>

        <ActivityAnalysis activity={activity} />

        <div className="mt-4">
          <span className={fieldLabel}>Séance prévue correspondante</span>
          {choices.length === 0 ? <p className="text-sm text-mute">Aucune séance prévue libre ce jour-là.</p> : (
            <Select label="Séance prévue correspondante" value={linked?.id ?? NONE} onChange={setLink}
              options={[{ value: NONE, label: 'Aucune (activité hors plan)' }, ...choices.map((w) => ({ value: w.id as string, label: w.title }))]} />
          )}
          {linked?.matchedBy === 'auto' ? <p className="mt-1 text-xs text-mute">Rapprochée automatiquement : même jour, même sport. Change-la ici si ce n’est pas la bonne.</p> : null}
        </div>

        <div className="mt-5 flex justify-end">
          <button type="button" className={ghostButton} onClick={() => { removeActivity(id); onClose(); }}>Supprimer cette activité</button>
        </div>
      </div>
    </div>
  );
}
