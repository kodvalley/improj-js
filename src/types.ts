/*
 * Types of the IMPROJ API v1 (API version 2026-10-24), written against
 * openapi.json. Field names are the API's own (snake_case): the SDK sends and
 * returns JSON exactly as the API defines it. The API adds fields over time;
 * treat these interfaces as the minimum you can rely on.
 */

/** A calendar day, `YYYY-MM-DD`. */
export type DateString = string;
/** A wall-clock time, `HH:MM` (24 hour clock). */
export type TimeString = string;
/** An ISO 8601 timestamp in UTC. */
export type Timestamp = string;
/** A positive integer id. Numeric strings are accepted too. */
export type Id = number | string;

export type ApiScope =
  | "user:read"
  | "projects:read"
  | "tasks:read"
  | "tasks:write"
  | "milestones:read"
  | "milestones:write"
  | "members:read"
  | "files:read"
  | "files:write"
  | "calendar:read"
  | "calendar:write"
  | "meetings:read"
  | "webhooks:manage"
  | "agent:read"
  | "agent:note";

// ─── Lists ──────────────────────────────────────────────────────────────────

/** The wire shape of every list answer. */
export interface ListResponse<T> {
  data: T[];
  next_cursor: string | null;
}

/** Pagination parameters shared by every list. */
export interface ListParams {
  /** Items per page, 1 to 100 (default 25). */
  limit?: number;
  /** The `next_cursor` of the previous page. Opaque; never build or edit it. */
  cursor?: string;
}

// ─── Me ─────────────────────────────────────────────────────────────────────

export interface Me {
  id: number;
  name: string | null;
  email: string | null;
  avatar_url: string | null;
  time_zone: string | null;
  token: {
    id: number;
    kind: "pat" | "org" | "legacy";
    scopes: string[];
    organization_id: number | null;
    expires_at: Timestamp | null;
  };
}

// ─── Projects ───────────────────────────────────────────────────────────────

export interface Project {
  id: number;
  name: string;
  acronym: string | null;
  color: string | null;
  type: string | null;
  status: string | null;
  start_date: DateString | null;
  end_date: DateString | null;
  time_zone: string | null;
  organization_id: number | null;
  role: "owner" | "member" | "viewer";
  archived: boolean;
  created_at: Timestamp | null;
  updated_at: Timestamp | null;
}

export interface WorkPackage {
  id: number;
  project_id: number;
  number: string | null;
  title: string;
  description: string | null;
  start_date: DateString | null;
  end_date: DateString | null;
  status: string | null;
  color: string | null;
}

export interface Activity {
  id: number;
  project_id: number;
  work_package_id: number | null;
  number: string | null;
  title: string;
  description: string | null;
  type: string | null;
  start_date: DateString | null;
  end_date: DateString | null;
  status: string | null;
  location: string | null;
  is_online: boolean;
}

export interface ActivityListParams extends ListParams {
  work_package_id?: Id;
}

// ─── Tasks ──────────────────────────────────────────────────────────────────

export type TaskStatus = "todo" | "in_progress" | "stuck" | "done";
export type TaskPriority = "low" | "medium" | "high" | "urgent";

export interface TaskHelper {
  member_id: number;
  user_id: number | null;
}

export interface Task {
  id: number;
  project_id: number;
  title: string;
  description?: string | null;
  status: TaskStatus;
  is_review: boolean;
  priority: string | null;
  due_date: DateString | null;
  start_date: DateString | null;
  /** The Owner: the assignee, else the leader. */
  owner_user_id: number | null;
  /** Helpers (project member ids). */
  helpers: TaskHelper[];
  partner_id: number | null;
  work_package_id: number | null;
  activity_id: number | null;
  can_edit: boolean;
  created_at: Timestamp | null;
  updated_at: Timestamp | null;
}

export interface TaskListParams extends ListParams {
  status?: TaskStatus;
}

export interface TaskCreate {
  /** 1 to 512 characters. */
  title: string;
  /** Up to 10000 characters. */
  description?: string;
  status?: TaskStatus;
  priority?: TaskPriority;
  due_date?: DateString | null;
  start_date?: DateString | null;
  owner_user_id?: number | null;
  /** Up to 20 project member ids. */
  helper_member_ids?: number[];
  partner_id?: number | null;
  work_package_id?: number | null;
  activity_id?: number | null;
}

export type TaskUpdate = Partial<TaskCreate>;

// ─── Milestones ─────────────────────────────────────────────────────────────

export interface Milestone {
  id: number;
  project_id: number;
  title: string;
  description: string | null;
  due_date: DateString | null;
  completed: boolean;
  completed_at: Timestamp | null;
  color: string | null;
  created_at: Timestamp | null;
  updated_at: Timestamp | null;
}

