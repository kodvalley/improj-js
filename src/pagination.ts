import { ImprojError } from "./errors.js";
import type { ListResponse } from "./types.js";

/** Fetches one page; `cursor` is undefined for the first page. */
export type PageFetcher<T> = (cursor: string | undefined) => Promise<ListResponse<T>>;

/** One page of a list. */
export class Page<T> {
  readonly data: T[];
  /** The cursor of the next page, or null on the last page. */
  readonly nextCursor: string | null;
  readonly #fetchPage: PageFetcher<T>;

  constructor(response: ListResponse<T>, fetchPage: PageFetcher<T>) {
    if (!response || !Array.isArray(response.data)) {
      throw new ImprojError({ status: 0, code: "INVALID_RESPONSE", message: "A list answer must contain a data array." });
    }
    this.data = response.data;
    this.nextCursor = typeof response.next_cursor === "string" && response.next_cursor !== "" ? response.next_cursor : null;
    this.#fetchPage = fetchPage;
  }

  hasNextPage(): boolean {
    return this.nextCursor !== null;
  }

  /** Fetches the following page. Throws when there is none; check hasNextPage() first. */
  async getNextPage(): Promise<Page<T>> {
    if (this.nextCursor === null) {
      throw new ImprojError({ status: 0, code: "NO_MORE_PAGES", message: "This is the last page." });
    }
    return new Page(await this.#fetchPage(this.nextCursor), this.#fetchPage);
  }
}

/**
 * The result of a list method. `await` it for the first page, or iterate it
 * with `for await` to walk every item of every page:
 *
 * ```ts
 * const first = await improj.tasks.list(42);          // Page<Task>
 * for await (const task of improj.tasks.list(42)) {}  // every task
 * ```
 *
 * Nothing is fetched until you await or iterate it.
 */
export class PagePromise<T> implements PromiseLike<Page<T>>, AsyncIterable<T> {
  readonly #fetchPage: PageFetcher<T>;
  #first: Promise<Page<T>> | null = null;

  constructor(fetchPage: PageFetcher<T>) {
    this.#fetchPage = fetchPage;
  }

  #firstPage(): Promise<Page<T>> {
    this.#first ??= this.#fetchPage(undefined).then((r) => new Page(r, this.#fetchPage));
    return this.#first;
  }

  then<R1 = Page<T>, R2 = never>(
    onfulfilled?: ((value: Page<T>) => R1 | PromiseLike<R1>) | null,
    onrejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
  ): Promise<R1 | R2> {
    return this.#firstPage().then(onfulfilled, onrejected);
  }

  catch<R = never>(onrejected?: ((reason: unknown) => R | PromiseLike<R>) | null): Promise<Page<T> | R> {
    return this.#firstPage().catch(onrejected);
  }

  finally(onfinally?: (() => void) | null): Promise<Page<T>> {
    return this.#firstPage().finally(onfinally);
  }

  /** Every page in turn. Stops with an error if the API ever repeats a cursor. */
  async *pages(): AsyncGenerator<Page<T>, void, undefined> {
    let page = await this.#firstPage();
    const seen = new Set<string>();
    yield page;
    while (page.nextCursor !== null) {
      if (seen.has(page.nextCursor)) {
        throw new ImprojError({ status: 0, code: "PAGINATION_LOOP", message: "The API returned a cursor twice; stopping." });
      }
      seen.add(page.nextCursor);
      page = await page.getNextPage();
      yield page;
    }
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<T, void, undefined> {
    for await (const page of this.pages()) yield* page.data;
  }

  /** Collects items into an array, stopping after `max` items (default: all). */
  async toArray(options: { max?: number } = {}): Promise<T[]> {
    const max = options.max ?? Number.POSITIVE_INFINITY;
    if (!(max >= 0)) throw new ImprojError({ status: 0, code: "CONFIGURATION", message: "max must be a non-negative number." });
    const out: T[] = [];
    if (max === 0) return out;
    for await (const item of this) {
      out.push(item);
      if (out.length >= max) break;
    }
    return out;
  }
}
