// ActivityAnalysis.tsx — l'analyse d'une activité réalisée : ses courbes, son temps en zones, et le
// ressenti de l'athlète.
//
// Allure (ou puissance) et fréquence cardiaque sont tracées dans deux bandes superposées qui
// partagent le même axe du temps et le même curseur, et non sur un seul graphique à deux échelles :
// avec deux axes verticaux, l'endroit où les courbes se croisent dépend du choix des échelles et ne
// veut rien dire. Ici, chaque courbe a sa propre échelle, et on lit les deux au même instant.
import { useEffect, useMemo, useState } from 'react';
import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { thresholdsAt, type ActivityStreams, type CompletedActivity, type Sport } from '../../domain/index.ts';
import { useApp } from '../../app/store.ts';
import { STREAM_STEP_S } from '../import/streams.ts';
import { formatDuration, formatPace, paceUnit } from '../workout-builder/model/format.ts';
import { axisTicks } from '../workout-builder/model/profile.ts';
import { zoneBounds, zoneModelFor } from '../workout-builder/model/zones.ts';
import { fieldLabel, input, tab } from '../workout-builder/ui.tsx';
import { axisDomain, chartRows, effortMetric, type ChartRow, type EffortMetric } from './model/chart-rows.ts';
import { FEELING_TEXT, FEELING_VALUES, fosterLoad, NOTE_MAX_LENGTH, RPE_TEXT, RPE_VALUES, withSubjective, type SubjectivePatch } from './model/subjective.ts';
import { streamOf, timeInZones, zoneOptions, type ZoneSource, type ZoneTime } from './model/zone-time.ts';
import { useActivityStreams } from './useActivityStreams.ts';
import { ZoneChart } from './ZoneChart.tsx';

const EFFORT_COLOR = '#38BDF8';
const HR_COLOR = '#EF4444';
const SOURCE_LABELS: Record<ZoneSource, string> = { hr: 'Fréquence cardiaque', power: 'Puissance', pace: 'Allure' };
const section = 'mt-4 rounded-lg border border-line bg-raised/40 p-3';
const sectionTitle = 'text-sm font-semibold text-ink';

/** Valeur d'effort en clair : puissance en watts, vitesse en allure (ou en km/h à vélo). */
function formatEffort(value: number, metric: EffortMetric, sport: Sport, withUnit = true): string {
  if (metric === 'power') return `${Math.round(value)}${withUnit ? ' W' : ''}`;
  if (sport === 'bike') return `${(value * 3.6).toFixed(1).replace('.', ',')}${withUnit ? ' km/h' : ''}`;
  const pace = formatPace(value, sport);
  return pace === '' ? '—' : `${pace}${withUnit ? ` ${paceUnit(sport)}` : ''}`;
}
const effortTitle = (metric: EffortMetric, sport: Sport): string => (metric === 'power' ? 'Puissance' : sport === 'bike' ? 'Vitesse' : 'Allure');

export function ActivityAnalysis({ activity }: { activity: CompletedActivity }) {
  const athlete = useApp((s) => s.athlete);
  const thresholds = useMemo(() => thresholdsAt(athlete ?? { thresholds: [] }, activity.localDate), [athlete, activity.localDate]);
  const state = useActivityStreams(activity.id, activity.hasStreams);

  return (
    <>
      {state.status === 'ready' ? (
        <>
          <Curves streams={state.streams} sport={activity.sport} thresholdEffort={{ power: thresholds.bySport[activity.sport]?.ftpW, speed: thresholds.bySport[activity.sport]?.thresholdSpeedMps }} />
          <Zones streams={state.streams} activity={activity} />
        </>
      ) : (
        <p className={`${section} text-sm text-mute`} role="status">
          {state.status === 'loading' ? 'Chargement des courbes…'
            : state.status === 'error' ? 'Les courbes de cette activité n’ont pas pu être lues dans la base locale.'
            : 'Cette activité n’a pas de courbes enregistrées : elle a été importée avant qu’elles ne soient conservées, ou son fichier n’en contenait pas. Redépose son fichier .FIT dans le Calendrier (ou relance « Synchroniser Garmin ») pour les ajouter.'}
        </p>
      )}
      <Feeling activity={activity} />
    </>
  );
}

// --- Courbes ---------------------------------------------------------------------------------

