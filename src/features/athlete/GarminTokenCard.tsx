// GarminTokenCard.tsx — saisie du token personnel Garmin.
// Le token est un secret : il reste dans la base locale de ce navigateur (réglages), n'apparaît
// jamais dans le code compilé, et n'est réaffiché que sous forme masquée.
import { useState } from 'react';
import { checkRelay, cleanRelayUrl, RELAY_CHECK_TEXT } from '../import/garmin/client.ts';
import { useApp } from '../../app/store.ts';
import { card, fieldLabel, ghostButton, input, inputInvalid, primaryButton } from '../workout-builder/ui.tsx';

/** null si le texte ne peut pas être un token : vide, avec des espaces, ou démesuré. */
export function cleanToken(text: string): string | null {
  const token = text.trim();
  return token.length >= 8 && token.length <= 512 && !/\s/.test(token) ? token : null;
}
/** « ••••••••a1b2 » : assez pour reconnaître son token, pas assez pour le recopier. */
export const maskToken = (token: string): string => `••••••••${token.slice(-4)}`;

export function GarminTokenCard() {
  const stored = useApp((s) => s.settings.garminToken);
  const saveSettings = useApp((s) => s.actions.saveSettings);
  const [text, setText] = useState('');
  const [visible, setVisible] = useState(false);
  const token = cleanToken(text);
  const invalid = text.trim() !== '' && token === null;

  return (
    <section className={`${card} mx-auto max-w-2xl space-y-3 p-4`}>
      <h2 className="text-base font-semibold text-ink">Token Garmin personnel (clé d’API)</h2>
      <p className="text-sm text-mute" role="status">
        {stored !== undefined ? <>Token enregistré sur cet appareil : <span className="font-medium text-ink tabular-nums">{maskToken(stored)}</span></> : 'Aucun token enregistré.'}
      </p>
      <label className="block">
        <span className={fieldLabel}>{stored !== undefined ? 'Remplacer le token' : 'Coller le token'}</span>
        <div className="flex gap-2">
          <input className={`${input} ${invalid ? inputInvalid : ''}`} type={visible ? 'text' : 'password'} value={text}
            autoComplete="off" autoCapitalize="off" spellCheck={false} aria-invalid={invalid}
            onChange={(event) => setText(event.currentTarget.value)} />
          <button type="button" className={ghostButton} aria-pressed={visible} onClick={() => setVisible(!visible)}>{visible ? 'Masquer' : 'Afficher'}</button>
        </div>
        {invalid ? <span className="mt-1 block text-xs text-racing">Un token fait au moins 8 caractères, sans espace.</span> : null}
      </label>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={primaryButton} disabled={token === null}
          onClick={() => { if (token !== null) { saveSettings({ garminToken: token }); setText(''); setVisible(false); } }}>
          Enregistrer le token
        </button>
        {stored !== undefined ? <button type="button" className={ghostButton} onClick={() => saveSettings({ garminToken: undefined })}>Supprimer le token</button> : null}
      </div>
      <RelayField />
      <ul className="list-disc space-y-1 pl-5 text-xs text-mute">
        <li>Il est stocké uniquement dans ce navigateur, avec tes autres données. Il n'est écrit dans aucun fichier du projet.</li>
        <li>C’est la « clé d’API personnelle » créée dans Garmin Connect (Paramètres). L’application l’échange contre un jeton valable 24 h à chaque synchronisation.</li>
        <li>Elle est vérifiée au moment de « Synchroniser Garmin », dans l’onglet Calendrier. Elle n’est jamais incluse dans une sauvegarde.</li>
        <li>Elle transite par ton relais à chaque synchronisation. Le relais la transmet à Garmin sans la conserver.</li>
        <li>Pense à retirer <code className="text-ink">VITE_GARMIN_PERSONAL_TOKEN</code> de ton fichier <code className="text-ink">.env.local</code>.</li>
      </ul>
    </section>
  );
}

type RelayStatus = { tone: 'ok' | 'problem'; text: string } | null;

/** Adresse du micro-relais Cloudflare, et un bouton pour vérifier qu'il répond et accepte cette page. */
function RelayField() {
  const stored = useApp((s) => s.settings.garminRelayUrl);
  const saveSettings = useApp((s) => s.actions.saveSettings);
  const [text, setText] = useState(stored ?? '');
  const [status, setStatus] = useState<RelayStatus>(null);
  const [checking, setChecking] = useState(false);
  const url = cleanRelayUrl(text);
  const invalid = text.trim() !== '' && url === null;
  const changed = url !== (stored ?? null);

  const test = async (): Promise<void> => {
    if (url === null) return;
    setChecking(true); setStatus(null);
    const result = await checkRelay(url, (input, init) => fetch(input, init));
    setStatus(result.ok ? { tone: 'ok', text: 'Le relais répond et accepte cette page. La synchronisation peut passer par lui.' } : { tone: 'problem', text: RELAY_CHECK_TEXT[result.problem] });
    setChecking(false);
  };

  return (
    <div className="space-y-2 border-t border-line pt-3">
      <label className="block">
        <span className={fieldLabel}>Adresse du relais Cloudflare</span>
        <input className={`${input} ${invalid ? inputInvalid : ''}`} type="url" inputMode="url" value={text} placeholder="https://dossard-relais.ton-compte.workers.dev"
          autoComplete="off" autoCapitalize="off" spellCheck={false} aria-invalid={invalid}
          onChange={(event) => { setText(event.currentTarget.value); setStatus(null); }} />
        {invalid ? <span className="mt-1 block text-xs text-racing">Colle l’adresse complète, qui commence par https://.</span> : null}
      </label>
      <div className="flex flex-wrap gap-2">
        <button type="button" className={primaryButton} disabled={url === null || !changed}
          onClick={() => { if (url !== null) { saveSettings({ garminRelayUrl: url }); setText(url); } }}>
          Enregistrer l’adresse
        </button>
        <button type="button" className={ghostButton} disabled={url === null || checking} onClick={() => void test()}>
          {checking ? 'Test en cours…' : 'Tester le relais'}
        </button>
        {stored !== undefined ? (
          <button type="button" className={ghostButton} onClick={() => { saveSettings({ garminRelayUrl: undefined }); setText(''); setStatus(null); }}>Retirer le relais</button>
        ) : null}
      </div>
      {status !== null ? (
        <p role={status.tone === 'problem' ? 'alert' : 'status'} className={`text-xs ${status.tone === 'ok' ? 'text-done' : 'text-racing'}`}>{status.text}</p>
      ) : null}
    </div>
  );
}
