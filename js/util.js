// util.js — petites fonctions sans état : dates, formats, texte.
// Les dates sont partout des chaînes "AAAA-MM-JJ" (faciles à trier et à comparer).

export const JOURS = ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.'];
export const JOURS_LONGS = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
export const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const MOIS_COURTS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const p2 = n => String(n).padStart(2, '0');

// --- Dates ---
export const versISO = d => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
export const versDate = iso => { const [a, m, j] = iso.split('-').map(Number); return new Date(a, m - 1, j); };
export const aujourdhui = () => versISO(new Date());
export const ajouterJours = (iso, n) => { const d = versDate(iso); d.setDate(d.getDate() + n); return versISO(d); };
export const indexJour = iso => (versDate(iso).getDay() + 6) % 7;           // 0 = lundi
export const lundiDe = iso => ajouterJours(iso, -indexJour(iso));
export const ecartJours = (a, b) => Math.round((versDate(b) - versDate(a)) / 864e5); // b - a
export const dateCourte = iso => { const d = versDate(iso); return `${d.getDate()} ${MOIS_COURTS[d.getMonth()]}`; };
export const dateLongue = iso => { const d = versDate(iso); return `${JOURS_LONGS[indexJour(iso)]} ${d.getDate()} ${MOIS[d.getMonth()]} ${d.getFullYear()}`; };
export const plageSemaine = lundi => `${dateCourte(lundi)} – ${dateCourte(ajouterJours(lundi, 6))}`;

// --- Formats ---
export const duree = min => { min = Math.round(min || 0); return min < 60 ? `${min} min` : `${Math.floor(min / 60)} h ${p2(min % 60)}`; };
export const virgule = (v, dec = 1) => (Math.round(v * 10 ** dec) / 10 ** dec).toString().replace('.', ',');
export const km = v => `${virgule(v)} km`;
export const allure = (min, dist) => {                                    // minutes + km -> "4'32/km"
  if (!min || !dist) return '';
  const s = Math.round(min * 60 / dist);
  return `${Math.floor(s / 60)}'${p2(s % 60)}/km`;
};
export const chrono = sec => {                                            // secondes -> "39:30" ou "1:36:14"
  sec = Math.round(sec); const h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60;
  return h ? `${h}:${p2(m)}:${p2(s)}` : `${m}:${p2(s)}`;
};
export const versSecondes = texte => {                                    // "39:30" -> 2370 (null si illisible)
  const t = String(texte || '').trim().split(':').map(Number);
  if (t.length < 2 || t.some(isNaN)) return null;
  return t.reduce((total, v) => total * 60 + v, 0);
};

// --- Divers ---
export const nombre = v => { const n = parseFloat(String(v ?? '').replace(',', '.')); return isFinite(n) ? n : null; };
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
export const somme = (liste, f = x => x) => liste.reduce((t, x) => t + (f(x) || 0), 0);
