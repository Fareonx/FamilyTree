import { useMemo, useState } from 'react';
import type { FamilyGraph } from '../lib/graph';
import { relations } from '../lib/kinship';
import { displayName, isUnnamed, lifeSpan } from '../lib/names';
import { useI18n, type TKey } from '../i18n';
import { relationSummary } from './Kinship';
import { searchPersons } from './PersonPicker';

type Filter = 'all' | 'noPhoto' | 'noDates' | 'unnamed' | 'double';
const FILTERS: Array<[Filter, TKey]> = [
  ['all', 'filterAll'],
  ['noPhoto', 'filterNoPhoto'],
  ['noDates', 'filterNoDates'],
  ['unnamed', 'filterUnnamed'],
  ['double', 'filterDouble'],
];

export function PeopleList(props: { graph: FamilyGraph; homeId: string | null; onOpen(id: string): void }) {
  const { t, lang } = useI18n();
  const { graph, homeId } = props;
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');

  const rows = useMemo(() => {
    const list = searchPersons(graph, q, 100000).filter((p) => {
      switch (filter) {
        case 'noPhoto':
          return !p.photo_path;
        case 'noDates':
          return !p.birth_date;
        case 'unnamed':
          return isUnnamed(p);
        case 'double':
          return !!homeId && relations(graph, homeId, p.id).filter((r) => r.type === 'blood').length > 1;
        default:
          return true;
      }
    });
    return list
      .map((p) => ({ p, rel: homeId && graph.person(homeId) ? relationSummary(graph, homeId, p.id, lang) : '' }))
      .sort((a, b) => displayName(a.p).localeCompare(displayName(b.p), 'az'));
  }, [graph, q, filter, homeId, lang]);

  return (
    <div className="people">
      <div className="people-toolbar">
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('search')} />
        <div className="chips">
          {FILTERS.map(([f, label]) => (
            <button key={f} className={filter === f ? 'chip active' : 'chip'} onClick={() => setFilter(f)}>
              {t(label)}
            </button>
          ))}
        </div>
        <span className="muted small">
          {t('total')}: {rows.length}
        </span>
      </div>
      <table className="people-table">
        <thead>
          <tr>
            <th>{t('colName')}</th>
            <th>{t('colYears')}</th>
            {homeId && <th>{t('colRelation')}</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map(({ p, rel }) => (
            <tr key={p.id} onClick={() => props.onOpen(p.id)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && props.onOpen(p.id)}>
              <td>
                <span className={`dot dot-${p.gender}`} />
                {displayName(p)}
                {p.maiden_name && <span className="muted"> ({p.maiden_name})</span>}
              </td>
              <td className="muted">{lifeSpan(p)}</td>
              {homeId && <td className="muted">{rel}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
