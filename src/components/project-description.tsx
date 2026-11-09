/** Render plain-text briefs safely while keeping paragraphs, headings and lists. */
export function ProjectDescription({ text }: { text: string }) {
  const blocks = text.replace(/\r\n/g, '\n').split(/\n\s*\n/);
  return <div className="structured-brief">{blocks.map((block, index) => {
    const lines = block.split('\n').filter(line => line.trim());
    const content: React.ReactNode[] = [];
    let items: string[] = [];
    const flush = () => { if (items.length) { content.push(<ul key={`list-${content.length}`}>{items.map((item, i) => <li key={i}>{item}</li>)}</ul>); items = []; } };
    for (const line of lines) {
      const item = line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.+)/);
      if (item) items.push(item[1]);
      else { flush(); content.push(line.trim().endsWith(':') ? <strong className="brief-heading" key={content.length}>{line}</strong> : <p key={content.length}>{line}</p>); }
    }
    flush();
    return <div className="brief-block" key={index}>{content}</div>;
  })}</div>;
}
