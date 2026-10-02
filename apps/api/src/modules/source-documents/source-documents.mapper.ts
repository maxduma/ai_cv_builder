import type { SourceDocumentDto } from '@cv-builder/shared';
import type { SourceDocumentRecord } from './source-documents.repository';

export function toSourceDocumentDto(document: SourceDocumentRecord): SourceDocumentDto {
  return {
    id: document.id,
    originalName: document.originalName,
    sizeBytes: document.sizeBytes,
    pageCount: document.pageCount,
    createdAt: document.createdAt.toISOString(),
  };
}
