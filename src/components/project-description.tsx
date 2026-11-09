/** Render plain-text briefs safely while keeping paragraphs, headings and lists. */
export function ProjectDescription({ text }: { text: string }) {
  // Older briefs often arrive as a single paragraph with inline section labels.
  const normalized = text.replace(/\r\n/g, '\n')
    .replace(/\s*((?:התפקיד כולל|תכולת הפרויקט|דרישות התפקיד|דרישות חובה|דרישות|תוצרים|מה כולל הפרויקט|מה אנחנו מחפשים|תחומי אחריות|יתרון|תקציב|לוחות זמנים))\s*:/g, '\n\n$1:\n');
  const blocks = normalized.split(/\n\s*\n/).filter(block => block.trim());
  return <div className="structured-brief">{blocks.map((block, index) => {
    const lines = block.split('\n').filter(line => line.trim());
    const content: React.ReactNode[] = [];
    let items: string[] = [];
    const flush = () => { if (items.length) { content.push(<ul key={`list-${content.length}`}>{items.map((item, i) => <li key={i}>{item}</li>)}</ul>); items = []; } };
    for (const line of lines) {
      const item = line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.+)/);
      if (item) items.push(item[1]);
      else {
        flush();
        if (line.trim().endsWith(':')) content.push(<strong className="brief-heading" key={content.length}>{line}</strong>);
        else {
          // Separate complete statements without changing their wording or splitting URLs/decimals.
          const statements = line.trim().split(/(?<=[.!?])\s+(?=[\u0590-\u05ffA-Z])/);
          for (const statement of statements) content.push(<p key={content.length}>{statement}</p>);
        }
      }
    }
    flush();
    return <div className="brief-block" key={index}>{content}</div>;
  })}</div>;
}