interface CurvesProps {
  streams: ActivityStreams;
  sport: Sport;
  thresholdEffort: { power: number | undefined; speed: number | undefined };
}
function Curves({ streams, sport, thresholdEffort }: CurvesProps) {
  const metric = useMemo(() => effortMetric(streams, sport), [streams, sport]);
  const rows = useMemo(() => chartRows(streams, metric, STREAM_STEP_S), [streams, metric]);
  const total = rows[rows.length - 1]?.t ?? 0;
  const ticks = useMemo(() => axisTicks(total, 'time'), [total]);
  const hasHr = streams.hrBpm !== undefined;
  if (!(total > 0) || (metric === null && !hasHr)) return null;
  const threshold = metric === 'power' ? thresholdEffort.power : metric === 'speed' ? thresholdEffort.speed : undefined;

  return (
    <section className={section} aria-label="Courbes de l'activité">
      <h3 className={sectionTitle}>Courbes</h3>
      {metric !== null ? (
        <Band title={effortTitle(metric, sport)} rows={rows} dataKey="effort" color={EFFORT_COLOR} total={total} ticks={ticks} showTime={!hasHr}
          format={(value, unit) => formatEffort(value, metric, sport, unit)} {...(threshold !== undefined ? { threshold } : {})} />
      ) : null}
      {hasHr ? <Band title="Fréquence cardiaque" rows={rows} dataKey="hr" color={HR_COLOR} total={total} ticks={ticks} showTime format={(value, unit) => `${Math.round(value)}${unit ? ' bpm' : ''}`} /> : null}
      <p className="mt-1 text-[11px] text-mute">
        Un point toutes les {STREAM_STEP_S} secondes. Les deux bandes partagent le même axe du temps : survole l’une pour lire l’autre au même instant.
        {metric === 'speed' ? ' L’allure est lissée sur 15 secondes.' : ''}
      </p>
    </section>
  );
}

interface BandProps {
  title: string;
  rows: readonly ChartRow[];
  dataKey: 'effort' | 'hr';
  color: string;
  total: number;
  ticks: readonly number[];
  /** Affiche les graduations du temps : seulement sur la bande du bas. */
  showTime: boolean;
  format: (value: number, withUnit: boolean) => string;
  /** Seuil de l'athlète sur cette mesure (FTP, vitesse seuil) : tracé en repère. */
  threshold?: number;
}
function Band({ title, rows, dataKey, color, total, ticks, showTime, format, threshold }: BandProps) {
  const domain = useMemo(() => axisDomain(rows, dataKey), [rows, dataKey]);
  const mean = useMemo(() => {
    const values = rows.map((row) => row[dataKey]).filter((v): v is number => v !== null);
    return values.length > 0 ? values.reduce((sum, v) => sum + v, 0) / values.length : null;
  }, [rows, dataKey]);
  if (domain === null) return null;
  const axisTick = { fill: 'var(--color-mute)', fontSize: 11 };
  /** Le repère du seuil n'est tracé que s'il tombe dans la partie visible de l'échelle. */
  const shownThreshold = threshold !== undefined && threshold >= domain[0] && threshold <= domain[1] ? threshold : null;

  return (
    <figure className="mt-2">
      <figcaption className="flex items-baseline justify-between gap-2 text-xs">
        <span className="flex items-center gap-1.5 font-medium text-ink"><span className="h-0.5 w-4 rounded-full" style={{ backgroundColor: color }} aria-hidden="true" />{title}</span>
        {mean !== null ? <span className="text-mute tabular-nums">moyenne {format(mean, true)}</span> : null}
      </figcaption>
      <div className={showTime ? 'h-40' : 'h-36'}>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={rows as ChartRow[]} syncId="activite" margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--color-line)" />
            <XAxis dataKey="t" type="number" domain={[0, total]} ticks={ticks as number[]} tickFormatter={(value: number) => formatDuration(value)}
              tick={showTime ? axisTick : false} height={showTime ? 24 : 4} axisLine={{ stroke: 'var(--color-line)' }} tickLine={false} />
            <YAxis type="number" domain={domain} allowDataOverflow width={48} tickCount={4} tickFormatter={(value: number) => format(value, false)}
              tick={axisTick} axisLine={false} tickLine={false} />
            <Tooltip isAnimationActive={false} cursor={{ stroke: 'var(--color-mute)', strokeDasharray: '3 3' }}
              content={(tip: { active?: boolean; payload?: readonly { payload?: ChartRow }[] }) => {
                const row = tip.active ? tip.payload?.[0]?.payload : undefined;
                const value = row?.[dataKey];
                return row === undefined || value === null || value === undefined ? null : (
                  <div className="rounded-md border border-line-strong bg-raised px-2 py-1 text-xs shadow-xl">
                    <span className="text-mute tabular-nums">{formatDuration(row.t)}</span>{' '}
                    <span className="font-semibold text-ink tabular-nums">{format(value, true)}</span>
                  </div>
                );
              }} />
            {shownThreshold !== null ? (
              <ReferenceLine y={shownThreshold} stroke="var(--color-mute)" strokeDasharray="4 4" label={{ value: 'Seuil', position: 'insideTopRight', fill: 'var(--color-mute)', fontSize: 11 }} />
            ) : null}
            <Line type="linear" dataKey={dataKey} stroke={color} strokeWidth={2} dot={false} activeDot={{ r: 3 }} connectNulls={false} isAnimationActive={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </figure>
  );
}

