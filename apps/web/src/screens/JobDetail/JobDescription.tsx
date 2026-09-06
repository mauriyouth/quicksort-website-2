/** Render admin-entered plain text without treating it as executable HTML. */
export function JobDescription({ text }: { text: string }) {
  const blocks: JSX.Element[] = [];
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  let bullets: string[] = [];
  const flush = () => {
    if (bullets.length) {
      blocks.push(<ul key={`list-${blocks.length}`} className="list-disc pl-6 space-y-3">{bullets.map((item, i) => <li key={i}>{item}</li>)}</ul>);
      bullets = [];
    }
  };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) { flush(); continue; }
    if (/^[•·*-]\s+/.test(line)) { bullets.push(line.replace(/^[•·*-]\s+/, "")); continue; }
    flush();
    const heading = /^#{1,3}\s+/.test(line) || (line.length < 100 && /[A-Z]/.test(line) && line === line.toUpperCase());
    blocks.push(heading
      ? <h2 key={blocks.length} className="text-ink text-xl sm:text-2xl font-semibold pt-6">{line.replace(/^#{1,3}\s+/, "")}</h2>
      : <p key={blocks.length} className="whitespace-pre-wrap">{line}</p>);
  }
  flush();
  return <div className="space-y-5 text-ink-muted text-base sm:text-lg leading-relaxed break-words">{blocks}</div>;
}
