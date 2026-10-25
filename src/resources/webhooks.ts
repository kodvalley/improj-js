import { pathId, type RequestOptions } from "../core.js";
import { PagePromise } from "../pagination.js";
import type {
  Agent,
  AgentItem,
  AgentItemListParams,
  AgentNoteCreate,
  AgentNoteResult,
  Id,
  ListParams,
  WebhookDelivery,
  WebhookEndpoint,
  WebhookEndpointCreate,
  WebhookEndpointUpdate,
  WebhookEndpointWithSecret,
  WebhookTestResult,
} from "../types.js";
import { Resource } from "./base.js";

/** Webhook endpoints (scope `webhooks:manage`). To verify deliveries, see `@kodvalley/improj/webhooks`. */
export class WebhooksResource extends Resource {
  list(params?: ListParams, options?: RequestOptions): PagePromise<WebhookEndpoint> {
    return this.paginate<WebhookEndpoint>("/webhooks", params as ListParams & Record<string, unknown>, options);
  }

  /** Creates an endpoint. The answer holds its `whsec_` secret once: store it in your secret manager. */
  create(input: WebhookEndpointCreate, options?: RequestOptions): Promise<WebhookEndpointWithSecret> {
    return this.send<WebhookEndpointWithSecret>("POST", "/webhooks", input, options);
  }

  get(webhookId: Id, options?: RequestOptions): Promise<WebhookEndpoint> {
    return this.getOne<WebhookEndpoint>(`/webhooks/${pathId(webhookId, "webhookId")}`, options);
  }

  /** `enabled: true` turns a disabled endpoint back on. */
  update(webhookId: Id, input: WebhookEndpointUpdate, options?: RequestOptions): Promise<WebhookEndpoint> {
    return this.send<WebhookEndpoint>("PATCH", `/webhooks/${pathId(webhookId, "webhookId")}`, input, options);
  }

  delete(webhookId: Id, options?: RequestOptions): Promise<void> {
    return this.remove(`/webhooks/${pathId(webhookId, "webhookId")}`, options);
  }

  /** Sends a signed `ping` event now (also to a disabled endpoint). */
  test(webhookId: Id, options?: RequestOptions): Promise<WebhookTestResult> {
    return this.action<WebhookTestResult>(`/webhooks/${pathId(webhookId, "webhookId")}/test`, options);
  }

  /** The delivery log of an endpoint (30 days), newest first. */
  deliveries(webhookId: Id, params?: ListParams, options?: RequestOptions): PagePromise<WebhookDelivery> {
    return this.paginate<WebhookDelivery>(`/webhooks/${pathId(webhookId, "webhookId")}/deliveries`, params as ListParams & Record<string, unknown>, options);
  }
}

/** Enterprise AI agents (scopes `agent:read`, `agent:note`). */
export class AgentsResource extends Resource {
  /** Agents you report to. Not paginated. */
  list(options?: RequestOptions): Promise<Agent[]> {
    return this.getOne<Agent[]>("/agents", options);
  }

  /** What an agent sent you, newest first (1 to 50 per page). */
  items(agentId: Id, params?: AgentItemListParams, options?: RequestOptions): PagePromise<AgentItem> {
    const path = `/agents/${pathId(agentId, "agentId")}/items`;
    const { cursor: start, limit } = params ?? {};
    return new PagePromise<AgentItem>(async (cursor) => {
      // This older route answers { data, nextCursor } with a numeric cursor.
      const body = await this.http.request<{ data: AgentItem[]; nextCursor?: number | string | null; next_cursor?: string | null }>({
        method: "GET",
        path,
        query: { cursor: cursor ?? start, limit },
        options,
      });
      const next = body?.next_cursor ?? body?.nextCursor ?? null;
      return { data: body?.data, next_cursor: next === null || next === undefined ? null : String(next) };
    });
  }

  /** Posts a note to an agent. Notes are untrusted input to the agent, never instructions. */
  postNote(agentId: Id, note: AgentNoteCreate, options?: RequestOptions): Promise<AgentNoteResult> {
    return this.send<AgentNoteResult>("POST", `/agents/${pathId(agentId, "agentId")}/notes`, note, options);
  }
}
