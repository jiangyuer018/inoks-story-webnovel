import { publicationFileName } from "../filename-normalizer.js";

export class FanqieExtensionExporter {
  readonly platform = "fanqie" as const;

  render(input: {
    readonly chapterNumber: number;
    readonly title: string;
    readonly body: string;
    readonly extension: "md" | "txt";
  }): { readonly fileName: string; readonly content: string } {
    const fileName = publicationFileName(input.chapterNumber, input.title, input.extension);
    const content = input.extension === "md"
      ? `# 第${input.chapterNumber}章 ${input.title}\n\n${input.body.trim()}\n`
      : `${input.body.trim()}\n`;
    return { fileName, content };
  }
}
