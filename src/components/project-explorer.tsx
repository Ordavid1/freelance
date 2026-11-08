'use client';

import { useEffect, useMemo, useState } from 'react';
import { ProjectCard } from '@/components/marketplace';
import type { Project } from '@/lib/data';

export function ProjectExplorer({ projects }: { projects: Project[] }) {
  const [query, setQuery] = useState(''); const [tab, setTab] = useState<'forYou'|'newest'|'saved'>('forYou'); const [filterOpen, setFilterOpen] = useState(false); const [category, setCategory] = useState(''); const [saved, setSaved] = useState<string[]>([]);
  useEffect(() => { setSaved(JSON.parse(localStorage.getItem('fz-saved') || '[]')); }, []);
  function toggleSave(slug: string) { setSaved((old) => { const next = old.includes(slug) ? old.filter(x => x !== slug) : [...old, slug]; localStorage.setItem('fz-saved', JSON.stringify(next)); return next; }); }
  const categories = [...new Set(projects.map(p => p.category))];
  const visible = useMemo(() => projects.filter(p => (tab !== 'saved' || saved.includes(p.slug)) && (!category || p.category === category) && (!query || `${p.title} ${p.description} ${p.skills.join(' ')} ${p.client}`.toLowerCase().includes(query.toLowerCase()))).sort((a,b) => tab === 'newest' ? projects.indexOf(a)-projects.indexOf(b) : 0), [projects, tab, saved, category, query]);
  return <><div className="discover-tools"><label className="feed-search"><span>⌕</span><input aria-label="חיפוש פרויקטים" value={query} onChange={e => setQuery(e.target.value)} placeholder="חיפוש לפי תפקיד, כישור או לקוח"/>{query && <button onClick={()=>setQuery('')} aria-label="ניקוי חיפוש">×</button>}</label><div className="feed-toolbar"><div className="feed-tabs"><button className={`tab ${tab==='forYou'?'active':''}`} onClick={()=>setTab('forYou')}>בשבילך</button><button className={`tab ${tab==='newest'?'active':''}`} onClick={()=>setTab('newest')}>הכי חדשים</button><button className={`tab ${tab==='saved'?'active':''}`} onClick={()=>setTab('saved')}>נשמרו {saved.length>0&&<b className="saved-count">{saved.length}</b>}</button></div><button className="filter-button" aria-expanded={filterOpen} onClick={()=>setFilterOpen(!filterOpen)}>☷ <span>סינון</span><b>{category?'1':'0'}</b></button></div>{filterOpen && <div className="filter-panel"><label htmlFor="category-filter">תחום</label><select id="category-filter" value={category} onChange={e=>setCategory(e.target.value)}><option value="">כל התחומים</option>{categories.map(c=><option key={c}>{c}</option>)}</select><button className="clear-filter" onClick={()=>{setCategory('');setQuery('')}}>ניקוי סינון</button></div>}</div>
    {visible.length ? <div className="project-list">{visible.map(p=><ProjectCard key={p.slug} project={p} saved={saved.includes(p.slug)} onToggleSave={()=>toggleSave(p.slug)}/>)}</div> : <div className="empty-state"><strong>{tab==='saved'?'עוד לא שמרת פרויקטים':'לא מצאנו פרויקטים מתאימים'}</strong><span>{tab==='saved'?'שמרו פרויקט עם ♡ כדי לחזור אליו בקלות.':'נסו לשנות את מילות החיפוש או לנקות את הסינון.'}</span></div>}
    <div className="load-more"><span>מציגים {visible.length} מתוך {projects.length} פרויקטים לדוגמה</span><span className="demo-pill">תוכן הדגמה</span></div>
  </>;
}
