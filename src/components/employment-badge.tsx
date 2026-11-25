import './employment-badge.css';
import { EMPLOYMENT_LABELS, type EmploymentType } from '@/lib/projects/employment';

// Small label stating how a project engages the person: as a freelancer or as an employee. Pure markup, so server pages
// and the client feed share it; it sits in the same pill family as the LIVE and AI-agent badges.
export function EmploymentBadge({ type }: { type: EmploymentType }) {
  return <span className={`employment-badge employment-${type}`}>{EMPLOYMENT_LABELS[type]}</span>;
}
