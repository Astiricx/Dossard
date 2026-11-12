// ThresholdsForm.tsx — profil de l'athlète : relevés de seuils datés.
// On n'écrase jamais un seuil : on ajoute un relevé à sa date. L'historique reste ainsi évalué
// avec les seuils de l'époque, et les séances futures suivent le dernier relevé.
import { useState } from 'react';
import { thresholdsAt, type ISODate, type SportThresholds, type ThresholdSnapshot } from '../../domain/index.ts';
import { useApp } from '../../app/store.ts';
import { formatPace, parseInteger, parsePace } from '../workout-builder/model/format.ts';
import { card, fieldLabel, iconButton, input, inputInvalid, primaryButton, TrashIcon } from '../workout-builder/ui.tsx';
import { createAthlete, localToday, removeSnapshot, upsertSnapshot } from './thresholds.ts';

const FIELDS = [
  { key: 'hrMax', label: 'FC max', unit: 'bpm', hint: 'Mesurée sur un effort maximal, pas « 220 moins l’âge ».' },
  { key: 'hrRest', label: 'FC de repos', unit: 'bpm', hint: 'Au réveil, allongé.' },
  { key: 'ftp', label: 'FTP vélo', unit: 'W', hint: 'Puissance tenable environ une heure.' },
  { key: 'pace', label: 'Allure seuil course', unit: '/km', hint: 'Allure tenable environ une heure, proche de ton allure sur 15 km. Ce n’est pas la VMA.' },
  { key: 'swim', label: 'Allure seuil natation', unit: '/100 m', hint: 'Allure tenable sur 1 500 m environ (vitesse critique). S’écrit en min:s, par exemple 1:45.' },
] as const;
type Key = (typeof FIELDS)[number]['key'];
type Values = Record<Key, string>;
const EMPTY: Values = { hrMax: '', hrRest: '', ftp: '', pace: '', swim: '' };
const PLACEHOLDERS: Partial<Record<Key, string>> = { pace: '4:10', swim: '1:45' };

const PARSERS: Record<Key, (text: string) => number | null> = {
  hrMax: parseInteger(100, 230),
  hrRest: parseInteger(25, 110),
  ftp: parseInteger(50, 600),
  pace: (text) => parsePace(text, 'run'),
  swim: (text) => parsePace(text, 'swim'),
};

function describe(snapshot: Pick<ThresholdSnapshot, 'hrMaxBpm' | 'hrRestBpm'> & { bySport?: { run?: SportThresholds; bike?: SportThresholds; swim?: SportThresholds } }): string {
  const parts = [
    snapshot.hrMaxBpm !== undefined ? `FC max ${snapshot.hrMaxBpm}` : null,
    snapshot.hrRestBpm !== undefined ? `FC repos ${snapshot.hrRestBpm}` : null,
    snapshot.bySport?.bike?.ftpW !== undefined ? `FTP ${snapshot.bySport.bike.ftpW} W` : null,
    snapshot.bySport?.run?.thresholdSpeedMps !== undefined ? `seuil course ${formatPace(snapshot.bySport.run.thresholdSpeedMps, 'run')}/km` : null,
    snapshot.bySport?.swim?.thresholdSpeedMps !== undefined ? `seuil natation ${formatPace(snapshot.bySport.swim.thresholdSpeedMps, 'swim')}/100 m` : null,
  ].filter((part) => part !== null);
  return parts.length > 0 ? parts.join(', ') : 'Aucune valeur';
}

