// BackupCard.tsx — exporter toutes les données dans un fichier JSON, et restaurer une sauvegarde.
import { useRef, useState } from 'react';
import { appStore, streamsReader } from '../../app/store.ts';
import { card, ghostButton, primaryButton } from '../workout-builder/ui.tsx';
import { BACKUP_PROBLEM_TEXT, backupFileName, buildBackup, parseBackup, serializeBackup, type BackupParse } from './backup.ts';

type Pending = Extract<BackupParse, { ok: true }>;
const plural = (n: number, one: string, many: string): string => `${n} ${n > 1 ? many : one}`;

export function BackupCard() {
  const [message, setMessage] = useState<{ tone: 'info' | 'problem'; text: string } | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const picker = useRef<HTMLInputElement>(null);

  const exportAll = async (): Promise<void> => {
    // Les séries ne sont pas dans le store : on les lit dans la base au moment d'exporter.
    let streams;
    try { streams = await streamsReader.readAll(); }
    catch { setMessage({ tone: 'problem', text: 'Les séries des activités n’ont pas pu être lues. Rien n’a été exporté.' }); return; }
    const state = appStore.getState();
    const exportedAt = new Date().toISOString();
    const backup = buildBackup({
      athlete: state.athlete, plans: Object.values(state.plans), cycles: Object.values(state.cycles), templates: state.templates,
      workouts: Object.values(state.calendar.workouts), activities: Object.values(state.calendar.activities),
    }, exportedAt, streams);
    const url = URL.createObjectURL(new Blob([serializeBackup(backup)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url; link.download = backupFileName(exportedAt);
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    setMessage({ tone: 'info', text: `Sauvegarde créée : ${plural(backup.data.workouts.length, 'séance', 'séances')}, ${plural(backup.data.activities.length, 'activité', 'activités')}. Range ce fichier ailleurs que sur cet appareil.` });
  };

  const readFile = async (file: File | undefined): Promise<void> => {
    if (file === undefined) return;
    setMessage(null); setPending(null);
    let text: string;
    try { text = await file.text(); }
    catch { setMessage({ tone: 'problem', text: 'Le fichier n’a pas pu être lu.' }); return; }
    finally { if (picker.current) picker.current.value = ''; }
    const parsed = parseBackup(text);
    if (parsed.ok) setPending(parsed);
    else setMessage({ tone: 'problem', text: `${BACKUP_PROBLEM_TEXT[parsed.problem]}${parsed.detail !== undefined ? ` (${parsed.detail})` : ''}` });
  };
  const restore = (): void => {
    if (pending === null) return;
    appStore.getState().actions.restoreAll(pending.content, pending.streams);
    setPending(null);
    setMessage({ tone: 'info', text: 'Sauvegarde restaurée. Tes données ont été remplacées par celles du fichier.' });
  };

  return (
    <section className={`${card} mx-auto max-w-2xl space-y-3 p-4`}>
      <h2 className="text-base font-semibold text-ink">Sauvegarde</h2>
      <p className="text-sm text-mute">
        Tes données vivent uniquement dans ce navigateur : vider son cache ou changer d’ordinateur les efface. Exporte régulièrement une sauvegarde.
        Elle contient le profil, les seuils, la saison, les séances, les activités et leurs courbes, mais jamais la clé Garmin.
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={primaryButton} onClick={() => void exportAll()}>Exporter toutes les données (JSON)</button>
        <input ref={picker} type="file" accept=".json,application/json" className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(event) => void readFile(event.currentTarget.files?.[0])} />
        <button type="button" className={ghostButton} onClick={() => picker.current?.click()}>Restaurer une sauvegarde JSON</button>
      </div>

      {pending !== null ? (
        <div role="alertdialog" aria-labelledby="restaurer-titre" className="rounded-lg border border-racing bg-racing/10 p-3">
          <p id="restaurer-titre" className="text-sm font-semibold text-ink">Remplacer toutes les données de cet appareil ?</p>
          <p className="mt-1 text-xs leading-relaxed text-mute tabular-nums">
            Sauvegarde{pending.exportedAt !== '' ? ` du ${pending.exportedAt.slice(0, 10).split('-').reverse().join('/')}` : ''} :{' '}
            {plural(pending.counts.workouts, 'séance', 'séances')}, {plural(pending.counts.activities, 'activité', 'activités')} (dont {pending.counts.streams} avec leurs courbes),{' '}
            {plural(pending.counts.thresholds, 'relevé de seuils', 'relevés de seuils')}, {plural(pending.counts.phases, 'phase', 'phases')}, {plural(pending.counts.races, 'course', 'courses')}.
            Ce qui est actuellement enregistré ici sera effacé. La clé Garmin de cet appareil est conservée.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" className={primaryButton} onClick={restore}>Remplacer mes données</button>
            <button type="button" className={ghostButton} onClick={() => setPending(null)}>Annuler</button>
          </div>
        </div>
      ) : null}
      {message !== null ? <p role={message.tone === 'problem' ? 'alert' : 'status'} className={`text-sm ${message.tone === 'problem' ? 'text-racing' : 'text-mute'}`}>{message.text}</p> : null}
    </section>
  );
}
