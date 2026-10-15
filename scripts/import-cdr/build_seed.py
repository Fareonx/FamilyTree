"""Turn parse_svg.py output into the app's TreeData JSON (the same format as the in-app JSON backup).

    python3 scripts/import-cdr/build_seed.py raw.json overrides.json > family.json

The result can be loaded with "Data → Restore from backup (JSON)" in the app.
Family data stays out of git: keep raw.json / family.json outside the repository or in ignored paths.
"""
import json
import sys
import uuid


def clean(name):
    name = name.replace('#', '').strip()
    return None if not name or set(name) <= {'?'} else name


def main():
    raw = json.load(open(sys.argv[1], encoding='utf-8'))
    ov = json.load(open(sys.argv[2], encoding='utf-8')) if len(sys.argv) > 2 else {}
    boxes = {b['id']: b for b in raw['boxes']}
    # Gender by given name comes from the overrides file, so no family names live in this script.
    male = set(ov.get('male_names', []))
    female = set(ov.get('female_names', []))

    # Boxes that show the same human (yellow line) collapse onto one id.
    alias = {}
    for group in raw['same_person'] + ov.get('same_person', []):
        keep = min(group)
        for b in group:
            alias[b] = keep
    canon = lambda b: alias.get(b, b)

    ns = uuid.UUID(ov.get('namespace', '6f1d7a52-2c1b-4b53-9a51-0d1c1f2b7e10'))
    pid = lambda b: str(uuid.uuid5(ns, f'box-{canon(b)}'))

    persons = {}
    for b in boxes.values():
        if canon(b['id']) != b['id']:
            continue
        name = clean(b['name'])
        gender = 'male' if name in male else 'female' if name in female else 'unknown'
        persons[pid(b['id'])] = {
            'id': pid(b['id']), 'first_name': name, 'last_name': None, 'maiden_name': None, 'gender': gender,
            'birth_date': None, 'birth_place': None, 'death_date': None, 'is_deceased': False,
            'photo_path': None, 'description': None, '_x': b['x0'],
        }

    unions, children = [], []
    for i, f in enumerate(raw['families']):
        parents = sorted({canon(p) for p in f['parents']}, key=lambda b: boxes[b]['x0'])
        kids = sorted({canon(c) for c in f['children']} - set(parents), key=lambda b: boxes[b]['x0'])
        if len(parents) > 2:
            print(f'warning: family {i} has {len(parents)} parents', file=sys.stderr)
        uid = str(uuid.uuid5(ns, f'union-{i}'))
        p = [pid(b) for b in parents] + [None, None]
        unions.append({'id': uid, 'partner1_id': p[0], 'partner2_id': p[1],
                       'kind': 'married' if parents else 'unknown', 'sort_order': 0})
        for j, c in enumerate(kids):
            children.append({'union_id': uid, 'child_id': pid(c), 'relation': 'biological', 'sort_order': j})

    # A partner whose gender is unknown is the opposite of the other partner ("???" boxes).
    for u in unions:
        a, b = persons.get(u['partner1_id']), persons.get(u['partner2_id'])
        if a and b:
            if a['gender'] == 'unknown' and b['gender'] != 'unknown':
                a['gender'] = 'female' if b['gender'] == 'male' else 'male'
            if b['gender'] == 'unknown' and a['gender'] != 'unknown':
                b['gender'] = 'female' if a['gender'] == 'male' else 'male'

    # Free text in the drawing (names written without boxes) is kept as a note on the nearest person.
    for note in raw['notes']:
        text = '\n'.join(note['lines'])
        target = ov.get('notes', {}).get(text)
        if target is None:
            best = min(boxes.values(), key=lambda b: abs(b['x0'] - note['x']) + abs(b['y1'] - note['y']) * 3)
            target = best['id']
        p = persons[pid(target)]
        msg = f'Из старого древа (CorelDRAW), записано без линий:\n{text}'
        p['description'] = f"{p['description']}\n\n{msg}" if p['description'] else msg

    for p in persons.values():
        p.pop('_x')
    out = {'persons': list(persons.values()), 'unions': unions, 'children': children}
    if 'home' in ov:
        out['home_person_id'] = pid(ov['home'])
    json.dump(out, sys.stdout, ensure_ascii=False, indent=1)


if __name__ == '__main__':
    main()
