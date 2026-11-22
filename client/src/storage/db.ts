import Dexie, { type Table } from 'dexie';
import type { Day } from '../recipe/types';

class ProyavkaDB extends Dexie {
  days!: Table<Day, string>;

  constructor() {
    super('proyavka');
    this.version(1).stores({ days: 'id, date, createdAt' });
  }
}

export const db = new ProyavkaDB();

export const listDays = () => db.days.orderBy('createdAt').reverse().toArray();
export const getDay = (id: string) => db.days.get(id);
export const saveDay = (day: Day) => db.days.put(day);
export const updateDay = (id: string, patch: Partial<Day>) => db.days.update(id, patch);
export const deleteDay = (id: string) => db.days.delete(id);
