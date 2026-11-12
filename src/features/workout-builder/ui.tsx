// ui.tsx — petites briques d'interface partagées par le constructeur et le profil.
import { useState, type ReactNode } from 'react';
import type { Sport } from '../../domain/index.ts';
import { REST_COLOR, SPORT_COLORS, SPORT_LABELS } from './labels.ts';

const focusRing = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-racing';

export const card = 'carbon-card rounded-xl border border-line';
export const input =
  'h-10 w-full min-w-0 rounded-lg border border-line bg-raised px-3 text-base text-ink tabular-nums outline-none transition-colors ' +
  'placeholder:text-mute/60 hover:border-line-strong focus-visible:border-racing focus-visible:ring-2 focus-visible:ring-racing/35 sm:text-sm';
export const inputInvalid = 'border-racing ring-1 ring-racing/60';
export const ghostButton =
  'inline-flex h-10 items-center justify-center gap-1.5 rounded-lg border border-line bg-raised/60 px-3 text-sm font-medium text-ink ' +
  `transition-colors hover:border-racing/70 hover:bg-racing/10 active:bg-racing/20 disabled:pointer-events-none disabled:opacity-40 ${focusRing}`;
export const primaryButton =
  'inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-racing-deep px-5 text-sm font-semibold text-white ' +
  'shadow-[0_6px_20px_-8px_var(--color-racing)] transition-[background-color,transform] hover:bg-racing active:translate-y-px ' +
  `disabled:pointer-events-none disabled:bg-raised disabled:text-mute disabled:shadow-none ${focusRing}`;
export const iconButton =
  'inline-flex size-10 shrink-0 items-center justify-center rounded-lg text-mute transition-colors hover:bg-racing/10 hover:text-racing ' +
  `focus-visible:outline-2 focus-visible:outline-racing`;
export const fieldLabel = 'mb-1 block text-xs font-medium text-mute';
/** Chiffre de métrique : gros, à chasse fixe, bien contrasté. */
export const metric = 'font-semibold tabular-nums tracking-tight text-ink';
/** Onglet ou choix exclusif : rouge quand il est actif (aria-current="page" ou aria-pressed="true"). */
export const tab =
  'inline-flex h-10 items-center justify-center gap-1.5 rounded-lg border border-transparent px-3 text-sm font-medium text-mute transition-colors ' +
  'hover:bg-white/5 hover:text-ink aria-[current=page]:border-racing aria-[current=page]:bg-racing/15 aria-[current=page]:text-ink ' +
  `aria-pressed:border-racing aria-pressed:bg-racing/15 aria-pressed:text-ink ${focusRing}`;

interface ParsedFieldProps<T> {
  value: T;
  format: (value: T) => string;
  /** null : texte invalide. Le champ passe en erreur et la dernière valeur valide est conservée. */
  parse: (text: string) => T | null;
  onCommit: (value: T) => void;
  label: string;
  /** Unité affichée dans le champ, à droite. */
  suffix?: string;
  inputMode?: 'numeric' | 'decimal' | 'text';
  className?: string;
}

/**
 * Champ texte lié à une valeur typée. Chaque frappe valide est transmise aussitôt (le graphique
 * suit en temps réel) ; une frappe invalide n'est jamais transmise. À la sortie du champ, le texte
 * est réécrit dans son format canonique.
 */
export function ParsedField<T>({ value, format, parse, onCommit, label, suffix, inputMode = 'text', className = '' }: ParsedFieldProps<T>) {
  const [draft, setDraft] = useState<string | null>(null);     // null : le champ n'a pas le focus
  const invalid = draft !== null && parse(draft) === null;
  return (
    <label className={`relative block min-w-0 ${className}`}>
      <span className="sr-only">{label}</span>
      <input
        className={`${input} ${suffix ? 'pr-12' : ''} ${invalid ? inputInvalid : ''}`}
        value={draft ?? format(value)}
        inputMode={inputMode}
        autoComplete="off"
        aria-invalid={invalid}
        onFocus={(event) => { setDraft(format(value)); event.currentTarget.select(); }}
        onChange={(event) => {
          setDraft(event.currentTarget.value);
          const parsed = parse(event.currentTarget.value);
          if (parsed !== null) onCommit(parsed);
        }}
        onBlur={() => setDraft(null)}
      />
      {suffix ? <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-xs text-mute">{suffix}</span> : null}
    </label>
  );
}

interface SelectProps<T extends string> {
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  label: string;
  className?: string;
}
export function Select<T extends string>({ value, options, onChange, label, className = '' }: SelectProps<T>) {
  return (
    <label className={`block min-w-0 ${className}`}>
      <span className="sr-only">{label}</span>
      <select className={`${input} pr-8`} value={value} onChange={(event) => onChange(event.currentTarget.value as T)}>
        {options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
  );
}

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" className="size-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}
export const GripIcon = () => <Icon><path d="M9 6h.01M15 6h.01M9 12h.01M15 12h.01M9 18h.01M15 18h.01" strokeWidth="2.6" /></Icon>;
export const TrashIcon = () => <Icon><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12h10l1-12M9 7V4h6v3" /></Icon>;
export const CopyIcon = () => <Icon><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a1 1 0 0 1 1-1h9" /></Icon>;
export const PlusIcon = () => <Icon><path d="M12 5v14M5 12h14" /></Icon>;
export const ChevronLeftIcon = () => <Icon><path d="m15 5-7 7 7 7" /></Icon>;
export const ChevronRightIcon = () => <Icon><path d="m9 5 7 7-7 7" /></Icon>;
export const FlagIcon = () => <Icon><path d="M5 21V4M5 4h11l-2 4 2 4H5" /></Icon>;
export const CheckIcon = () => <Icon><path d="m5 12.5 4.5 4.5L19 7.5" strokeWidth="2.4" /></Icon>;
export const UploadIcon = () => <Icon><path d="M12 16V4M7 9l5-5 5 5M5 20h14" /></Icon>;
export const SyncIcon = () => <Icon><path d="M20 11a8 8 0 0 0-14.5-4M4 4v4h4M4 13a8 8 0 0 0 14.5 4M20 20v-4h-4" /></Icon>;
export const CloseIcon = () => <Icon><path d="M6 6l12 12M18 6 6 18" /></Icon>;

/** Badge de sport : pastille de couleur ET nom. `compact` : la pastille seule, le nom reste lu par les lecteurs d'écran. */
export function SportBadge({ sport, compact = false }: { sport: Sport | 'rest'; compact?: boolean }) {
  const color = sport === 'rest' ? REST_COLOR : SPORT_COLORS[sport];
  const label = sport === 'rest' ? 'Repos' : SPORT_LABELS[sport];
  if (compact) return <span className="inline-block size-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} role="img" aria-label={label} />;
  return (
    <span className="inline-flex h-6 shrink-0 items-center gap-1.5 rounded-full border px-2 text-xs font-medium text-ink"
      style={{ borderColor: `color-mix(in srgb, ${color} 55%, transparent)`, backgroundColor: `color-mix(in srgb, ${color} 14%, transparent)` }}>
      <span className="size-2 rounded-full" style={{ backgroundColor: color }} aria-hidden="true" />
      {label}
    </span>
  );
}
