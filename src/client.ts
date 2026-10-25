import { HttpClient, type ApiRequest, type ClientOptions, type HttpMethod, type RequestOptions } from "./core.js";
import { FilesResource } from "./resources/files.js";
import { MeResource, MeetingsResource, MembersResource, ProjectsResource } from "./resources/projects.js";
import { AgentsResource, WebhooksResource } from "./resources/webhooks.js";
import { CalendarEventsResource, CalendarResource, MilestonesResource, TasksResource } from "./resources/work.js";

/**
 * The IMPROJ API client.
 *
 * ```ts
 * import { Improj } from "@kodvalley/improj";
 *
 * const improj = new Improj({ token: process.env.IMPROJ_TOKEN });
 * for await (const task of improj.tasks.list(42, { status: "todo" })) {
 *   console.log(task.title);
 * }
 * ```
 *
 * Keep tokens on servers. In a browser, point `baseUrl` at your own backend
 * proxy and leave `token` out.
 */
export class Improj {
  readonly #http: HttpClient;

  /** `GET /me`. */
  readonly me: MeResource;
  /** Projects, their work packages and activities. */
  readonly projects: ProjectsResource;
  readonly tasks: TasksResource;
  readonly milestones: MilestonesResource;
  readonly members: MembersResource;
  /** Files: list, metadata, download links and uploads. */
  readonly files: FilesResource;
  /** Project calendar events. */
  readonly calendarEvents: CalendarEventsResource;
  /** Your own calendar across projects (`GET /calendar`). */
  readonly calendar: CalendarResource;
  readonly meetings: MeetingsResource;
  /** Webhook endpoints. Verify deliveries with `@kodvalley/improj/webhooks`. */
  readonly webhooks: WebhooksResource;
  /** Enterprise AI agents. */
  readonly agents: AgentsResource;

  constructor(options: ClientOptions = {}) {
    this.#http = new HttpClient(options);
    this.me = new MeResource(this.#http);
    this.projects = new ProjectsResource(this.#http);
    this.tasks = new TasksResource(this.#http);
    this.milestones = new MilestonesResource(this.#http);
    this.members = new MembersResource(this.#http);
    this.files = new FilesResource(this.#http);
    this.calendarEvents = new CalendarEventsResource(this.#http);
    this.calendar = new CalendarResource(this.#http);
    this.meetings = new MeetingsResource(this.#http);
    this.webhooks = new WebhooksResource(this.#http);
    this.agents = new AgentsResource(this.#http);
  }

  /** The API base URL this client talks to. */
  get baseUrl(): string {
    return this.#http.baseUrl;
  }

  /** The OpenAPI 3.1 document the server publishes (public; no token needed). */
  openapi(options?: RequestOptions): Promise<Record<string, unknown>> {
    return this.#http.request<Record<string, unknown>>({ method: "GET", path: "/openapi.json", options });
  }

  /**
   * Calls an endpoint this SDK version does not wrap yet, with the same
   * authentication, retries and error handling. `path` is relative to the
   * base URL, for example `/projects/42/tasks`.
   */
  request<T = unknown>(
    method: HttpMethod,
    path: string,
    init: { query?: ApiRequest["query"]; body?: unknown; options?: RequestOptions } = {},
  ): Promise<T> {
    return this.#http.request<T>({ method, path, query: init.query, json: init.body, options: init.options });
  }

  /** Safe to log: the token is masked. */
  toJSON(): Record<string, unknown> {
    return this.#http.toJSON();
  }

  [Symbol.for("nodejs.util.inspect.custom")](): string {
    return `Improj ${JSON.stringify(this.toJSON())}`;
  }
}
