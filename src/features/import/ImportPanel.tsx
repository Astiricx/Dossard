// ImportPanel.tsx — import des activités réalisées : dépôt de fichiers .FIT (ou .zip de Garmin
// Connect) par lot, et synchronisation avec Garmin par le micro-relais Cloudflare de l'athlète.
import { useRef, useState, type DragEvent } from 'react';
import type { ISODateTime } from '../../domain/index.ts';
import { appStore, useApp } from '../../app/store.ts';
import { LOCAL_ATHLETE_ID } from '../athlete/thresholds.ts';
import { card, CloseIcon, ghostButton, iconButton, SyncIcon, UploadIcon } from '../workout-builder/ui.tsx';
import { decodeFit } from './fit/decoder.ts';
import { fetchRecentGarminFiles, garminFailureText } from './garmin/client.ts';
import { FAILURE_TEXT } from './labels.ts';
import { importFiles, type ImportOutcome, type SourceFile } from './pipeline.ts';

const plural = (n: number, one: string, many: string): string => `${n} ${n > 1 ? many : one}`;

type Notice = { tone: 'info' | 'problem'; title: string; body: string };

export function ImportPanel() {
  const hasKey = useApp((s) => s.settings.garminToken !== undefined);
  const [busy, setBusy] = useState<'files' | 'garmin' | null>(null);
  const [over, setOver] = useState(false);
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const picker = useRef<HTMLInputElement>(null);

  const run = async (files: readonly SourceFile[]): Promise<ImportOutcome> => importFiles(files, {
    decode: decodeFit, store: appStore, athleteId: LOCAL_ATHLETE_ID,
    now: () => new Date().toISOString() as ISODateTime,
    // Fuseau de cet appareil à l'instant de l'activité, pour les rares fichiers qui n'indiquent pas le leur.
    fallbackOffsetMin: (instantMs) => -new Date(instantMs).getTimezoneOffset(),
  });

  const importPicked = async (list: FileList | null): Promise<void> => {
    if (list === null || list.length === 0 || busy !== null) return;
    setBusy('files'); setNotice(null);
    try {
      const files = await Promise.all(Array.from(list, async (file) => ({ name: file.name, buffer: await file.arrayBuffer() })));
      setOutcome(await run(files));
    } catch (error) {
      setNotice({ tone: 'problem', title: 'L’import a échoué', body: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(null);
      if (picker.current) picker.current.value = '';       // permet de rechoisir le même fichier
    }
  };

  const syncGarmin = async (): Promise<void> => {
    const state = appStore.getState();
    const key = state.settings.garminToken;
    if (key === undefined || busy !== null) return;
    setBusy('garmin'); setNotice(null); setOutcome(null);
    try {
      // Une activité importée sans ses séries (avant le Sprint 5) est retéléchargée pour être complétée.
      const knownIds = new Set(Object.values(state.calendar.activities).flatMap((a) => (a.source.provider === 'garmin' && a.source.externalId !== null && a.hasStreams ? [a.source.externalId] : [])));
      const result = await fetchRecentGarminFiles(key, { fetch: (input, init) => fetch(input, init), relayUrl: state.settings.garminRelayUrl, online: () => navigator.onLine, knownIds });
      if (!result.ok) { setNotice({ tone: 'problem', ...garminFailureText(result.failure) }); return; }
      if (result.files.length > 0) setOutcome(await run(result.files));
      setNotice({
        tone: 'info', title: 'Synchronisation Garmin terminée',
        body: `${plural(result.listed, 'activité récente trouvée', 'activités récentes trouvées')}, dont ${result.alreadyKnown} déjà importée(s).`
          + (result.failedDownloads > 0 ? ` ${plural(result.failedDownloads, 'fichier n’a pas pu être téléchargé', 'fichiers n’ont pas pu être téléchargés')} (activité sans enregistrement).` : ''),
      });
    } catch (error) {
      setNotice({ tone: 'problem', title: 'La synchronisation a échoué', body: error instanceof Error ? error.message : String(error) });
    } finally { setBusy(null); }
  };

  const onDrop = (event: DragEvent<HTMLDivElement>): void => {
    event.preventDefault(); setOver(false);
    void importPicked(event.dataTransfer.files);
  };
  const failures = outcome?.reports.filter((report) => !report.ok) ?? [];

  return (
    <section className={`${card} p-3`} aria-label="Import des activités réalisées">
      <div
        onDragOver={(event) => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); setOver(true); } }}
        onDragLeave={() => setOver(false)} onDrop={onDrop}
        className={`flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-dashed px-3 py-2.5 transition-colors ${over ? 'border-racing bg-racing/15' : 'border-line-strong'}`}>
        <div className="min-w-0 flex-1 basis-64">
          <p className="text-sm font-semibold text-ink">Importer des fichiers .FIT</p>
          <p className="text-xs text-mute">Dépose ici une sortie ou toute une semaine d’un coup (.fit, ou les .zip exportés depuis Garmin Connect). Un fichier déjà importé n’est jamais compté deux fois.</p>
        </div>
        {/* Pas d'attribut « accept » : iOS grise les extensions qu'il ne connaît pas (.fit). Le contenu est vérifié à la lecture. */}
        <input ref={picker} type="file" multiple className="sr-only" tabIndex={-1} aria-hidden="true" onChange={(event) => void importPicked(event.currentTarget.files)} />
        <button type="button" className={ghostButton} disabled={busy !== null} onClick={() => picker.current?.click()}>
          <UploadIcon /> {busy === 'files' ? 'Import en cours…' : 'Importer des fichiers .FIT'}
        </button>
        <button type="button" className={ghostButton} disabled={busy !== null || !hasKey} onClick={() => void syncGarmin()}
          title={hasKey ? undefined : 'Ajoute d’abord ta clé Garmin dans l’onglet Profil'}>
          <SyncIcon /> {busy === 'garmin' ? 'Connexion à Garmin…' : 'Synchroniser Garmin'}
        </button>
      </div>
      {!hasKey ? <p className="mt-1.5 text-xs text-mute">Synchronisation Garmin : ajoute ta clé d’API personnelle dans l’onglet Profil pour l’essayer.</p> : null}

      {notice !== null ? (
        <div role={notice.tone === 'problem' ? 'alert' : 'status'}
          className={`mt-2 rounded-lg border px-3 py-2 text-sm ${notice.tone === 'problem' ? 'border-racing bg-racing/10' : 'border-line bg-raised/60'}`}>
          <p className="font-semibold text-ink">{notice.title}</p>
          <p className="mt-0.5 text-xs leading-relaxed text-mute">{notice.body}</p>
        </div>
      ) : null}

      {outcome !== null ? (
        <div role="status" className="mt-2 rounded-lg border border-line bg-raised/60 px-3 py-2">
          <div className="flex items-start gap-2">
            <p className="flex-1 text-sm text-ink tabular-nums">
              <span className={`font-semibold ${outcome.counts.imported > 0 ? 'text-done' : ''}`}>{plural(outcome.counts.imported, 'activité importée', 'activités importées')}</span>
              {outcome.counts.updated > 0 ? `, ${plural(outcome.counts.updated, 'mise à jour', 'mises à jour')}` : ''}
              {outcome.counts.unchanged > 0 ? `, ${plural(outcome.counts.unchanged, 'déjà présente, ignorée', 'déjà présentes, ignorées')}` : ''}
              {outcome.counts.failed > 0 ? `, ${plural(outcome.counts.failed, 'fichier refusé', 'fichiers refusés')}` : ''}.
              {outcome.matched > 0 ? ` ${plural(outcome.matched, 'séance prévue rapprochée', 'séances prévues rapprochées')} automatiquement.` : ''}
            </p>
            <button type="button" className={`${iconButton} -my-1.5 -mr-2`} aria-label="Fermer le compte rendu" onClick={() => setOutcome(null)}><CloseIcon /></button>
          </div>
          {failures.length > 0 ? (
            <ul className="mt-1 space-y-0.5 text-xs text-mute">
              {failures.map((report, i) => report.ok ? null : (
                <li key={`${report.file}-${i}`}><span className="font-medium text-ink">{report.file}</span> : {FAILURE_TEXT[report.reason]}{report.detail !== undefined ? ` (${report.detail})` : ''}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
