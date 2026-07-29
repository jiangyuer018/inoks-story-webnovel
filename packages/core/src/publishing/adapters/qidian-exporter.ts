import { publicationFileName } from "../filename-normalizer.js";

export class QidianExporter {
  readonly platform = "qidian" as const;

  render(input: {
    readonly chapterNumber: number;
    readonly title: string;
    readonly body: string;
    readonly extension: "md" | "txt";
  }): { readonly fileName: string; readonly content: string } {
    const fileName = publicationFileName(input.chapterNumber, input.title, input.extension);
    const heading = `第${input.chapterNumber}章 ${input.title}`;
    return {
      fileName,
      content: input.extension === "md"
        ? `# ${heading}\n\n${input.body.trim()}\n`
        : `${heading}\n\n${input.body.trim()}\n`,
    };
  }
}
