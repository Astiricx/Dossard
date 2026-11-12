import type { BlockDuration, Sport } from '../../domain/index.ts';
import { formatDistance, formatDuration, parseDistance, parseDuration } from './model/format.ts';
import { ParsedField, Select } from './ui.tsx';

const KINDS = [
  { value: 'time', label: 'Temps' },
  { value: 'distance', label: 'Distance' },
  { value: 'open', label: 'Jusqu’au lap' },
] as const satisfies readonly { value: BlockDuration['kind']; label: string }[];

interface Props {
  duration: BlockDuration;
  sport: Sport;
  onChange: (duration: BlockDuration) => void;
}

/** Durée d'une étape : un temps, une distance, ou « jusqu'à l'appui sur le bouton lap ». */
export function DurationEditor({ duration, sport, onChange }: Props) {
  const switchKind = (kind: BlockDuration['kind']): void => {
    if (kind === duration.kind) return;
    onChange(kind === 'time' ? { kind, seconds: 300 } : kind === 'distance' ? { kind, meters: sport === 'swim' ? 100 : 1000 } : { kind });
  };
  return (
    <div className="grid grid-cols-2 gap-2">
      <Select label="Type de durée" value={duration.kind} options={KINDS} onChange={switchKind} />
      {duration.kind === 'time' ? (
        <ParsedField label="Durée (min:s)" value={duration.seconds} format={formatDuration} parse={parseDuration}
          onCommit={(seconds) => onChange({ kind: 'time', seconds })} inputMode="text" suffix="min:s" />
      ) : duration.kind === 'distance' ? (
        <ParsedField label="Distance" value={duration.meters} format={formatDistance} parse={(text) => parseDistance(text, sport)}
          onCommit={(meters) => onChange({ kind: 'distance', meters })} inputMode="text" />
      ) : (
        <p className="flex h-10 items-center text-xs text-mute">Durée libre</p>
      )}
    </div>
  );
}
