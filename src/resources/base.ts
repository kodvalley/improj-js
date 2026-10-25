import { ImprojError } from "../errors.js";
import type { ApiRequest, HttpClient, RequestOptions } from "../core.js";
import { PagePromise } from "../pagination.js";
import type { ListParams, ListResponse } from "../types.js";

type Query = ApiRequest["query"];

/** Shared plumbing of the resource classes. */
export abstract class Resource {
  protected readonly http: HttpClient;

  constructor(http: HttpClient) {
    this.http = http;
  }

  /** GET a single object and unwrap `{ data }`. */
  protected async getOne<T>(path: string, options?: RequestOptions, query?: Query): Promise<T> {
    return unwrap<T>(await this.http.request<{ data: T }>({ method: "GET", path, query, options }));
  }

  protected async send<T>(method: "POST" | "PATCH", path: string, json: unknown, options?: RequestOptions): Promise<T> {
    return unwrap<T>(await this.http.request<{ data: T }>({ method, path, json: json ?? {}, options }));
  }

  /** POST without a body (actions such as a webhook test). */
  protected async action<T>(path: string, options?: RequestOptions): Promise<T> {
    return unwrap<T>(await this.http.request<{ data: T }>({ method: "POST", path, options }));
  }

  protected async remove(path: string, options?: RequestOptions): Promise<void> {
    await this.http.request<undefined>({ method: "DELETE", path, options });
  }

  /** A paginated GET; the caller's own cursor (if any) starts the walk. */
  protected paginate<T>(path: string, params: (ListParams & Record<string, unknown>) | undefined, options?: RequestOptions): PagePromise<T> {
    const { cursor: startCursor, ...rest } = params ?? {};
    return new PagePromise<T>((cursor) =>
      this.http.request<ListResponse<T>>({
        method: "GET",
        path,
        query: { ...(rest as Query), cursor: cursor ?? startCursor },
        options,
      }),
    );
  }
}

/** Unwraps the `{ data }` envelope of a success answer. */
export function unwrap<T>(body: { data: T } | undefined): T {
  if (!body || typeof body !== "object" || !("data" in body)) {
    throw new ImprojError({ status: 0, code: "INVALID_RESPONSE", message: "The answer has no data field." });
  }
  return body.data;
}
