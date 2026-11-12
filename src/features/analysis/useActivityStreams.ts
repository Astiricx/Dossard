// useActivityStreams.ts — charge les séries d'UNE activité, à l'ouverture de son analyse.
// Elles ne sont jamais dans le store : une saison entière pèserait des dizaines de mégaoctets en mémoire.
import { useEffect, useState } from 'react';
import type { ActivityId, ActivityStreams } from '../../domain/index.ts';
import { streamsReader } from '../../app/store.ts';

export type StreamsState =
  | { status: 'loading' }
  | { status: 'ready'; streams: ActivityStreams }
  | { status: 'absent' }          // activité importée sans ses séries
  | { status: 'error' };

export function useActivityStreams(id: ActivityId, hasStreams: boolean): StreamsState {
  const [state, setState] = useState<StreamsState>(hasStreams ? { status: 'loading' } : { status: 'absent' });
  useEffect(() => {
    if (!hasStreams) { setState({ status: 'absent' }); return; }
    let cancelled = false;
    setState({ status: 'loading' });
    streamsReader.read(id).then(
      (streams) => { if (!cancelled) setState(streams !== null && streams.timeS.length >= 2 ? { status: 'ready', streams } : { status: 'absent' }); },
      () => { if (!cancelled) setState({ status: 'error' }); },
    );
    return () => { cancelled = true; };
  }, [id, hasStreams]);
  return state;
}
