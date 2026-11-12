// zip.ts — lecture minimale d'une archive ZIP, sans dépendance. Garmin Connect livre le « fichier
// d'origine » d'une activité dans un .zip : il faut l'ouvrir pour atteindre le .fit.
// Limites assumées : pas de ZIP64, pas de chiffrement. Méthodes 0 (stocké) et 8 (deflate) seulement.

export interface ZipEntry { name: string; bytes: Uint8Array }
export class ZipError extends Error {}

const EOCD = 0x06054b50, CENTRAL = 0x02014b50, LOCAL = 0x04034b50;

/** true si le contenu commence comme un ZIP (« PK\x03\x04 »), quelle que soit l'extension du fichier. */
export const looksLikeZip = (buffer: ArrayBuffer): boolean =>
  buffer.byteLength >= 4 && new DataView(buffer).getUint32(0, true) === LOCAL;

async function inflateRaw(data: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') throw new ZipError('Ce navigateur ne sait pas décompresser les archives ZIP.');
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Extrait les fichiers d'une archive. `keep` filtre par nom avant toute décompression. */
export async function unzip(buffer: ArrayBuffer, keep: (name: string) => boolean = () => true): Promise<ZipEntry[]> {
  const view = new DataView(buffer);
  // La table des matières est à la fin : on cherche sa signature en remontant (commentaire ≤ 65 535 octets).
  let eocd = -1;
  for (let i = buffer.byteLength - 22; i >= Math.max(0, buffer.byteLength - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === EOCD) { eocd = i; break; }
  }
  if (eocd === -1) throw new ZipError('Archive ZIP illisible : table des matières introuvable.');
  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder();
  const entries: ZipEntry[] = [];
  for (let n = 0; n < count; n++) {
    if (offset + 46 > buffer.byteLength || view.getUint32(offset, true) !== CENTRAL) throw new ZipError('Archive ZIP corrompue.');
    const method = view.getUint16(offset + 10, true);
    const compressedSize = view.getUint32(offset + 20, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const name = decoder.decode(new Uint8Array(buffer, offset + 46, nameLength));
    offset += 46 + nameLength + extraLength + commentLength;
    if (name.endsWith('/') || !keep(name)) continue;
    if (localOffset + 30 > buffer.byteLength || view.getUint32(localOffset, true) !== LOCAL) throw new ZipError('Archive ZIP corrompue.');
    const start = localOffset + 30 + view.getUint16(localOffset + 26, true) + view.getUint16(localOffset + 28, true);
    if (start + compressedSize > buffer.byteLength) throw new ZipError('Archive ZIP tronquée.');
    const data = new Uint8Array(buffer, start, compressedSize);
    if (method === 0) entries.push({ name, bytes: data.slice() });
    else if (method === 8) entries.push({ name, bytes: await inflateRaw(data) });
    else throw new ZipError(`Archive ZIP : méthode de compression ${method} non prise en charge.`);
  }
  return entries;
}
