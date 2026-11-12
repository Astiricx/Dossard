// SeasonView.tsx — vue macro : la frise de la saison, ses phases de préparation et ses courses.
import { useMemo, useState } from 'react';
import { addDays, diffDays, type ISODate, type ISODateTime, type RaceEvent } from '../../domain/index.ts';
import { useApp } from '../../app/store.ts';
import { LOCAL_ATHLETE_ID } from '../athlete/thresholds.ts';
import { card, fieldLabel, FlagIcon, ghostButton, iconButton, input, primaryButton, Select, TrashIcon } from '../workout-builder/ui.tsx';
import {
  buildTimeline, coverSpan, createSeasonPlan, macroCycles, makePhase, makeRace, PHASE_CHOICES, PHASE_COLORS, PHASE_LABELS, PHASE_PROBLEM_TEXT,
  phaseProblem, PRIORITY_LABELS, removeRace, seasonPlan, upsertRace, type Phase,
} from './model/season.ts';
import { longDate, shortDate } from './model/weeks.ts';

const now = (): ISODateTime => new Date().toISOString() as ISODateTime;
const percent = (fraction: number): string => `${(fraction * 100).toFixed(3)}%`;
const PRIORITY_STYLE: Record<RaceEvent['priority'], string> = {
  A: 'border-racing bg-racing-deep text-white',
  B: 'border-racing text-ink',
  C: 'border-line-strong text-mute',
};
export function PriorityBadge({ priority }: { priority: RaceEvent['priority'] }) {
  return (
    <span className={`inline-flex h-6 shrink-0 items-center rounded-full border px-2 text-xs font-semibold ${PRIORITY_STYLE[priority]}`}>
      {PRIORITY_LABELS[priority]}
    </span>
  );
}

