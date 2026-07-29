import { z } from "zod";

export const PublicationPlatformSchema = z.enum(["fanqie", "qidian"]);
export type PublicationPlatform = z.infer<typeof PublicationPlatformSchema>;

export const PublicationStatusSchema = z.enum([
  "draft",
  "approved",
  "committed",
  "export_ready",
  "exported",
  "handed_to_extension",
  "scheduled_external",
  "published_external",
  "failed_external",
  "status_unknown",
]);
export type PublicationStatus = z.infer<typeof PublicationStatusSchema>;

export const ExternalPublicationRecordSchema = z.object({
  bookId: z.string().min(1),
  chapterNumber: z.number().int().min(1),
  chapterVersion: z.number().int().min(1),
  chapterCommitId: z.string().min(1),
  platform: PublicationPlatformSchema,
  deliveryMethod: z.string().min(1),
  exportBatchId: z.string().optional(),
  exportedFileName: z.string().optional(),
  exportedTextHash: z.string().length(64),
  status: PublicationStatusSchema,
  scheduledAt: z.string().datetime().optional(),
  publishedAt: z.string().datetime().optional(),
  externalLog: z.string().optional(),
  updatedAt: z.string().datetime(),
});

export type ExternalPublicationRecord = z.infer<typeof ExternalPublicationRecordSchema>;

export interface PublicationManifestEntry {
  readonly chapterNumber: number;
  readonly chapterVersion: number;
  readonly commitId: string;
  readonly contentHash: string;
  readonly exportedTextHash: string;
  readonly fileName: string;
}

export interface PublicationManifest {
  readonly schemaVersion: "1.0";
  readonly batchId: string;
  readonly bookId: string;
  readonly platform: PublicationPlatform;
  readonly format: "md" | "txt" | "zip";
  readonly chapterFileFormat: "md" | "txt";
  readonly entries: ReadonlyArray<PublicationManifestEntry>;
  readonly createdAt: string;
}

export interface PublicationExportResult {
  readonly batchId: string;
  readonly platform: PublicationPlatform;
  readonly outputPath: string;
  readonly manifestPath: string;
  readonly chaptersExported: number;
  readonly files: ReadonlyArray<string>;
}
