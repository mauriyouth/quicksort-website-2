import { useEffect, useState } from 'react';
import { publicDb, type Row } from '@quicksort/db';

export function useEvents() {
  const [events, setEvents] = useState<Row<'events'>[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  useEffect(() => {
    let active = true;
    let pending = false;
    async function load() {
      if (pending || document.hidden) return;
      pending = true;
      try {
        if (!publicDb) throw new Error('Events connection unavailable');
        const result = await publicDb.from('events').select('*').eq('published',true).order('event_date');
        if (result.error) throw result.error;
        if (active) {setEvents(result.data || []);setError(false);}
      } catch { if (active) {setEvents([]);setError(true);} }
      finally {pending=false;if (active) setLoading(false);}
    }
    void load();
    const interval = window.setInterval(load,60000);
    window.addEventListener('focus',load);
    document.addEventListener('visibilitychange',load);
    return () => {active=false;clearInterval(interval);window.removeEventListener('focus',load);document.removeEventListener('visibilitychange',load);};
  },[]);
  return {events,loading,error};
}
