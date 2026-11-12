// profile.ts — transforme les blocs d'une séance en segments prêts à dessiner. Fonction pure :
// le graphique n'a plus qu'à tracer, et toute la logique se teste sans navigateur.
import type { Athlete, BlockId, IntensityTarget, ResolvedThresholds, Sport, StepBlock, StepRole, WorkoutDefinition } from '../../../domain/index.ts';
import { DEFAULT_CONFIG, stepIntensity, type EngineConfig } from '../../../engine/index.ts';
import { targetOnBasis, zoneModelFor, zoneOfValue, type ZoneIndex } from './zones.ts';

/** Une rampe est dessinée en escalier fin : chaque marche prend la couleur de SA zone. */
const RAMP_SLICES = 8;
/** Largeur d'une étape « jusqu'à l'appui sur lap » : arbitraire, signalée comme telle. */
const OPEN_WIDTH_S = 300;
/** Vitesse supposée pour donner une largeur à une distance sans vitesse seuil connue. Affichage seul. */
const FALLBACK_SPEED_MPS: Record<Sport, number> = { run: 3, bike: 8, swim: 1, strength: 1, other: 2 };

export interface ProfileSegment {
  key: string;
  stepId: BlockId;
  /** Bloc de premier niveau qui contient l'étape (l'étape elle-même, ou sa répétition). */
  blockId: BlockId;
  role: StepRole;
  label?: string;
  target: IntensityTarget;
  repeat: { index: number; count: number } | null;
  x0: number;
  x1: number;
  /** Hauteur de la barre : intensité en fraction du seuil (1 = au seuil). */
  intensity: number;
  /** Fourchette de l'étape entière, en fraction du seuil. */
  low: number;
  high: number;
  /** false : cible non convertible (seuil manquant). La hauteur est alors indicative. */
  resolved: boolean;
  /** true : la largeur est supposée (étape libre, ou distance sans vitesse seuil). */
  approximateWidth: boolean;
  zone: ZoneIndex | null;
  seconds: number | null;
  meters: number | null;
}

export interface WorkoutProfile {
  axis: 'time' | 'distance';
  /** true si au moins une largeur est supposée. */
  approximate: boolean;
  total: number;
  maxIntensity: number;
  segments: readonly ProfileSegment[];
  /** Abscisses des frontières entre étapes (hors début et fin). */
  boundaries: readonly number[];
}

interface Occurrence {
  step: StepBlock;
  blockId: BlockId;
  repeat: ProfileSegment['repeat'];
  seconds: number | null;
  meters: number | null;
  low: number;
  high: number;
  resolved: boolean;
}

const lerp = (a: number, b: number, f: number): number => a + (b - a) * f;
const positive = (v: number): number | null => (Number.isFinite(v) && v > 0 ? v : null);

