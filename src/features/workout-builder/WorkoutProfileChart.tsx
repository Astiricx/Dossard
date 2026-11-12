// WorkoutProfileChart.tsx — le profil de la séance : une barre par étape, large comme sa durée,
// haute comme son intensité, colorée par zone.
//
// Pourquoi une aire en escalier plutôt qu'un BarChart : dans Recharts, toutes les barres d'un
// BarChart ont la même largeur. Ici la largeur EST l'information (20 min ≠ 1 min). Une aire
// « stepAfter » sur un axe numérique donne des barres de largeur exacte ; un dégradé horizontal à
// arrêts francs colore chaque étape ; des traits de la couleur du fond les séparent.
import { useId, useMemo } from 'react';
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { Sport } from '../../domain/index.ts';
import { describeTarget, ROLE_LABELS, ZONE_COLORS, ZONE_LABELS, zoneColor } from './labels.ts';
import { formatDistance, formatDuration } from './model/format.ts';
import { axisTicks, type ProfileSegment, type WorkoutProfile } from './model/profile.ts';
import { ZONES } from './model/zones.ts';

interface Datum { x: number; y: number; segment: ProfileSegment }

/**
 * Deux points par segment (début et juste avant la fin) : l'infobulle de Recharts s'accroche au
 * point le plus proche, et sans le second elle afficherait l'étape suivante sur la moitié droite
 * de chaque barre.
 */
function toChartData(profile: WorkoutProfile): Datum[] {
  const epsilon = profile.total / 4000;
  const last = profile.segments.length - 1;
  return profile.segments.flatMap((segment, i) => {
    const y = Math.round(segment.intensity * 1000) / 10;
    return [{ x: segment.x0, y, segment }, { x: i === last ? segment.x1 : segment.x1 - epsilon, y, segment }];
  });
}

interface Props {
  profile: WorkoutProfile;
  sport: Sport;
}

export function WorkoutProfileChart({ profile, sport }: Props) {
  const gradientId = `profil-${useId().replace(/[^a-zA-Z0-9]/g, '')}`;
  const data = useMemo(() => toChartData(profile), [profile]);
  const ticks = useMemo(() => axisTicks(profile.total, profile.axis), [profile.total, profile.axis]);

  if (profile.segments.length === 0 || !(profile.total > 0)) {
    return (
      <div className="flex h-56 items-center justify-center rounded-lg border border-dashed border-line text-sm text-mute">
        Ajoute un bloc pour voir le profil de la séance.
      </div>
    );
  }

  const yMax = Math.max(120, Math.ceil((profile.maxIntensity * 100 + 5) / 20) * 20);
  const formatX = (value: number): string => (profile.axis === 'time' ? formatDuration(value) : formatDistance(value));
  const axisTick = { fill: 'var(--wb-muted)', fontSize: 11 };

  return (
    <figure className="[--wb-grid:var(--color-line)] [--wb-muted:var(--color-mute)] [--wb-surface:var(--color-panel)]">
      <div className="h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="0">
                {profile.segments.flatMap((segment) => {
                  const color = zoneColor(segment.zone);
                  const opacity = segment.approximateWidth || !segment.resolved ? 0.5 : 1;
                  return [
                    <stop key={`${segment.key}-a`} offset={segment.x0 / profile.total} stopColor={color} stopOpacity={opacity} />,
                    <stop key={`${segment.key}-b`} offset={segment.x1 / profile.total} stopColor={color} stopOpacity={opacity} />,
                  ];
                })}
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="var(--wb-grid)" />
            <XAxis dataKey="x" type="number" domain={[0, profile.total]} ticks={ticks} tickFormatter={formatX}
              tick={axisTick} axisLine={{ stroke: 'var(--wb-grid)' }} tickLine={false} />
            <YAxis type="number" domain={[0, yMax]} width={44} tickFormatter={(value: number) => `${value} %`}
              tick={axisTick} axisLine={false} tickLine={false} />
            <Tooltip isAnimationActive={false} cursor={{ stroke: 'var(--wb-muted)', strokeDasharray: '3 3' }}
              content={(tip: { active?: boolean; payload?: readonly { payload?: Datum }[] }) => {
                const segment = tip.active ? tip.payload?.[0]?.payload?.segment : undefined;
                return segment ? <SegmentTooltip segment={segment} sport={sport} /> : null;
              }} />
            <Area type="stepAfter" dataKey="y" stroke="none" fill={`url(#${gradientId})`} fillOpacity={1}
              isAnimationActive={false} activeDot={false} />
            <ReferenceLine y={100} stroke="var(--wb-muted)" strokeDasharray="4 4"
              label={{ value: 'Seuil', position: 'insideTopRight', fill: 'var(--wb-muted)', fontSize: 11 }} />
            {profile.boundaries.map((x) => <ReferenceLine key={x} x={x} stroke="var(--wb-surface)" strokeWidth={2} />)}
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="mt-2 space-y-1.5 text-xs text-mute">
        <ul className="flex flex-wrap gap-x-3 gap-y-1">
          {ZONES.map((zone) => (
            <li key={zone} className="flex items-center gap-1.5">
              <span className="size-2.5 rounded-sm" style={{ backgroundColor: ZONE_COLORS[zone] }} />
              Z{zone}{zone === 5 ? '+' : ''} {ZONE_LABELS[zone]}
            </li>
          ))}
        </ul>
        <p>
          {profile.axis === 'time' ? 'Horizontal : temps.' : 'Horizontal : distance.'} Vertical : intensité en % du seuil.
          {profile.approximate ? ' Barres estompées : largeur indicative, la durée de l’étape n’est pas connue.' : ''}
        </p>
      </figcaption>
    </figure>
  );
}

function SegmentTooltip({ segment, sport }: { segment: ProfileSegment; sport: Sport }) {
  const size = [
    segment.seconds !== null ? formatDuration(segment.seconds) : null,
    segment.meters !== null ? formatDistance(segment.meters) : null,
  ].filter((part) => part !== null).join(', ');
  return (
    <div className="rounded-lg border border-line-strong bg-raised px-3 py-2 text-xs shadow-xl">
      <p className="font-semibold text-ink">
        {segment.label ?? ROLE_LABELS[segment.role]}
        {segment.repeat ? <span className="font-normal text-mute"> ({segment.repeat.index + 1} sur {segment.repeat.count})</span> : null}
      </p>
      <p className="text-mute">{size || 'Durée libre'}</p>
      <p className="text-mute">{describeTarget(segment.target, sport)}</p>
      <p className="mt-1 flex items-center gap-1.5 text-mute">
        <span className="size-2.5 rounded-sm" style={{ backgroundColor: zoneColor(segment.zone) }} />
        {segment.zone === null ? 'Zone inconnue : seuil manquant' : `Z${segment.zone} ${ZONE_LABELS[segment.zone]}`}
      </p>
    </div>
  );
}