// --- Temps en zones --------------------------------------------------------------------------

function Zones({ streams, activity }: { streams: ActivityStreams; activity: CompletedActivity }) {
  const athlete = useApp((s) => s.athlete);
  const thresholds = useMemo(() => thresholdsAt(athlete ?? { thresholds: [] }, activity.localDate), [athlete, activity.localDate]);
  const options = useMemo(() => zoneOptions(streams, thresholds, activity.sport), [streams, thresholds, activity.sport]);
  const [chosen, setChosen] = useState<ZoneSource | null>(null);
  const option = options.find((o) => o.source === chosen) ?? options[0];
  const breakdown = useMemo(() => {
    if (option === undefined) return null;
    const values = streamOf(streams, option.source);
    return values === undefined ? null : timeInZones(streams.timeS, values, option, zoneBounds(option.basis, zoneModelFor(athlete?.zones, activity.sport)));
  }, [option, streams, athlete?.zones, activity.sport]);

  if (option === undefined || breakdown === null) {
    return (
      <section className={section} aria-label="Temps passé dans les zones">
        <h3 className={sectionTitle}>Temps passé dans les zones</h3>
        <p className="mt-1 text-sm text-mute">Pour répartir cette activité en zones, renseigne dans le Profil ta FC max, ta FTP (vélo) ou ton allure seuil, à une date antérieure ou égale à celle de la séance.</p>
      </section>
    );
  }
  const sport = activity.sport;
  const formatRange = (zone: ZoneTime): string => {
    if (option.source === 'pace') {
      // En allure, la borne basse en vitesse est l'allure la plus lente.
      const slow = zone.low !== null ? formatPace(zone.low, sport) : null, fast = zone.high !== null ? formatPace(zone.high, sport) : null;
      return slow === null ? `plus lent que ${fast} ${paceUnit(sport)}` : fast === null ? `plus vite que ${slow} ${paceUnit(sport)}` : `${slow} à ${fast} ${paceUnit(sport)}`;
    }
    const unit = option.source === 'hr' ? 'bpm' : 'W';
    const low = zone.low !== null ? Math.round(zone.low) : null, high = zone.high !== null ? Math.round(zone.high) : null;
    return low === null ? `jusqu’à ${high} ${unit}` : high === null ? `plus de ${low} ${unit}` : `${low} à ${high} ${unit}`;
  };
  const referenceText = option.basis === 'hr_max' ? `FC max ${Math.round(option.reference)} bpm` : option.basis === 'lthr' ? `FC seuil ${Math.round(option.reference)} bpm`
    : option.basis === 'ftp' ? `FTP ${Math.round(option.reference)} W` : `allure seuil ${formatPace(option.reference, sport)} ${paceUnit(sport)}`;

  return (
    <section className={section} aria-label="Temps passé dans les zones">
      <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <h3 className={`${sectionTitle} flex-1`}>Temps passé dans les zones</h3>
        {options.length > 1 ? (
          <div className="flex gap-1" role="group" aria-label="Mesure utilisée pour les zones">
            {options.map((o) => (
              <button key={o.source} type="button" className={`${tab} h-8 px-2 text-xs`} aria-pressed={o.source === option.source} onClick={() => setChosen(o.source)}>{SOURCE_LABELS[o.source]}</button>
            ))}
          </div>
        ) : null}
      </div>
      <ZoneChart breakdown={breakdown} formatRange={formatRange} />
      <p className="mt-2 text-[11px] text-mute tabular-nums">
        D’après la {SOURCE_LABELS[option.source].toLowerCase()}, sur {formatDuration(breakdown.measuredS)} mesurées. Référence : {referenceText}, valable à la date de la séance.
      </p>
    </section>
  );
}

