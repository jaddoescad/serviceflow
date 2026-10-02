/** Shared by the server loader and the client Documents panel. */
export const PROJECT_DOCUMENTS_BUCKET = "project-documents";

export type ProjectDocument = {
  id: string;
  name: string;
  kind: "file" | "page";
  folderId: string | null;
  mimeType: string | null;
  byteSize: number;
  updatedAt: string;
  updatedByName: string | null;
};

export type ProjectDocumentFolder = {
  id: string;
  name: string;
  updatedAt: string;
  updatedByName: string | null;
};

export type ProjectPageDocument = {
  id: string;
  projectId: string;
  name: string;
  bodyHtml: string;
  updatedAt: string;
};

/** Storage key for an image placed inside a page. */
export function pageImagePath(projectId: string, documentId: string, imageId: string): string {
  return `${projectId}/pages/${documentId}/${imageId}`;
}

export function pageImageUrl(projectId: string, documentId: string, imageId: string): string {
  return `/api/jobs/${projectId}/documents/${documentId}/images/${imageId}`;
}
