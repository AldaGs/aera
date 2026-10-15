import { useId, type CSSProperties } from 'react';
import type { Sport } from '@/model/workout';

type FigureProps = { size?: number | string; className?: string; style?: CSSProperties };

// Two-segment limb: upper swings at the joint, lower bends at the elbow/knee (CSS in styles.css).
const Limb = ({ x, y, a, b, cls }: { x: number; y: number; a: number; b: number; cls: string }) => (
  <g className={`lu ${cls}`} style={{ transformOrigin: `${x}px ${y}px` }}>
    <line x1={x} y1={y} x2={x} y2={y + a} />
    <g className="ll" style={{ transformOrigin: `${x}px ${y + a}px` }}>
      <line x1={x} y1={y + a} x2={x} y2={y + a + b} />
    </g>
  </g>
);

function Figure({ sport, size = 24, className = '', style }: FigureProps & { sport: Sport }) {
  // Strokes are drawn into a mask and painted once, so overlapping limbs don't
  // stack alpha when currentColor is translucent (e.g. --muted).
  const mask = `fig${useId().replace(/:/g, '')}`;
  return (
    <svg
      viewBox="0 0 24 24" width={size} height={size} style={style} aria-hidden
      className={`sport-icon sport-${sport} ${className}`}
    >
      <mask id={mask} maskUnits="userSpaceOnUse" x={-6} y={-6} width={36} height={36}>
        <g fill="none" stroke="#fff" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
          {sport === 'ride' ? (
            <>
              <g className="wheel" style={{ transformOrigin: '5px 18px' }}><circle cx={5} cy={18} r={3.5} strokeWidth={1.8} /><line x1={5} y1={14.5} x2={5} y2={21.5} strokeWidth={1.2} /></g>
              <g className="wheel" style={{ transformOrigin: '19px 18px' }}><circle cx={19} cy={18} r={3.5} strokeWidth={1.8} /><line x1={19} y1={14.5} x2={19} y2={21.5} strokeWidth={1.2} /></g>
              <polyline points="5,18 10,12 16,12 19,18" strokeWidth={1.6} />
              <circle cx={15.5} cy={3.2} r={2.4} fill="#fff" stroke="none" />
              <line x1={10} y1={10.5} x2={13.5} y2={6.5} strokeWidth={3.4} />
              <polyline points="13.5,7 16.5,8.5 17,11" />
              <Limb x={10} y={10.5} a={4} b={4.5} cls="leg-a" />
              <Limb x={10} y={10.5} a={4} b={4.5} cls="leg-b" />
            </>
          ) : (
            <g className="body">
              <circle cx={12.8} cy={3} r={2.6} fill="#fff" stroke="none" />
              <Limb x={12.3} y={8} a={3.2} b={3} cls="arm-b" />
              <Limb x={11.8} y={13} a={4.6} b={4.4} cls="leg-b" />
              <line x1={12.3} y1={7.6} x2={11.8} y2={13} strokeWidth={3.6} />
              <Limb x={11.8} y={13} a={4.6} b={4.4} cls="leg-a" />
              <Limb x={12.3} y={8} a={3.2} b={3} cls="arm-a" />
            </g>
          )}
        </g>
      </mask>
      <rect x={-6} y={-6} width={36} height={36} fill="currentColor" mask={`url(#${mask})`} />
    </svg>
  );
}

const Run = (p: FigureProps) => <Figure sport="run" {...p} />;
const Walk = (p: FigureProps) => <Figure sport="walk" {...p} />;
const Ride = (p: FigureProps) => <Figure sport="ride" {...p} />;

/** One icon set for sports everywhere (feed, plans, stats, detail, toggles). */
export const SPORT_ICON = { run: Run, walk: Walk, ride: Ride } as const;

export function SportIcon({ sport, ...props }: { sport: Sport } & FigureProps) {
  const Cmp = SPORT_ICON[sport] ?? Run;
  return <Cmp {...props} />;
}
