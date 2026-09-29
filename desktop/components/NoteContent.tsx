"use client";
// Render only local image markers; ordinary notebook text remains literal text.
export function NoteContent({ text }: { text: string }) {
  const parts = text.split(/(!\[图片\]\(\/api\/bt\/notebooks\/images\?id=[a-f0-9-]{36}\.(?:png|jpg|gif|webp)\))/g);
  return <div className="bt-note-content">{parts.map((part, i) => {
    if (!part.startsWith("![图片](/api/bt/notebooks/images?id=")) return <span key={i}>{part}</span>;
    const url = part.slice(6, -1);
    // eslint-disable-next-line @next/next/no-img-element
    return <a key={i} href={url} target="_blank" rel="noreferrer"><img src={url} alt="笔记图片" loading="lazy" /></a>;
  })}</div>;
}
