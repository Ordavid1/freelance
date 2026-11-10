import WorkspaceHome from '@/components/workspace-home';
import { CollectionData, DiscoveryLinks, ProjectLinks, Questions } from '@/components/discovery/public-content';
import { getHomeQuestions } from '@/lib/seo/content';
import { metadataFor } from '@/lib/seo/registry';
import { discoveryProjects } from '@/lib/seo/projects';
export const dynamic = 'force-dynamic';
export const metadata = metadataFor('/');
export default async function Home() {
  const projects = (await discoveryProjects()).slice(0, 12);
  return <WorkspaceHome><section className="discovery-content" aria-labelledby="discovery-heading"><h2 id="discovery-heading">Freelance Place — מקום לפרילנסרים ולפרויקטים בישראל</h2><p>פרויקט טוב מתחיל בהגדרה ברורה ובאנשים המתאימים. Freelance Place מרכז מרחב עבודה בעברית לפרילנסרים ולעסקים: גילוי פרויקטים, הכנת פרופיל מקצועי וניסוח הצעת מחיר שנבדקת לפני השליחה.</p><p>מחפשים אלטרנטיבה ל־XPlace.com? קראו על הגישה שלנו, בדקו את היכולות הקיימות והשוו לפי סוג העבודה שאתם צריכים.</p><DiscoveryLinks /><ProjectLinks projects={projects} /><Questions items={getHomeQuestions()} /><CollectionData title="פרויקטים לפרילנסרים בישראל" path="/" projects={projects} /></section></WorkspaceHome>;
}
