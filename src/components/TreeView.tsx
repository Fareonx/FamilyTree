import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { select } from 'd3-selection';
import { zoom, zoomIdentity, type ZoomBehavior } from 'd3-zoom';
import type { FamilyGraph } from '../lib/graph';
import { CARD_H, CARD_W, type PlacedCard, type TreeLayout } from '../lib/layout';
import { displayName, lifeSpan } from '../lib/names';
import { useI18n } from '../i18n';

export interface TreeViewHandle {
  centerOn(personId: string, opts?: { flash?: boolean; zoomTo?: number }): void;
  fit(): void;
  zoomBy(k: number): void;
}

interface Props {
  layout: TreeLayout;
  graph: FamilyGraph;
  photoUrls: Map<string, string>;
  selectedId: string | null;
  homeId: string | null;
  onSelect(personId: string): void;
  onGhost(card: PlacedCard): void;
}

const PAD = 80;

export const TreeView = forwardRef<TreeViewHandle, Props>(function TreeView(
  { layout, graph, photoUrls, selectedId, homeId, onSelect, onGhost },
  ref,
) {
  const { t } = useI18n();
  const viewport = useRef<HTMLDivElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const zoomRef = useRef<ZoomBehavior<HTMLDivElement, unknown> | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const layoutRef = useRef(layout);
  layoutRef.current = layout;

  useEffect(() => {
    const vp = viewport.current;
    if (!vp) return;
    const z = zoom<HTMLDivElement, unknown>()
      .scaleExtent([0.08, 2.5])
      .filter((e: Event) => {
        // Let clicks on cards through; wheel and drag on the background pan/zoom.
        const ev = e as MouseEvent;
        return !ev.button && !(ev.type === 'dblclick');
      })
      .on('zoom', (e) => {
        if (stage.current) {
          const { x, y, k } = e.transform;
          stage.current.style.transform = `translate(${x}px, ${y}px) scale(${k})`;
        }
      });
    zoomRef.current = z;
    select(vp).call(z);
    return () => {
      select(vp).on('.zoom', null);
    };
  }, []);

  const transformTo = (x: number, y: number, k: number, animate = true) => {
    const vp = viewport.current;
    const z = zoomRef.current;
    if (!vp || !z) return;
    const target = zoomIdentity.translate(x, y).scale(k);
    const sel = select(vp);
    if (animate && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      // d3-transition is not bundled; animate by hand.
      const from = (vp as unknown as { __zoom?: { x: number; y: number; k: number } }).__zoom ?? zoomIdentity;
      const start = performance.now();
      const dur = 450;
      const step = (now: number) => {
        const p = Math.min(1, (now - start) / dur);
        const e = p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2;
        const k2 = from.k + (k - from.k) * e;
        sel.call(z.transform, zoomIdentity.translate(from.x + (x - from.x) * e, from.y + (y - from.y) * e).scale(k2));
        if (p < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    } else {
      sel.call(z.transform, target);
    }
  };

  const fit = (animate = true) => {
    const vp = viewport.current;
    const l = layoutRef.current;
    if (!vp || !l.cards.length) return;
    const w = l.width + PAD * 2;
    const h = l.height + PAD * 2;
    const k = Math.min(1, vp.clientWidth / w, vp.clientHeight / h);
    transformTo((vp.clientWidth - l.width * k) / 2, (vp.clientHeight - l.height * k) / 2, k, animate);
  };

  const centerOn: TreeViewHandle['centerOn'] = (personId, opts = {}) => {
    const vp = viewport.current;
    const pos = layoutRef.current.primary.get(personId);
    if (!vp || !pos) return;
    const current = (vp as unknown as { __zoom?: { k: number } }).__zoom?.k ?? 1;
    const k = opts.zoomTo ?? Math.max(current, 0.8);
    transformTo(vp.clientWidth / 2 - (pos.x + CARD_W / 2) * k, vp.clientHeight / 2 - (pos.y + CARD_H / 2) * k, k);
    if (opts.flash) {
      setFlash(personId);
      setTimeout(() => setFlash((f) => (f === personId ? null : f)), 1800);
    }
  };

  useImperativeHandle(ref, () => ({
    centerOn,
    fit: () => fit(true),
    zoomBy: (factor: number) => {
      const vp = viewport.current;
      if (vp && zoomRef.current) select(vp).call(zoomRef.current.scaleBy, factor);
    },
  }));

  return (
    <div className="tree-viewport" ref={viewport}>
      <div className="tree-stage" ref={stage} style={{ width: layout.width, height: layout.height }}>
        <svg className="tree-edges" width={layout.width + 2} height={layout.height + 2}>
          {layout.edges.map((e) => (
            <polyline
              key={e.key}
              points={e.points.map((p) => p.join(',')).join(' ')}
              className={`edge edge-${e.kind}${e.dashed ? ' edge-dashed' : ''}`}
            />
          ))}
        </svg>
        {layout.cards.map((c) => (
          <Card
            key={c.key}
            card={c}
            graph={graph}
            photoUrls={photoUrls}
            selected={'personId' in c.ref && c.ref.personId === selectedId}
            home={'personId' in c.ref && c.ref.personId === homeId}
            flash={'personId' in c.ref && c.ref.personId === flash}
            double={'personId' in c.ref && (layout.occurrences.get(c.ref.personId) ?? 0) > 1}
            linkLabel={t('link')}
            ghostLabel={t('unknownPerson')}
            onClick={() => {
              if (c.ref.kind === 'ghost') onGhost(c);
              else if (c.ref.kind === 'link') {
                onSelect(c.ref.personId);
                centerOn(c.ref.personId, { flash: true });
              } else onSelect(c.ref.personId);
            }}
          />
        ))}
      </div>
    </div>
  );
});

function Card(props: {
  card: PlacedCard;
  graph: FamilyGraph;
  photoUrls: Map<string, string>;
  selected: boolean;
  home: boolean;
  flash: boolean;
  double: boolean;
  linkLabel: string;
  ghostLabel: string;
  onClick(): void;
}) {
  const { card, graph, photoUrls, selected, home, flash, double, onClick } = props;
  const style = { left: card.x, top: card.y, width: CARD_W, height: CARD_H };
  if (card.ref.kind === 'ghost') {
    return (
      <button className="card card-ghost" style={style} onClick={onClick} title={props.ghostLabel}>
        <span className="ghost-q">?</span>
      </button>
    );
  }
  const p = graph.person(card.ref.personId);
  if (!p) return null;
  const isLink = card.ref.kind === 'link';
  const photo = p.photo_path ? photoUrls.get(p.photo_path) : undefined;
  const cls = [
    'card',
    `card-${p.gender}`,
    isLink && 'card-link',
    selected && 'card-selected',
    home && 'card-home',
    flash && 'card-flash',
    p.is_deceased || p.death_date ? 'card-deceased' : '',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <button className={cls} style={style} onClick={onClick} data-person={p.id}>
      <span className="avatar">
        {photo ? <img src={photo} alt="" loading="lazy" /> : <span className="avatar-initial">{(p.first_name ?? '?').slice(0, 1)}</span>}
      </span>
      <span className="card-text">
        <span className="card-name">{displayName(p)}</span>
        <span className="card-years">{isLink ? `🔗 ${props.linkLabel}` : lifeSpan(p)}</span>
      </span>
      {double && !isLink && <span className="badge-double" title="🔗">🔗</span>}
    </button>
  );
}