export interface MilestoneCreate {
  /** 1 to 255 characters. */
  title: string;
  description?: string;
  due_date?: DateString | null;
  /** `#RRGGBB`. */
  color?: string;
}

export interface MilestoneUpdate extends Partial<MilestoneCreate> {
  completed?: boolean;
}

// ─── Members ────────────────────────────────────────────────────────────────

export interface Member {
  id: string;
  user_id: number | null;
  name: string | null;
  /** Shown only when the person lets other members see it. */
  email: string | null;
  role: string | null;
  partner: { id: number; name: string | null } | null;
  is_project_owner: boolean;
  is_coordinator: boolean;
}

// ─── Files ──────────────────────────────────────────────────────────────────

export interface ProjectFile {
  id: number;
  project_id: number;
  name: string;
  type: string;
  is_folder: boolean;
  parent_id: number | null;
  mime_type: string | null;
  size: number | null;
  visibility: string | null;
  downloadable: boolean;
  created_at: Timestamp | null;
  updated_at: Timestamp | null;
}

export interface FileListParams extends ListParams {
  /** A folder id, or `"root"` for the top level. */
  parent_id?: Id | "root";
}

/** A signed download link, valid for 5 minutes. */
export interface DownloadLink {
  url: string;
  expires_at: Timestamp;
}

export interface UploadCreate {
  /** 1 to 255 characters. */
  name: string;
  /** Bytes, 1 to 16777216 (16 MB) and within your plan's per-file limit. */
  size: number;
  /** For example `application/pdf`. */
  mime_type: string;
  /** A folder of the project, or null for the top level. */
  parent_id?: number | null;
}

/** Step 1 of an upload: where to send the bytes. */
export interface Upload {
  id: string;
  upload_url: string;
  method: "PUT";
  max_bytes: number;
  expires_at: Timestamp;
}

// ─── Calendar ───────────────────────────────────────────────────────────────

export type CalendarEventStatus = "scheduled" | "confirmed" | "cancelled" | "completed";

export interface CalendarEvent {
  id: number;
  project_id: number;
  title: string;
  description: string | null;
  type: string | null;
  start_date: DateString | null;
  end_date: DateString | null;
  start_time: TimeString | null;
  end_time: TimeString | null;
  all_day: boolean;
  /** IANA zone of the wall-clock times (null: floating local time). */
  time_zone: string | null;
  location: string | null;
  is_online: boolean;
  meeting_url: string | null;
  status: string | null;
  attendees: string[];
  /** RFC 5545 RRULE of a repeating event. */
  recurrence: string | null;
  created_at: Timestamp | null;
  updated_at: Timestamp | null;
}

export interface CalendarEventListParams extends ListParams {
  from?: DateString;
  to?: DateString;
}

export interface CalendarEventCreate {
  title: string;
  start_date: DateString;
  description?: string;
  type?: string;
  end_date?: DateString;
  start_time?: TimeString;
  end_time?: TimeString;
  /** IANA time zone such as `Europe/Vilnius`. */
  time_zone?: string;
  location?: string;
  is_online?: boolean;
  /** http(s) URL. */
  meeting_url?: string;
  status?: CalendarEventStatus;
  /** Up to 200 entries. */
  attendees?: string[];
}

export type CalendarEventUpdate = Partial<CalendarEventCreate>;

/** An item of your own calendar (`GET /calendar`, schema CalendarItem). */
export interface CalendarItem {
  /** Stable across sources: `<source>:<id>`. */
  id: string;
  /** personal, project_event, activity, meeting_note, meeting, reminder, milestone, poll, task or external. */
  source: string | null;
  title: string | null;
  start_date: DateString | null;
  end_date: DateString | null;
  start_time: TimeString | null;
  end_time: TimeString | null;
  all_day: boolean;
  time_zone: string | null;
  location: string | null;
  meeting_url: string | null;
  status: string | null;
  /** null for a personal item (never sent to a limited or organisation token). */
  project: { id: number; name: string | null } | null;
}

export interface CalendarRange {
  /** First day, `YYYY-MM-DD`. */
  from: DateString;
  /** Last day, at most 366 days after `from`. */
  to: DateString;
}

// ─── Meetings ───────────────────────────────────────────────────────────────

export interface Meeting {
  id: number;
  project_id: number;
  title: string | null;
  type: string | null;
  date: DateString | null;
  start_time: TimeString | null;
  end_time: TimeString | null;
  time_zone: string | null;
  location: string | null;
  is_online: boolean;
  meeting_url: string | null;
  status: string | null;
  agenda: string | null;
  notes: string | null;
  decisions: string | null;
  action_items: string | null;
  created_at: Timestamp | null;
  updated_at: Timestamp | null;
}

// ─── Webhook endpoints ──────────────────────────────────────────────────────