export function buildProfile(
  definition: Pick<WorkoutDefinition, 'sport' | 'blocks'>,
  th: ResolvedThresholds,
  zones: Athlete['zones'] = {},
  cfg: EngineConfig = DEFAULT_CONFIG,
): WorkoutProfile {
  const empty: WorkoutProfile = { axis: 'time', approximate: false, total: 0, maxIntensity: 0, segments: [], boundaries: [] };
  if (definition.sport === 'rest') return empty;
  const sport = definition.sport;
  const thresholdSpeed = sport === 'run' || sport === 'swim' ? th.bySport[sport]?.thresholdSpeedMps : undefined;

  const occurrences: Occurrence[] = [];
  const add = (step: StepBlock, blockId: BlockId, repeat: Occurrence['repeat']): void => {
    const intensity = stepIntensity(step, sport, th, cfg);
    const fallback = cfg.openIntensityByRole[step.role];
    const low = intensity?.low ?? fallback, high = intensity?.high ?? fallback;
    const speed = intensity !== null && thresholdSpeed !== undefined ? ((low + high) / 2) * thresholdSpeed : undefined;
    let seconds: number | null = null, meters: number | null = null;
    if (step.duration.kind === 'time') {
      seconds = positive(step.duration.seconds);
      meters = seconds !== null && speed !== undefined ? seconds * speed : null;
    } else if (step.duration.kind === 'distance') {
      meters = positive(step.duration.meters);
      seconds = meters !== null && speed !== undefined && speed > 0 ? meters / speed : null;
    }
    occurrences.push({ step, blockId, repeat, seconds, meters, low, high, resolved: intensity !== null });
  };
  for (const block of definition.blocks) {
    if (block.kind === 'step') { add(block, block.id, null); continue; }
    const count = Number.isFinite(block.count) ? Math.min(99, Math.max(1, Math.round(block.count))) : 1;
    for (let index = 0; index < count; index++) for (const step of block.steps) add(step, block.id, { index, count });
  }
  if (occurrences.length === 0) return empty;

  // Axe : le temps si chaque étape a une durée connue ; sinon la distance si chacune en a une ;
  // sinon le temps, avec des largeurs supposées pour les étapes qui n'en ont pas.
  const allTimed = occurrences.every((o) => o.seconds !== null);
  const axis: WorkoutProfile['axis'] = !allTimed && occurrences.every((o) => o.meters !== null) ? 'distance' : 'time';
  const custom = zoneModelFor(zones, sport);

  const segments: ProfileSegment[] = [];
  const boundaries: number[] = [];
  let x = 0, maxIntensity = 0, approximate = false;
  occurrences.forEach((o, n) => {
    const exact = axis === 'distance' ? o.meters : o.seconds;
    const width = exact ?? (o.meters !== null ? o.meters / FALLBACK_SPEED_MPS[sport] : OPEN_WIDTH_S);
    const approximateWidth = exact === null;
    approximate ||= approximateWidth;
    if (n > 0) boundaries.push(x);
    const own = targetOnBasis(o.step.target, sport, th);
    const ramp = o.step.profile === 'ramp' && o.low !== o.high;
    // Le moteur range toujours low ≤ high ; le sens de la rampe vient de l'ordre saisi dans la cible.
    const t = o.step.target;
    const descending = (t.kind === 'relative' || t.kind === 'absolute') && t.low > t.high;
    const slices = ramp ? RAMP_SLICES : 1;
    for (let j = 0; j < slices; j++) {
      const f = ramp ? (j + 0.5) / slices : 0.5;
      const intensity = lerp(o.low, o.high, descending ? 1 - f : f);
      const zone = own !== null ? zoneOfValue(own.basis, lerp(own.low, own.high, f), custom)
        : o.resolved ? zoneOfValue('ftp', intensity)       // RPE ou étape libre : lu sur l'échelle du seuil
        : null;
      segments.push({
        key: `${n}-${j}`, stepId: o.step.id, blockId: o.blockId, role: o.step.role, target: o.step.target, repeat: o.repeat,
        ...(o.step.label !== undefined ? { label: o.step.label } : {}),
        x0: x + (width * j) / slices, x1: x + (width * (j + 1)) / slices,
        intensity, low: o.low, high: o.high, resolved: o.resolved, approximateWidth, zone, seconds: o.seconds, meters: o.meters,
      });
      maxIntensity = Math.max(maxIntensity, intensity);
    }
    x += width;
  });
  return { axis, approximate, total: x, maxIntensity, segments, boundaries };
}

/** Zone dominante d'une étape, pour colorer sa carte dans la liste. */
export function stepZone(step: StepBlock, sport: Sport, th: ResolvedThresholds, zones: Athlete['zones'] = {}, cfg: EngineConfig = DEFAULT_CONFIG): ZoneIndex | null {
  const own = targetOnBasis(step.target, sport, th);
  if (own !== null) return zoneOfValue(own.basis, (own.low + own.high) / 2, zoneModelFor(zones, sport));
  const intensity = stepIntensity(step, sport, th, cfg);
  return intensity === null ? null : zoneOfValue('ftp', (intensity.low + intensity.high) / 2);
}

const TIME_STEPS_S = [30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 14400];
const DISTANCE_STEPS_M = [100, 200, 500, 1000, 2000, 5000, 10_000, 20_000, 50_000, 100_000];
/** Graduations rondes de l'axe horizontal : six au plus, toujours sur des valeurs lisibles. */
export function axisTicks(total: number, axis: WorkoutProfile['axis'], max = 6): number[] {
  if (!(total > 0)) return [0];
  const steps = axis === 'time' ? TIME_STEPS_S : DISTANCE_STEPS_M;
  const step = steps.find((s) => total / s <= max) ?? steps[steps.length - 1]!;
  const ticks: number[] = [];
  for (let v = 0; v <= total + 1e-9 && ticks.length <= 200; v += step) ticks.push(v);
  return ticks;
}
