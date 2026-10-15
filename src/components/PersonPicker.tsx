import { useMemo, useState } from 'react';
import type { FamilyGraph } from '../lib/graph';
import { displayName, lifeSpan, normalizeForSearch } from '../lib/names';
import type { Person } from '../lib/types';

export function searchPersons(graph: FamilyGraph, query: string, limit = 30): Person[] {
  const q = normalizeForSearch(query.trim());
  const all = [...graph.persons.values()];
  if (!q) return all.slice(0, limit);
  const words = q.split(/\s+/);
  return all
    .filter((p) => {
      const hay = normalizeForSearch([p.first_name, p.last_name, p.maiden_name].filter(Boolean).join(' '));
      return words.every((w) => hay.includes(w));
    })
    .slice(0, limit);
}

/** Context line for a person in pickers: parents' names, so two "Leyla" can be told apart. */
export function personContext(graph: FamilyGraph, p: Person): string {
  const parents = graph.parentsOf(p.id).map((id) => graph.person(id)?.first_name || '???');
  const spouses = graph.spousesOf(p.id).map((id) => graph.person(id)?.first_name || '???');
  return [lifeSpan(p), parents.length ? `← ${parents.join(' + ')}` : '', spouses.length ? `⚭ ${spouses.join(', ')}` : '']
    .filter(Boolean)
    .join(' · ');
}

export function PersonPicker(props: {
  graph: FamilyGraph;
  exclude?: string[];
  placeholder: string;
  onPick(id: string): void;
  autoFocus?: boolean;
}) {
  const [q, setQ] = useState('');
  const results = useMemo(
    () => searchPersons(props.graph, q, 40).filter((p) => !props.exclude?.includes(p.id)),
    [props.graph, q, props.exclude],
  );
  return (
    <div className="picker">
      <input
        type="search"
        value={q}
        placeholder={props.placeholder}
        onChange={(e) => setQ(e.target.value)}
        autoFocus={props.autoFocus}
      />
      <ul className="picker-list">
        {results.map((p) => (
          <li key={p.id}>
            <button type="button" onClick={() => props.onPick(p.id)}>
              <span className="picker-name">{displayName(p)}</span>
              <span className="picker-ctx">{personContext(props.graph, p)}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
