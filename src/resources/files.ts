import { configError, pathId, type BinaryBody, type RequestOptions } from "../core.js";
import type { PagePromise } from "../pagination.js";
import type { DownloadLink, FileListParams, Id, ListParams, ProjectFile, Upload, UploadCreate } from "../types.js";
import { Resource, unwrap } from "./base.js";

const UPLOAD_ID = /^upl_[A-Za-z0-9_-]{20,64}$/;
const MAX_UPLOAD_BYTES = 16 * 1024 * 1024;

export interface UploadInput {
  /** File name shown in IMPROJ, 1 to 255 characters. */
  name: string;
  /** The bytes: a Uint8Array (including Node's Buffer), an ArrayBuffer or a Blob/File. */
  data: BinaryBody;
  /** MIME type; default: the Blob's type, else application/octet-stream. */
  mimeType?: string;
  /** A folder of the project, or null/undefined for the top level. */
  parentId?: number | null;
}

function byteLength(data: BinaryBody): number {
  if (typeof Blob !== "undefined" && data instanceof Blob) return data.size;
  if (data instanceof ArrayBuffer) return data.byteLength;
  if (ArrayBuffer.isView(data)) return data.byteLength;
  throw configError("Upload data must be a Uint8Array, an ArrayBuffer or a Blob (streams are not supported: the API needs an exact size).");
}

/** Project files (scopes `files:read`, `files:write`). */
export class FilesResource extends Resource {
  /** Files and folders you can see; `parent_id` lists a folder (or `"root"`). */
  list(projectId: Id, params?: FileListParams, options?: RequestOptions): PagePromise<ProjectFile> {
    const { parent_id, ...rest } = params ?? {};
    const query = parent_id === undefined ? rest : { ...rest, parent_id: parent_id === "root" ? "root" : pathId(parent_id, "parent_id") };
    return this.paginate<ProjectFile>(`/projects/${pathId(projectId, "projectId")}/files`, query as ListParams & Record<string, unknown>, options);
  }

  get(projectId: Id, fileId: Id, options?: RequestOptions): Promise<ProjectFile> {
    return this.getOne<ProjectFile>(`/projects/${pathId(projectId, "projectId")}/files/${pathId(fileId, "fileId")}`, options);
  }

  /** A signed download link, valid for 5 minutes. Use it right away; do not store it. */
  downloadLink(projectId: Id, fileId: Id, options?: RequestOptions): Promise<DownloadLink> {
    return this.getOne<DownloadLink>(`/projects/${pathId(projectId, "projectId")}/files/${pathId(fileId, "fileId")}/download`, options);
  }

  /** Step 1 of an upload: announce the file. Prefer `upload()`, which does both steps. */
  createUpload(projectId: Id, input: UploadCreate, options?: RequestOptions): Promise<Upload> {
    return this.send<Upload>("POST", `/projects/${pathId(projectId, "projectId")}/uploads`, input, options);
  }

  /**
   * Step 2 of an upload: send the bytes. The request always goes to
   * `<baseUrl>/uploads/<id>`, never to a URL taken from a response, so the
   * token cannot be sent anywhere else. Upload ids are single use: after a
   * network failure, start again with `createUpload()`.
   */
  async sendUpload(upload: Upload | string, data: BinaryBody, options?: RequestOptions): Promise<ProjectFile> {
    const id = typeof upload === "string" ? upload : upload.id;
    if (typeof id !== "string" || !UPLOAD_ID.test(id)) throw configError("Not a valid upload id.");
    const size = byteLength(data);
    if (typeof upload !== "string" && size > upload.max_bytes) {
      throw configError(`The data is ${size} bytes but the upload was announced with at most ${upload.max_bytes}.`);
    }
    const { idempotencyKey: _ignored, ...rest } = options ?? {};
    const body = await this.http.request<{ data: ProjectFile }>({
      method: "PUT",
      path: `/uploads/${id}`,
      binary: { body: data, contentType: "application/octet-stream" },
      options: rest,
      retry: "status-only",
    });
    return unwrap(body);
  }

  /** Uploads a file in both steps and returns the created file. */
  async upload(projectId: Id, input: UploadInput, options?: RequestOptions): Promise<ProjectFile> {
    const size = byteLength(input.data);
    if (size < 1) throw configError("Cannot upload an empty file.");
    if (size > MAX_UPLOAD_BYTES) throw configError("Files larger than 16 MB cannot be uploaded through the API.");
    const blobType = typeof Blob !== "undefined" && input.data instanceof Blob ? input.data.type : "";
    const mime = input.mimeType ?? (blobType || "application/octet-stream");
    const announced = await this.createUpload(
      projectId,
      { name: input.name, size, mime_type: mime, ...(input.parentId != null ? { parent_id: input.parentId } : {}) },
      options,
    );
    return this.sendUpload(announced, input.data, options);
  }
}
