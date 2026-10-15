export type Gender = 'male' | 'female' | 'unknown';
export type UnionKind = 'married' | 'divorced' | 'partner' | 'unknown';
export type ChildRelation = 'biological' | 'adopted' | 'step' | 'foster';

/** 'YYYY', 'YYYY-MM' or 'YYYY-MM-DD' — genealogy dates are often partial. */
export type PartialDate = string;

export interface Person {
  id: string;
  first_name: string | null;
  last_name: string | null;
  maiden_name: string | null;
  gender: Gender;
  birth_date: PartialDate | null;
  birth_place: string | null;
  death_date: PartialDate | null;
  is_deceased: boolean;
  photo_path: string | null;
  description: string | null;
}

/** A couple. Either partner may be unknown (null), e.g. siblings whose parents are not known. */
export interface Union {
  id: string;
  partner1_id: string | null;
  partner2_id: string | null;
  kind: UnionKind;
  sort_order: number;
}

export interface UnionChild {
  union_id: string;
  child_id: string;
  relation: ChildRelation;
  sort_order: number;
}

export interface TreeData {
  persons: Person[];
  unions: Union[];
  children: UnionChild[];
}

export function emptyPerson(id: string, patch: Partial<Person> = {}): Person {
  return {
    id,
    first_name: null,
    last_name: null,
    maiden_name: null,
    gender: 'unknown',
    birth_date: null,
    birth_place: null,
    death_date: null,
    is_deceased: false,
    photo_path: null,
    description: null,
    ...patch,
  };
}
