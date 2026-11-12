// PmcChart.tsx — le graphique de gestion de la performance : condition physique et fatigue en
// aires, forme en courbe. Une seule échelle verticale : les trois sont dans la même unité (charge
// par jour), et la forme est la différence des deux autres.
import { Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { ISODate } from '../../domain/index.ts';
import { longDate, shortDate } from '../calendar/model/weeks.ts';
import type { PmcPoint } from './model/pmc.ts';

export const PMC_COLORS = { ctl: '#38BDF8', atl: '#EF4444', tsb: '#FBBF24' } as const;
export const PMC_LABELS = { ctl: 'Condition physique (CTL)', atl: 'Fatigue (ATL)', tsb: 'Forme (TSB)' } as const;
const SERIES = ['ctl', 'atl', 'tsb'] as const;
const signed = (value: number): string => `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(Math.round(value))}`;

export function PmcChart({ points, today }: { points: readonly PmcPoint[]; today: ISODate }) {
  const axisTick = { fill: 'var(--color-mute)', fontSize: 11 };
  const hasProjection = points.some((p) => p.ctl === null);
  const common = { dot: false, isAnimationActive: false, connectNulls: false, type: 'monotone' as const };

  return (
    <figure>
      <div className="h-72 w-full sm:h-96">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={points as PmcPoint[]} margin={{ top: 16, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--color-line)" />
            <XAxis dataKey="date" tickFormatter={(value: string) => shortDate(value as ISODate)} minTickGap={56}
              tick={axisTick} axisLine={{ stroke: 'var(--color-line)' }} tickLine={false} />
            <YAxis width={40} tick={axisTick} axisLine={false} tickLine={false} />
            <Tooltip isAnimationActive={false} cursor={{ stroke: 'var(--color-mute)', strokeDasharray: '3 3' }}
              content={(tip: { active?: boolean; payload?: readonly { payload?: PmcPoint }[] }) => {
                const point = tip.active ? tip.payload?.[0]?.payload : undefined;
                return point === undefined ? null : <PmcTooltip point={point} />;
              }} />
            <ReferenceLine y={0} stroke="var(--color-line-strong)" />
            <Area {...common} dataKey="ctl" stroke={PMC_COLORS.ctl} strokeWidth={2} fill={PMC_COLORS.ctl} fillOpacity={0.2} />
            <Area {...common} dataKey="atl" stroke={PMC_COLORS.atl} strokeWidth={2} fill={PMC_COLORS.atl} fillOpacity={0.14} />
            <Line {...common} dataKey="tsb" stroke={PMC_COLORS.tsb} strokeWidth={2} activeDot={{ r: 3 }} />
            {/* Projection d'après les séances prévues : mêmes couleurs, en pointillés, sans remplissage. */}
            <Line {...common} dataKey="ctlPlan" stroke={PMC_COLORS.ctl} strokeWidth={2} strokeDasharray="5 4" activeDot={false} />
            <Line {...common} dataKey="atlPlan" stroke={PMC_COLORS.atl} strokeWidth={2} strokeDasharray="5 4" activeDot={false} />
            <Line {...common} dataKey="tsbPlan" stroke={PMC_COLORS.tsb} strokeWidth={2} strokeDasharray="5 4" activeDot={false} />
            {hasProjection ? (
              <ReferenceLine x={today} stroke="var(--color-mute)" strokeDasharray="2 4" label={{ value: 'Aujourd’hui', position: 'insideTopLeft', fill: 'var(--color-mute)', fontSize: 11 }} />
            ) : null}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <figcaption className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-mute">
        {SERIES.map((key) => (
          <span key={key} className="flex items-center gap-1.5">
            <span className={key === 'tsb' ? 'h-0.5 w-4 rounded-full' : 'size-2.5 rounded-sm'} style={{ backgroundColor: PMC_COLORS[key] }} aria-hidden="true" />{PMC_LABELS[key]}
          </span>
        ))}
        {hasProjection ? <span className="flex items-center gap-1.5"><span className="w-4 border-t-2 border-dashed border-mute" aria-hidden="true" />Pointillés : projection si les séances prévues sont réalisées</span> : null}
      </figcaption>
    </figure>
  );
}

function PmcTooltip({ point }: { point: PmcPoint }) {
  const projected = point.ctl === null;
  const values = { ctl: point.ctl ?? point.ctlPlan, atl: point.atl ?? point.atlPlan, tsb: point.tsb ?? point.tsbPlan };
  return (
    <div className="rounded-lg border border-line-strong bg-raised px-3 py-2 text-xs shadow-xl">
      <p className="font-medium text-ink">{longDate(point.date)}{projected ? ' (projection)' : ''}</p>
      <p className="text-mute tabular-nums">{projected ? 'Charge prévue' : 'Charge du jour'} : <span className="font-semibold text-ink">{Math.round(point.load)}</span></p>
      <ul className="mt-1 space-y-0.5">
        {SERIES.map((key) => {
          const value = values[key];
          return value === null ? null : (
            <li key={key} className="flex items-center gap-1.5 text-mute tabular-nums">
              <span className="size-2 rounded-sm" style={{ backgroundColor: PMC_COLORS[key] }} aria-hidden="true" />
              {PMC_LABELS[key]}<span className="ml-auto pl-3 font-semibold text-ink">{key === 'tsb' ? signed(value) : Math.round(value)}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