export type WebhookEventType =
  | "task.created"
  | "task.updated"
  | "task.deleted"
  | "milestone.created"
  | "milestone.updated"
  | "milestone.deleted"
  | "file.created"
  | "file.deleted"
  | "member.added"
  | "member.removed"
  | "calendar_event.created"
  | "calendar_event.updated"
  | "calendar_event.deleted"
  | "project.updated";

export const WEBHOOK_EVENT_TYPES: readonly WebhookEventType[] = [
  "task.created",
  "task.updated",
  "task.deleted",
  "milestone.created",
  "milestone.updated",
  "milestone.deleted",
  "file.created",
  "file.deleted",
  "member.added",
  "member.removed",
  "calendar_event.created",
  "calendar_event.updated",
  "calendar_event.deleted",
  "project.updated",
];

export interface WebhookEndpoint {
  id: number;
  description: string;
  /** Masked: host and the start of the path. */
  url: string;
  events: string[];
  project_ids: number[] | null;
  enabled: boolean;
  disabled_reason: string | null;
  consecutive_failures: number;
  last_status: string | null;
  last_delivery_at: Timestamp | null;
  created_at: Timestamp;
}

export interface WebhookEndpointWithSecret {
  endpoint: WebhookEndpoint;
  /** `whsec_...`, shown once. Store it in your secret manager. */
  secret: string;
}

export interface WebhookEndpointCreate {
  /** A public https URL, 8 to 2048 characters. */
  url: string;
  /** 1 to 200 characters. */
  description: string;
  /** 1 to 20 event types. */
  events: WebhookEventType[];
  /** Limit to these projects (up to 100), or null for all the token reaches. */
  project_ids?: number[] | null;
}

export interface WebhookEndpointUpdate extends Partial<Omit<WebhookEndpointCreate, "project_ids">> {
  project_ids?: number[] | null;
  /** true turns a disabled endpoint back on. */
  enabled?: boolean;
}

export interface WebhookDelivery {
  id: number;
  event_id: number;
  event: string;
  status: string;
  attempts: number;
  response_code: number | null;
  error: string | null;
  next_attempt_at: Timestamp | null;
  created_at: Timestamp;
  delivered_at: Timestamp | null;
}

export interface WebhookTestResult {
  status: string;
  response_code: number | null;
  error: string | null;
}

/** The body of a webhook delivery (thin: ids only). */
export interface WebhookEvent {
  /** `evt_<number>`, stable across retries of the same event. */
  id: string;
  type: WebhookEventType | "ping";
  api_version: string;
  created_at: Timestamp;
  delivery_id: number;
  data: {
    object: string;
    id?: number | string;
    project_id?: number;
  };
  actor_user_id: number | null;
}

// ─── AI agents (Enterprise) ─────────────────────────────────────────────────
// Schemas Agent, AgentItem and AgentNote. These routes keep the camelCase field
// names of their earlier API, unlike the rest of the API.

export interface Agent {
  id: number;
  name: string;
  organization: { id: number; name: string | null };
  status: string;
  pausedReason: string | null;
  /** Whether you are one of the people the agent reports to. */
  principal: boolean;
}

export interface AgentItem {
  id: number;
  /** briefing, report, alert, forecast, analysis, draft, proposal, note, tuning, answer or notice. */
  kind: string;
  severity: string;
  title: string;
  body: string;
  project: { id: number; name: string | null } | null;
  citations: Array<{ label: string; path: string }>;
  aiGenerated: true;
  /** The AI notice to show next to the item. */
  notice: string;
  status: string;
  read: boolean;
  createdAt: Timestamp | null;
}

export interface AgentItemListParams {
  /** 1 to 50 (default 20). */
  limit?: number;
  /** A next_cursor from a previous page (opaque, signed). The legacy numeric cursor is still accepted. */
  cursor?: string;
}

/** The wire shape of GET /agents/{agent_id}/items. */
export interface AgentItemListResponse {
  data: AgentItem[];
  /** Opaque, signed cursor of the next page; null on the last page. Preferred. */
  next_cursor: string | null;
  /** Legacy numeric cursor, kept for earlier clients. */
  nextCursor: number | null;
}

export type AgentNoteKind = "handoff" | "dependency" | "risk" | "question";

export type AgentNoteRefType =
  | "project"
  | "task"
  | "meeting"
  | "budget_line"
  | "expense"
  | "risk"
  | "milestone"
  | "partner"
  | "work_package"
  | "activity"
  | "calendar_event";

/** A note to an agent. It is treated as untrusted input, never as an instruction. */
export interface AgentNoteCreate {
  kind: AgentNoteKind;
  /** Up to 500 characters. */
  text: string;
  /** A project the agent reads (camelCase, as in the earlier agent API). */
  folderId?: number | null;
  /** Up to 10 references inside that project. */
  refs?: Array<{ type: AgentNoteRefType; id: number }>;
}

export interface AgentNoteResult {
  id: number | null;
  status: "delivered";
}