// --- Ressenti --------------------------------------------------------------------------------

const scaleButton =
  'inline-flex h-10 min-w-0 items-center justify-center rounded-lg border border-line bg-raised/60 text-sm font-semibold text-mute tabular-nums transition-colors ' +
  'hover:border-racing/70 hover:text-ink aria-pressed:border-racing aria-pressed:bg-racing-deep aria-pressed:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-racing';

function Feeling({ activity }: { activity: CompletedActivity }) {
  const athlete = useApp((s) => s.athlete);
  const saveActivity = useApp((s) => s.actions.saveActivity);
  const { rpe, feeling, note } = activity.subjective;
  const [draft, setDraft] = useState(note ?? '');
  useEffect(() => { setDraft(note ?? ''); }, [activity.id, note]);
  const save = (patch: SubjectivePatch): void =>
    saveActivity(withSubjective(activity, patch, thresholdsAt(athlete ?? { thresholds: [] }, activity.localDate), athlete?.sex));
  const foster = fosterLoad(activity);
  // Une décimale : avec des minutes arrondies à l'unité, le produit affiché ne tomberait pas juste.
  const minutes = ((activity.summary.movingS > 0 ? activity.summary.movingS : activity.summary.elapsedS) / 60).toFixed(1).replace('.0', '').replace('.', ',');

  return (
    <section className={section} aria-label="Ressenti">
      <h3 className={sectionTitle}>Ressenti</h3>
      <div className="mt-2">
        <span className={fieldLabel} id="rpe-titre">Difficulté perçue (RPE){rpe !== undefined ? ` : ${rpe} sur 10, ${RPE_TEXT[rpe]?.toLowerCase() ?? ''}` : ''}</span>
        <div className="grid grid-cols-10 gap-1" role="group" aria-labelledby="rpe-titre">
          {RPE_VALUES.map((value) => (
            <button key={value} type="button" className={scaleButton} aria-pressed={rpe === value} title={RPE_TEXT[value]}
              aria-label={`${value} sur 10 : ${RPE_TEXT[value]}`} onClick={() => save({ rpe: rpe === value ? undefined : value })}>{value}</button>
          ))}
        </div>
        <p className="mt-1.5 text-xs text-mute tabular-nums">
          {foster !== null
            ? <>Charge de Foster : <span className="font-semibold text-ink">{rpe} × {minutes} min = {foster}</span> (unités arbitraires). {activity.load?.method === 'rpe' ? 'Faute de mesure objective, c’est elle qui donne la charge de cette séance.' : 'Elle est gardée à côté de la charge mesurée, pour les comparer.'}</>
            : 'Note ton effort de 1 (très facile) à 10 (maximal) pour obtenir la charge de Foster : RPE × durée en minutes. Clique de nouveau sur la note pour l’effacer.'}
        </p>
      </div>
      <div className="mt-3">
        <span className={fieldLabel} id="sensations-titre">Sensations{feeling !== undefined ? ` : ${FEELING_TEXT[feeling]?.toLowerCase() ?? ''}` : ''}</span>
        <div className="grid grid-cols-5 gap-1" role="group" aria-labelledby="sensations-titre">
          {FEELING_VALUES.map((value) => (
            <button key={value} type="button" className={`${scaleButton} h-auto flex-col gap-0.5 py-1.5`} aria-pressed={feeling === value}
              onClick={() => save({ feeling: feeling === value ? undefined : value })}>
              <span>{value}</span><span className="max-w-full truncate px-1 text-[10px] font-normal">{FEELING_TEXT[value]}</span>
            </button>
          ))}
        </div>
      </div>
      <label className="mt-3 block">
        <span className={fieldLabel}>Notes</span>
        <textarea className={`${input} h-20 resize-y py-2 leading-snug`} value={draft} maxLength={NOTE_MAX_LENGTH} placeholder="Conditions, sommeil, douleurs, ce qui a bien ou mal marché…"
          onChange={(event) => setDraft(event.currentTarget.value)} onBlur={() => { if (draft.trim() !== (note ?? '')) save({ note: draft }); }} />
        <span className="mt-1 block text-[11px] text-mute">{draft.trim() !== (note ?? '') ? 'Modification enregistrée dès que tu quittes ce champ.' : note !== undefined ? 'Enregistré.' : ' '}</span>
      </label>
    </section>
  );
}