export function ThresholdsForm() {
  const athlete = useApp((s) => s.athlete);
  const saveAthlete = useApp((s) => s.actions.saveAthlete);
  const [date, setDate] = useState<ISODate>(() => localToday());
  const [values, setValues] = useState<Values>(EMPTY);
  const [saved, setSaved] = useState(false);

  const parsed = Object.fromEntries(FIELDS.map(({ key }) => [key, values[key].trim() === '' ? undefined : PARSERS[key](values[key])])) as Record<Key, number | null | undefined>;
  const invalid = FIELDS.some(({ key }) => parsed[key] === null);
  const empty = FIELDS.every(({ key }) => parsed[key] === undefined);
  const current = athlete ? thresholdsAt(athlete, localToday()) : null;

  const submit = (): void => {
    if (invalid || empty) return;
    const run: SportThresholds = parsed.pace != null ? { thresholdSpeedMps: parsed.pace } : {};
    const bike: SportThresholds = parsed.ftp != null ? { ftpW: parsed.ftp } : {};
    const swim: SportThresholds = parsed.swim != null ? { thresholdSpeedMps: parsed.swim } : {};
    const snapshot: ThresholdSnapshot = {
      validFrom: date,
      origin: 'test',
      ...(parsed.hrMax != null ? { hrMaxBpm: parsed.hrMax } : {}),
      ...(parsed.hrRest != null ? { hrRestBpm: parsed.hrRest } : {}),
      ...(parsed.pace != null || parsed.ftp != null || parsed.swim != null
        ? { bySport: { ...(parsed.pace != null ? { run } : {}), ...(parsed.ftp != null ? { bike } : {}), ...(parsed.swim != null ? { swim } : {}) } }
        : {}),
    };
    const base = athlete ?? createAthlete(Intl.DateTimeFormat().resolvedOptions().timeZone);
    saveAthlete(upsertSnapshot(base, snapshot));
    setValues(EMPTY);
    setSaved(true);
  };

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <section className={`${card} p-4`}>
        <h2 className="text-base font-semibold text-ink">Seuils en vigueur aujourd'hui</h2>
        <p className="mt-1 text-sm text-mute">
          {current === null || current.asOf === null ? 'Aucun seuil enregistré. Sans eux, la charge des séances en allure ou en watts ne peut pas être calculée.' : describe(current)}
        </p>
      </section>

      <section className={`${card} space-y-3 p-4`}>
        <h2 className="text-base font-semibold text-ink">Ajouter un relevé</h2>
        <p className="text-sm text-mute">
          Remplis seulement ce qui a changé : les autres valeurs sont reprises du relevé précédent.
        </p>
        <label className="block max-w-48">
          <span className={fieldLabel}>Valable à partir du</span>
          <input className={input} type="date" value={date}
            onChange={(event) => { if (event.currentTarget.value !== '') setDate(event.currentTarget.value as ISODate); }} />
        </label>
        <div className="grid gap-3 sm:grid-cols-2">
          {FIELDS.map((field) => (
            <label key={field.key} className="block">
              <span className={fieldLabel}>{field.label} ({field.unit})</span>
              <input className={`${input} ${parsed[field.key] === null ? inputInvalid : ''}`} value={values[field.key]}
                inputMode={field.key in PLACEHOLDERS ? 'text' : 'numeric'} autoComplete="off" placeholder={PLACEHOLDERS[field.key] ?? ''}
                aria-invalid={parsed[field.key] === null}
                onChange={(event) => { setSaved(false); setValues({ ...values, [field.key]: event.currentTarget.value }); }} />
              <span className="mt-1 block text-xs text-mute">{parsed[field.key] === null ? 'Valeur hors limites ou mal écrite.' : field.hint}</span>
            </label>
          ))}
        </div>
        <div className="flex items-center gap-3">
          <button type="button" className={primaryButton} disabled={invalid || empty} onClick={submit}>Enregistrer le relevé</button>
          {saved ? <span className="text-sm text-mute" role="status">Relevé enregistré.</span> : null}
        </div>
      </section>

      {athlete !== null && athlete.thresholds.length > 0 ? (
        <section className={`${card} p-4`}>
          <h2 className="text-base font-semibold text-ink">Historique des relevés</h2>
          <ul className="mt-2 divide-y divide-line">
            {[...athlete.thresholds].reverse().map((snapshot) => (
              <li key={snapshot.validFrom} className="flex items-center gap-3 py-2 text-sm">
                <span className="w-24 shrink-0 tabular-nums text-mute">{snapshot.validFrom.split('-').reverse().join('/')}</span>
                <span className="min-w-0 flex-1 text-ink">{describe(snapshot)}</span>
                <button type="button" className={iconButton} aria-label={`Supprimer le relevé du ${snapshot.validFrom}`}
                  onClick={() => saveAthlete(removeSnapshot(athlete, snapshot.validFrom))}>
                  <TrashIcon />
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
