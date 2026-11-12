// StatsView.tsx — l'onglet Statistiques : où en sont la condition physique, la fatigue et la forme,
// et comment elles ont évolué. Tout est recalculé à partir des activités ; rien n'est stocké.
import { useMemo, useState } from 'react';
import { useApp } from '../../app/store.ts';
import { localToday } from '../athlete/thresholds.ts';
import { longDate, shortDate } from '../calendar/model/weeks.ts';
import { card, tab } from '../workout-builder/ui.tsx';
import { buildPmc, FORM_TEXT, formState, lastDays } from './model/pmc.ts';
import { PMC_COLORS, PMC_LABELS, PmcChart } from './PmcChart.tsx';

const RANGES: readonly { days: number | null; label: string }[] = [
  { days: 42, label: '6 semaines' }, { days: 90, label: '3 mois' }, { days: 180, label: '6 mois' }, { days: null, label: 'Tout' },
];
const signed = (value: number, digits = 0): string =>
  `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(value).toFixed(digits).replace('.', ',')}`;

export function StatsView() {
  const today = useMemo(() => localToday(), []);
  const activities = useApp((s) => s.calendar.activities);
  const workouts = useApp((s) => s.calendar.workouts);
  const [days, setDays] = useState<number | null>(90);
  // La courbe est calculée sur TOUT l'historique, puis découpée pour l'affichage : la valeur d'un
  // jour dépend de tous ceux qui le précèdent, pas seulement de ceux que l'on regarde.
  const pmc = useMemo(() => buildPmc(Object.values(activities), Object.values(workouts), today), [activities, workouts, today]);
  const shown = useMemo(() => lastDays(pmc.points, today, days), [pmc.points, today, days]);

  if (pmc.today === null || pmc.firstDate === null) {
    return (
      <section className={`${card} mx-auto max-w-2xl p-6 text-center`}>
        <h2 className="text-base font-semibold text-ink">Pas encore de statistiques</h2>
        <p className="mt-1 text-sm text-mute">La courbe de performance se construit à partir de tes activités réalisées. Importe des fichiers .FIT ou synchronise Garmin depuis l’onglet Calendrier.</p>
      </section>
    );
  }
  const { ctl, atl, tsb } = pmc.today;
  const form = FORM_TEXT[formState(tsb)];
  const tiles = [
    { key: 'ctl' as const, value: String(Math.round(ctl)), hint: pmc.ramp !== null ? `${signed(pmc.ramp, 1)} en 7 jours` : 'Moyenne de la charge sur 42 jours' },
    { key: 'atl' as const, value: String(Math.round(atl)), hint: 'Moyenne de la charge sur 7 jours' },
    { key: 'tsb' as const, value: signed(Math.round(tsb)), hint: `${form.label}. ${form.hint}` },
  ];
  const recent = pmc.points.filter((p) => p.ctl !== null).slice(-14).reverse();

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <dl className="grid gap-3 sm:grid-cols-3">
        {tiles.map((tile) => (
          <div key={tile.key} className={`${card} p-4`}>
            <dt className="flex items-center gap-2 text-xs font-medium text-mute">
              <span className="size-2.5 rounded-sm" style={{ backgroundColor: PMC_COLORS[tile.key] }} aria-hidden="true" />{PMC_LABELS[tile.key]}
            </dt>
            <dd className="mt-1 text-4xl font-semibold tracking-tight text-ink tabular-nums">{tile.value}</dd>
            <dd className="mt-1 text-xs text-mute tabular-nums">{tile.hint}</dd>
          </div>
        ))}
      </dl>

      <section className={`${card} p-4`} aria-label="Courbe de performance">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 className="flex-1 text-base font-semibold text-ink">Courbe de performance</h2>
          <div className="flex gap-1 rounded-xl border border-line bg-panel p-1" role="group" aria-label="Période affichée">
            {RANGES.map((range) => (
              <button key={range.label} type="button" className={`${tab} h-8 px-2.5 text-xs`} aria-pressed={days === range.days} onClick={() => setDays(range.days)}>{range.label}</button>
            ))}
          </div>
        </div>
        <PmcChart points={shown} today={today} />
        <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-mute">
          <li>Charge de chaque jour : somme des charges de tes activités, sur l’échelle où 100 vaut une heure au seuil. Un jour sans activité compte pour 0.</li>
          <li>Forme = condition physique − fatigue, après la séance du jour.</li>
          {pmc.warmingUp ? <li>Ton historique commence le {longDate(pmc.firstDate)}, il y a moins de 42 jours : la condition physique part de zéro et reste sous-estimée tant que six semaines d’activités ne sont pas importées.</li> : null}
          <li>Les repères de forme (« frais », « en charge »…) sont des conventions d’entraîneurs, pas des seuils physiologiques.</li>
        </ul>
        <details className="mt-3 text-xs">
          <summary className="cursor-pointer font-medium text-ink">Voir les valeurs des 14 derniers jours</summary>
          <table className="mt-2 w-full text-right tabular-nums">
            <thead className="text-mute"><tr><th className="py-1 text-left font-medium">Jour</th><th className="font-medium">Charge</th><th className="font-medium">Condition</th><th className="font-medium">Fatigue</th><th className="font-medium">Forme</th></tr></thead>
            <tbody>
              {recent.map((p) => (
                <tr key={p.date} className="border-t border-line text-ink">
                  <td className="py-1 text-left text-mute">{shortDate(p.date)}</td><td>{Math.round(p.load)}</td>
                  <td>{Math.round(p.ctl ?? 0)}</td><td>{Math.round(p.atl ?? 0)}</td><td>{signed(Math.round(p.tsb ?? 0))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </section>
    </div>
  );
}
