import type { FamilyGraph } from '../lib/graph';
import { describeLink, relations, type BloodLink, type Lang, type Relation } from '../lib/kinship';
import { shortName } from '../lib/names';
import { useI18n } from '../i18n';

/** Short label for lists: the closest relation, plus a marker when there is more than one line. */
export function relationSummary(graph: FamilyGraph, homeId: string, personId: string, lang: Lang): string {
  const rels = relations(graph, homeId, personId);
  const first = rels[0];
  if (!first) return '';
  const label = relationLabel(graph, first, lang);
  const lines = rels.filter((r) => r.type === 'blood').length;
  return lines > 1 ? `${label} (+${lines - 1})` : label;
}

function relationLabel(graph: FamilyGraph, r: Relation, lang: Lang): string {
  const ru = lang === 'ru';
  switch (r.type) {
    case 'self':
      return ru ? 'вы' : 'siz';
    case 'spouse':
      return ru ? 'супруг(а)' : 'həyat yoldaşı';
    case 'blood': {
      const w = describeLink(graph, r.link, lang);
      return w.side ? `${w.term}, ${w.side}` : w.term;
    }
    case 'spouse-of': {
      const w = describeLink(graph, r.link, lang);
      return ru ? `супруг(а): ${shortName(graph.person(r.via))} — ${w.term}` : `həyat yoldaşı: ${shortName(graph.person(r.via))} — ${w.term}`;
    }
    case 'spouse-relative': {
      const w = describeLink(graph, r.link, lang);
      return `${shortName(graph.person(r.via))}: ${w.term}`;
    }
  }
}

function PathNames({ graph, link, onSelect }: { graph: FamilyGraph; link: BloodLink; onSelect(id: string): void }) {
  // ego → … → ancestor(s) → … → target; the ancestral couple is shown together.
  const anc = link.ancestors;
  const up = link.egoPath.slice(0, -1);
  const down = link.targetPath.slice(1);
  const name = (id: string) => (
    <button key={id} className="path-name" onClick={() => onSelect(id)}>
      {shortName(graph.person(id))}
    </button>
  );
  return (
    <div className="path">
      {up.map((id) => [name(id), <span key={`${id}-a`} className="path-arrow">→</span>])}
      <span className="path-ancestor">
        {anc.every((id) => !graph.person(id))
          ? '?'
          : anc.filter((id) => graph.person(id)).map((id, i) => [i > 0 && <span key={`${id}-amp`}> & </span>, name(id)])}
      </span>
      {down.map((id) => [<span key={`${id}-a`} className="path-arrow">→</span>, name(id)])}
    </div>
  );
}

export function KinshipBox({ graph, homeId, personId, onSelect }: { graph: FamilyGraph; homeId: string; personId: string; onSelect(id: string): void }) {
  const { t, lang } = useI18n();
  const rels = relations(graph, homeId, personId);
  if (rels.length === 1 && rels[0].type === 'self') return <p className="muted">{t('self')}</p>;
  const blood = rels.filter((r) => r.type === 'blood');
  return (
    <div className="kinship">
      {blood.length > 1 && <div className="double-note">🔗 {t('doubleRelation')}: {blood.length}</div>}
      {!rels.length && <p className="muted">{t('noRelation')}</p>}
      <ul>
        {rels.map((r, i) => {
          if (r.type === 'self') return null;
          const kind = r.type === 'spouse' ? t('wifeOrHusband') : r.type === 'spouse-of' ? t('spouseOf') : r.type === 'spouse-relative' ? t('spouseRelative') : null;
          return (
            <li key={i} className={`rel rel-${r.type}`}>
              {kind && <div className="rel-kind">{kind}</div>}
              <div className="rel-term">{relationLabel(graph, r, lang)}</div>
              {'link' in r && <PathNames graph={graph} link={r.link} onSelect={onSelect} />}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
