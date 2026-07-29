const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;

export function normalizePublicationTitle(title: string): string {
  const value = title
    .normalize("NFKC")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/[. ]+$/g, "")
    .trim()
    .slice(0, 80);
  if (!value || WINDOWS_RESERVED.test(value)) return "未命名章节";
  return value;
}

export function publicationFileName(
  chapterNumber: number,
  title: string,
  extension: "md" | "txt",
): string {
  return `第${String(chapterNumber).padStart(3, "0")}章 ${normalizePublicationTitle(title)}.${extension}`;
}
