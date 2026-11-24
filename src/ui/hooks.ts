import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { getDb } from '../db/db';
import { normalizeSettings, SETTINGS_ID } from '../db/repo';
import type { AppSettings } from '../db/types';
import { today } from '../lib/date';

export function useSettings(): AppSettings | undefined {
  const s = useLiveQuery(async () => normalizeSettings(await getDb().settings.get(SETTINGS_ID)), []);
  return s;
}

/** 日付が変わったら再描画する（深夜0時をまたいで開きっぱなしの場合） */
export function useToday(): string {
  const [d, setD] = useState(today());
  useEffect(() => {
    const id = setInterval(() => {
      const t = today();
      setD((prev) => (prev === t ? prev : t));
    }, 30_000);
    const onVis = () => setD(today());
    document.addEventListener('visibilitychange', onVis);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, []);
  return d;
}

export function useOnline(): boolean {
  const [on, setOn] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  useEffect(() => {
    const a = () => setOn(true);
    const b = () => setOn(false);
    window.addEventListener('online', a);
    window.addEventListener('offline', b);
    return () => {
      window.removeEventListener('online', a);
      window.removeEventListener('offline', b);
    };
  }, []);
  return on;
}
