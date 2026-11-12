'use client';

import { useState } from 'react';
import type { CompatibilityAnalysis, CompatibilityMetric } from '@/lib/marketplace/compatibility-analysis';

function MetricChart({ label, metric, kind }: { label: string; metric: CompatibilityMetric; kind: 'ring' | 'bars' }) {
  const [expanded, setExpanded] = useState(false);
  const score = metric.score === null ? null : Math.max(0, Math.min(100, metric.score));
  const missing = Math.max(0, metric.total - metric.matched);
  return <section className="analysis-chart">
    <header><h3>{label}</h3><strong>{score === null ? 'מידע חסר' : `${score}%`}</strong></header>
    {kind === 'ring' ? <svg className="analysis-ring" viewBox="0 0 240 200" role="img" aria-label={`${label}: ${score === null ? 'אין מספיק נתונים' : `${score}% התאמה`}`}>
      <circle className="chart-track" cx="120" cy="95" r="70"/>
      {score !== null && <circle className="chart-value" cx="120" cy="95" r="70" pathLength="100" strokeDasharray={`${score} 100`} transform="rotate(-90 120 95)"><title>{`${metric.matched} מתוך ${metric.total} דרישות`}</title></circle>}
      <text x="120" y="98" textAnchor="middle" className="chart-score">{score === null ? '—' : `${score}%`}</text>
      <text x="120" y="124" textAnchor="middle" className="chart-caption">חפיפה בכישורים</text>
    </svg> : <div className="analysis-bars" role="group" aria-label={label}>
      {[{ label: 'תועד בפרופיל', value: metric.matched, color: 'matched' }, { label: 'דורש בירור', value: missing, color: 'missing' }].map(item => <div className="analysis-bar-row" key={item.color}>
        <span>{item.label}</span><div className={`analysis-bar ${item.color}`}><span style={{ width: `${metric.total ? item.value / metric.total * 100 : 0}%` }} role="meter" aria-label={item.label} aria-valuemin={0} aria-valuemax={Math.max(1, metric.total)} aria-valuenow={metric.total ? item.value : undefined}/></div><strong>{metric.total ? item.value : '—'}</strong>
      </div>)}
    </div>}
    <p>{metric.total ? `${metric.matched} מתוך ${metric.total} דרישות` : 'לא הוגדרו דרישות להשוואה'}</p>
    <button type="button" className="analysis-details-toggle" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>{expanded ? 'הסתרת פירוט' : 'מה עומד מאחורי הנתונים?'}</button>
    {expanded && <div className="analysis-chart-details"><p>{metric.note}</p>{metric.matches.length > 0 && <ul>{metric.matches.map(match => <li key={match}>{match}</li>)}</ul>}</div>}
  </section>;
}

export function CompatibilityAnalysisCard({ analysis }: { analysis: CompatibilityAnalysis }) {
  return <aside className="compatibility-analysis live-analysis" aria-label="ניתוח התאמה לפרויקט">
    <header className="compatibility-analysis-header"><div><span>התאמה לפרויקט</span><p>הכישורים והניסיון בפרופיל מול דרישות הפרויקט</p></div><div className={`compatibility-grade${analysis.score === null ? ' is-unknown' : ''}`}><strong>{analysis.score ?? '—'}{analysis.score !== null && <small>/100</small>}</strong><span>{analysis.label}</span></div></header>
    <div className="compatibility-graphs"><MetricChart label="כישורים נדרשים" metric={analysis.skills} kind="ring"/><MetricChart label="ניסיון מתועד" metric={analysis.experience} kind="bars"/></div>
    <section className="analysis-summary"><h3>מה אפשר ללמוד מההתאמה?</h3><p className="compatibility-conclusion">{analysis.conclusion}</p></section>
    <small className="compatibility-note">הערכה לפי המידע בפרופיל ובפרויקט. מידע שלא תועד אינו מעיד על חוסר יכולת; אפשר לברר אותו בשיחה.</small>
  </aside>;
}
