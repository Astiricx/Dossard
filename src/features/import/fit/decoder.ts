// decoder.ts — SEUL fichier qui connaît @garmin/fitsdk. Le SDK est chargé à la demande (import
// dynamique) : il ne pèse sur le démarrage de l'application que le jour où l'on importe un fichier.
import type { FitDecoder, FitMessages } from './messages.ts';

export const decodeFit: FitDecoder = async (buffer) => {
  const { Decoder, Stream } = await import('@garmin/fitsdk');
  try {
    const decoder = new Decoder(Stream.fromArrayBuffer(buffer));
    if (!decoder.isFIT()) return { ok: false, reason: 'not_fit' };
    // Options explicites : le comportement ne dépend pas des valeurs par défaut d'une version du SDK.
    const { messages, errors } = decoder.read({
      applyScaleAndOffset: true, expandSubFields: true, expandComponents: true,
      convertTypesToStrings: true, convertDateTimesToDates: true, includeUnknownData: false, mergeHeartRates: true,
    });
    const decoded = messages as unknown as FitMessages;
    // Un fichier tronqué (montre débranchée pendant le transfert) reste exploitable si une session a été lue.
    if (errors.length > 0 && (decoded.sessionMesgs?.length ?? 0) === 0) {
      return { ok: false, reason: 'corrupt', detail: String(errors[0]) };
    }
    return { ok: true, messages: decoded };
  } catch (error) {
    return { ok: false, reason: 'corrupt', detail: error instanceof Error ? error.message : String(error) };
  }
};
