import type { ReactNode } from 'react';
import type { IntensityTarget, ResolvedThresholds, Sport, StepRole } from '../../domain/index.ts';
import { describeTarget, MODE_LABELS } from './labels.ts';
import { formatPace, formatPercent, paceUnit, parsePace, parsePercent } from './model/format.ts';
import { defaultTarget, targetModeOf, targetModesFor, type TargetMode } from './model/presets.ts';
import { ParsedField, Select } from './ui.tsx';

interface Props {
  target: IntensityTarget;
  role: StepRole;
  sport: Sport;
  thresholds: ResolvedThresholds;
  onChange: (target: IntensityTarget) => void;
}

/**
 * Cible d'intensité : allure, % de FC max ou % de FTP, toujours sous forme de fourchette « de … à … ».
 * L'ordre saisi est conservé : sur une étape progressive, « de 60 à 80 » monte et « de 80 à 60 » descend.
 */
export function TargetEditor({ target, role, sport, thresholds, onChange }: Props) {
  const mode = targetModeOf(target);
  const modes = targetModesFor(sport);
  // Une cible sans saisie dédiée (RPE, watts, bpm, % FC seuil : venue d'un import) reste affichée
  // telle quelle ; choisir un mode la remplace.
  const options: { value: TargetMode | 'other'; label: string }[] = [
    ...(mode === null ? [{ value: 'other' as const, label: describeTarget(target, sport) }] : []),
    ...modes.map((value) => ({ value, label: MODE_LABELS[value] })),
  ];
  const switchMode = (next: TargetMode | 'other'): void => {
    if (next !== 'other' && next !== mode) onChange(defaultTarget(next, role, sport, thresholds));
  };

  return (
    <div className="grid grid-cols-2 gap-2">
      <Select label="Type de cible" value={mode ?? 'other'} options={options} onChange={switchMode} />
      {target.kind === 'absolute' && target.unit === 'mps' ? (
        <Range
          low={<ParsedField label={`Allure de départ ${paceUnit(sport)}`} value={target.low} format={(v) => formatPace(v, sport)}
            parse={(text) => parsePace(text, sport)} onCommit={(low) => onChange({ ...target, low })} />}
          high={<ParsedField label={`Allure d'arrivée ${paceUnit(sport)}`} value={target.high} format={(v) => formatPace(v, sport)}
            parse={(text) => parsePace(text, sport)} onCommit={(high) => onChange({ ...target, high })} />}
          unit={paceUnit(sport)}
        />
      ) : target.kind === 'relative' && mode !== null ? (
        <Range
          low={<ParsedField label="Pourcentage bas" value={target.low} format={formatPercent} parse={parsePercent}
            onCommit={(low) => onChange({ ...target, low })} inputMode="decimal" />}
          high={<ParsedField label="Pourcentage haut" value={target.high} format={formatPercent} parse={parsePercent}
            onCommit={(high) => onChange({ ...target, high })} inputMode="decimal" />}
          unit="%"
        />
      ) : (
        <p className="flex h-10 items-center text-xs text-mute">{mode === 'open' ? 'Aux sensations' : 'Cible importée'}</p>
      )}
    </div>
  );
}

function Range({ low, high, unit }: { low: ReactNode; high: ReactNode; unit: string }) {
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      {low}
      <span className="text-xs text-mute">à</span>
      {high}
      <span className="shrink-0 text-xs text-mute">{unit}</span>
    </div>
  );
}
