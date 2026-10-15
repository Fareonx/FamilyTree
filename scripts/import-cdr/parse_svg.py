"""Convert the CorelDRAW family tree (exported to SVG by LibreOffice) into JSON.

Usage:
    soffice --headless --convert-to svg Family_Tree.cdr
    python3 scripts/import-cdr/parse_svg.py family_tree.svg > raw.json

Boxes become people, line networks become couples and their children.
A network that only touches the tops of boxes (the yellow line) marks
two boxes that are the same person, so those boxes are merged.
Anything the drawing cannot express is fixed in overrides.json.
"""
import json
import re
import sys
from collections import defaultdict

TOL = 120  # drawing units (1/100 mm)

GROUP_RE = re.compile(r'<g class="(Group|TextShape|com\.sun\.star\.drawing\.[A-Za-z]+)">')


def parse(svg):
    boxes, lines, texts = [], [], []
    for m in re.finditer(r'<path fill="none" stroke="(rgb\([^)]*\))"[^>]*d="([^"]*)"', svg):
        color, d = m.groups()
        pts = [tuple(map(int, p.split(','))) for p in re.findall(r'-?\d+,-?\d+', d)]
        if d.strip().endswith('Z') and len(pts) >= 4:
            xs = [p[0] for p in pts]
            ys = [p[1] for p in pts]
            boxes.append({'x0': min(xs), 'y0': min(ys), 'x1': max(xs), 'y1': max(ys), 'color': color})
        else:
            for a, b in zip(pts, pts[1:]):
                if a != b:
                    lines.append({'a': a, 'b': b, 'color': color})
    for m in re.finditer(r'<text class="SVGTextShape">(.*?)</text>', svg, re.S):
        runs = re.findall(r'<tspan class="TextPosition" x="(-?\d+)" y="(-?\d+)">(.*?)</tspan></tspan>', m.group(1))
        parts = []
        for x, y, inner in runs:
            txt = ''.join(re.findall(r'>([^<]*)<', inner + '<')).strip()
            parts.append((int(x), int(y), txt))
        if parts:
            texts.append(parts)
    return boxes, lines, texts


def on_segment(p, a, b):
    (px, py), (ax, ay), (bx, by) = p, a, b
    if not (min(ax, bx) - TOL <= px <= max(ax, bx) + TOL and min(ay, by) - TOL <= py <= max(ay, by) + TOL):
        return False
    # lines are axis aligned in this drawing
    if abs(ax - bx) < TOL:
        return abs(px - ax) < TOL
    if abs(ay - by) < TOL:
        return abs(py - ay) < TOL
    return False


def close(p, q):
    return abs(p[0] - q[0]) < TOL and abs(p[1] - q[1]) < TOL


BLACK = 'rgb(27,25,24)'


def components(lines):
    parent = list(range(len(lines)))

    def find(i):
        while parent[i] != i:
            parent[i] = parent[parent[i]]
            i = parent[i]
        return i

    for i, li in enumerate(lines):
        for j in range(i + 1, len(lines)):
            lj = lines[j]
            joined = any(close(p, q) for p in (li['a'], li['b']) for q in (lj['a'], lj['b']))
            if not joined and (li['color'] == lj['color'] or BLACK in (li['color'], lj['color'])):
                joined = any(on_segment(p, lj['a'], lj['b']) for p in (li['a'], li['b'])) or \
                    any(on_segment(p, li['a'], li['b']) for p in (lj['a'], lj['b']))
            if joined:
                parent[find(i)] = find(j)
    groups = defaultdict(list)
    for i in range(len(lines)):
        groups[find(i)].append(lines[i])
    return list(groups.values())


def touch(p, box):
    x, y = p
    inside_x = box['x0'] - TOL <= x <= box['x1'] + TOL
    inside_y = box['y0'] - TOL <= y <= box['y1'] + TOL
    if not (inside_x and inside_y):
        return None
    if abs(y - box['y0']) < TOL:
        return 'top'
    if abs(y - box['y1']) < TOL:
        return 'bottom'
    if abs(x - box['x0']) < TOL or abs(x - box['x1']) < TOL:
        return 'side'
    return None


def main():
    svg = open(sys.argv[1], encoding='utf-8').read()
    overrides = json.load(open(sys.argv[2], encoding='utf-8')) if len(sys.argv) > 2 else {}
    boxes, lines, texts = parse(svg)

    # attach text to boxes
    notes = []
    for parts in texts:
        x, y, txt = parts[0]
        host = None
        for b in boxes:
            if b['x0'] - TOL <= x <= b['x1'] and b['y0'] - TOL <= y <= b['y1'] + TOL:
                host = b
                break
        if host is not None and len(parts) == 1:
            host['name'] = txt
        else:
            notes.append({'x': x, 'y': y, 'lines': [p[2] for p in parts]})

    for i, b in enumerate(boxes):
        b['id'] = i
        b.setdefault('name', '???')

    raw_families, same_person = [], []
    for comp in components(lines):
        side, top, bottom = set(), set(), set()
        for ln in comp:
            for p in (ln['a'], ln['b']):
                for b in boxes:
                    t = touch(p, b)
                    if t == 'side':
                        side.add(b['id'])
                    elif t == 'top':
                        top.add(b['id'])
                    elif t == 'bottom':
                        bottom.add(b['id'])
        parents = side | bottom
        if not parents and len(top) == 2:
            same_person.append(sorted(top))
            continue
        if parents or top:
            raw_families.append({'parents': sorted(parents), 'children': sorted(top - parents),
                                 'colors': sorted({ln['color'] for ln in comp})})

    out = {
        'boxes': [{k: b[k] for k in ('id', 'name', 'color', 'x0', 'y0', 'x1', 'y1')} for b in boxes],
        'families': raw_families,
        'same_person': same_person,
        'notes': notes,
        'overrides': overrides,
    }
    json.dump(out, sys.stdout, ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main()