export function SeasonView({ today, onOpenWeek }: { today: ISODate; onOpenWeek: (date: ISODate) => void }) {
  const athleteId = useApp((s) => s.athlete?.id) ?? LOCAL_ATHLETE_ID;
  const plans = useApp((s) => s.plans);
  const cycles = useApp((s) => s.cycles);
  const { savePlan, saveCycles, removeCycle } = useApp((s) => s.actions);
  const plan = seasonPlan(plans);
  const macros = useMemo(() => macroCycles(cycles), [cycles]);
  const races = plan?.events ?? [];
  const timeline = useMemo(() => buildTimeline(macros, races, today), [macros, races, today]);

  const [phase, setPhase] = useState<Phase>('base');
  // Début proposé : le lendemain de la dernière phase, pour enchaîner sans chevauchement.
  const [start, setStart] = useState<ISODate>(() => { const last = macros[macros.length - 1]; return last !== undefined && last.endDate >= today ? addDays(last.endDate, 1) : today; });
  const [end, setEnd] = useState<ISODate>(() => addDays(start, 27));
  const [raceName, setRaceName] = useState('');
  const [raceDate, setRaceDate] = useState<ISODate>(addDays(today, 56));
  const [priority, setPriority] = useState<RaceEvent['priority']>('A');
  const problem = phaseProblem(macros, { startDate: start, endDate: end });
  const basePlan = () => plan ?? createSeasonPlan(athleteId, today, now());

  const addPhase = (): void => {
    if (problem !== null) return;
    const covered = coverSpan(basePlan(), start, end, now());
    if (covered !== plan) savePlan(covered);
    saveCycles([makePhase(covered.id, phase, start, end)]);
    // La phase suivante commence par défaut le lendemain, pour enchaîner les saisies.
    setStart(addDays(end, 1));
    setEnd(addDays(end, 28));
  };
  const addRace = (): void => {
    if (raceName.trim() === '') return;
    savePlan(upsertRace(basePlan(), makeRace(raceName, raceDate, priority), now()));
    setRaceName('');
  };
  const dateInput = (value: ISODate, onChange: (date: ISODate) => void) => (
    <input className={input} type="date" value={value}
      onChange={(event) => { if (event.currentTarget.value !== '') onChange(event.currentTarget.value as ISODate); }} />
  );

  return (
    <div className="space-y-4">
      <section className={`${card} p-4`} aria-label="Frise de la saison">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-base font-semibold text-ink">Saison</h2>
          <p className="text-xs text-mute tabular-nums">{longDate(timeline.start)} – {longDate(timeline.end)}</p>
        </div>
        <div className="mt-3 overflow-x-auto">
          <div className="relative min-w-[44rem]">
            <div className="relative h-5 text-[11px] text-mute">
              {timeline.months.map((month) => (
                <span key={month.key} className="absolute top-0 truncate border-l border-line pl-1" style={{ left: percent(month.left), width: percent(month.width) }}>{month.label}</span>
              ))}
            </div>
            <div className="relative mt-1 h-7">
              {timeline.races.map(({ race, left }) => (
                <span key={race.id} title={`${race.name}, ${longDate(race.date)}, ${PRIORITY_LABELS[race.priority]}`}
                  className={`absolute top-0 inline-flex h-6 min-w-6 -translate-x-1/2 items-center justify-center gap-0.5 rounded-md border px-1 text-[11px] font-semibold [&>svg]:size-3 ${PRIORITY_STYLE[race.priority]}`}
                  style={{ left: percent(left) }}>
                  <FlagIcon />{race.priority}
                </span>
              ))}
            </div>
            <div className="relative h-12 rounded-lg border border-line bg-carbon">
              {timeline.months.slice(1).map((month) => <span key={month.key} className="absolute inset-y-0 w-px bg-line" style={{ left: percent(month.left) }} aria-hidden="true" />)}
              {timeline.phases.map(({ cycle, left, width }) => (
                <button key={cycle.id} type="button" onClick={() => onOpenWeek(cycle.startDate)}
                  title={`${PHASE_LABELS[cycle.phase]}, du ${longDate(cycle.startDate)} au ${longDate(cycle.endDate)}. Ouvrir dans la grille.`}
                  className="absolute inset-y-1 flex items-center overflow-hidden rounded-md px-2 text-left text-xs font-semibold text-black transition-[filter] hover:brightness-125 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-ink"
                  style={{ left: `calc(${percent(left)} + 1px)`, width: `calc(${percent(width)} - 2px)`, backgroundColor: PHASE_COLORS[cycle.phase] }}>
                  <span className="truncate">{PHASE_LABELS[cycle.phase]}</span>
                </button>
              ))}
              {timeline.races.map(({ race, left }) => <span key={race.id} className="absolute inset-y-0 w-0.5 bg-racing" style={{ left: percent(left) }} aria-hidden="true" />)}
              {timeline.today !== null ? <span className="absolute -inset-y-1 w-px bg-ink" style={{ left: percent(timeline.today) }} title="Aujourd'hui" /> : null}
            </div>
          </div>
        </div>
        <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-mute">
          {PHASE_CHOICES.map((value) => (
            <li key={value} className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm" style={{ backgroundColor: PHASE_COLORS[value] }} />{PHASE_LABELS[value]}</li>
          ))}
          <li className="flex items-center gap-1.5"><span className="h-3 w-px bg-ink" />Aujourd'hui</li>
        </ul>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className={`${card} space-y-3 p-4`}>
          <h2 className="text-base font-semibold text-ink">Phases de préparation</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <div className="col-span-2 sm:col-span-1"><span className={fieldLabel}>Phase</span>
              <Select label="Phase" value={phase} options={PHASE_CHOICES.map((value) => ({ value, label: PHASE_LABELS[value] }))} onChange={setPhase} /></div>
            <label className="block"><span className={fieldLabel}>Début</span>{dateInput(start, setStart)}</label>
            <label className="block"><span className={fieldLabel}>Fin (incluse)</span>{dateInput(end, setEnd)}</label>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className={ghostButton} disabled={problem !== null} onClick={addPhase}>Ajouter la phase</button>
            <p className="text-xs text-mute" role="status">
              {problem !== null ? PHASE_PROBLEM_TEXT[problem] : `${Math.round((diffDays(start, end) + 1) / 7 * 10) / 10} semaines`.replace('.', ',')}
            </p>
          </div>
          {macros.length === 0 ? <p className="text-sm text-mute">Aucune phase. Découpe ta préparation : base, développement, affûtage, récupération.</p> : (
            <ul className="divide-y divide-line">
              {macros.map((cycle) => (
                <li key={cycle.id} className="flex items-center gap-3 py-1.5 text-sm">
                  <span className="size-2.5 shrink-0 rounded-sm" style={{ backgroundColor: PHASE_COLORS[cycle.phase] }} aria-hidden="true" />
                  <span className="w-32 shrink-0 font-medium text-ink">{PHASE_LABELS[cycle.phase]}</span>
                  <span className="min-w-0 flex-1 text-xs text-mute tabular-nums">{shortDate(cycle.startDate)} – {longDate(cycle.endDate)}</span>
                  <button type="button" className={iconButton} aria-label={`Supprimer la phase ${PHASE_LABELS[cycle.phase]} du ${longDate(cycle.startDate)}`} onClick={() => removeCycle(cycle.id)}><TrashIcon /></button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className={`${card} space-y-3 p-4`}>
          <h2 className="text-base font-semibold text-ink">Courses</h2>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <label className="col-span-2 block sm:col-span-1"><span className={fieldLabel}>Nom</span>
              <input className={input} value={raceName} maxLength={60} placeholder="Ex. 10 km de Châlons" onChange={(event) => setRaceName(event.currentTarget.value)} /></label>
            <label className="block"><span className={fieldLabel}>Date</span>{dateInput(raceDate, setRaceDate)}</label>
            <div><span className={fieldLabel}>Priorité</span>
              <Select label="Priorité" value={priority} options={(['A', 'B', 'C'] as const).map((value) => ({ value, label: PRIORITY_LABELS[value] }))} onChange={setPriority} /></div>
          </div>
          <button type="button" className={primaryButton} disabled={raceName.trim() === ''} onClick={addRace}>Ajouter la course</button>
          {races.length === 0 ? <p className="text-sm text-mute">Aucune course. Place ton objectif A : le reste de la saison s'organise autour.</p> : (
            <ul className="divide-y divide-line">
              {races.map((race) => {
                const days = diffDays(today, race.date);
                return (
                  <li key={race.id} className="flex items-center gap-3 py-1.5 text-sm">
                    <PriorityBadge priority={race.priority} />
                    <span className="min-w-0 flex-1"><span className="block truncate font-medium text-ink">{race.name}</span>
                      <span className="block text-xs text-mute tabular-nums">{longDate(race.date)}</span></span>
                    <span className="shrink-0 text-sm font-semibold text-ink tabular-nums">{days === 0 ? 'Jour J' : days > 0 ? `J-${days}` : 'Passée'}</span>
                    <button type="button" className={iconButton} aria-label={`Supprimer la course ${race.name}`}
                      onClick={() => { if (plan) savePlan(removeRace(plan, race.id, now())); }}><TrashIcon /></button>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
