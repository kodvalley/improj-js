import { pathId, type RequestOptions } from "../core.js";
import type { PagePromise } from "../pagination.js";
import type {
  CalendarEvent,
  CalendarEventCreate,
  CalendarEventListParams,
  CalendarEventUpdate,
  CalendarItem,
  CalendarRange,
  Id,
  ListParams,
  Milestone,
  MilestoneCreate,
  MilestoneUpdate,
  Task,
  TaskCreate,
  TaskListParams,
  TaskUpdate,
} from "../types.js";
import { Resource } from "./base.js";

type Params = ListParams & Record<string, unknown>;
const project = (id: Id) => `/projects/${pathId(id, "projectId")}`;

/** Tasks (scopes `tasks:read`, `tasks:write`). */
export class TasksResource extends Resource {
  list(projectId: Id, params?: TaskListParams, options?: RequestOptions): PagePromise<Task> {
    return this.paginate<Task>(`${project(projectId)}/tasks`, params as Params, options);
  }

  get(projectId: Id, taskId: Id, options?: RequestOptions): Promise<Task> {
    return this.getOne<Task>(`${project(projectId)}/tasks/${pathId(taskId, "taskId")}`, options);
  }

  /** Creates a task. Helpers are all-or-nothing. Sends an Idempotency-Key. */
  create(projectId: Id, input: TaskCreate, options?: RequestOptions): Promise<Task> {
    return this.send<Task>("POST", `${project(projectId)}/tasks`, input, options);
  }

  /** Changes only the fields you send; `null` clears a nullable field. */
  update(projectId: Id, taskId: Id, input: TaskUpdate, options?: RequestOptions): Promise<Task> {
    return this.send<Task>("PATCH", `${project(projectId)}/tasks/${pathId(taskId, "taskId")}`, input, options);
  }

  delete(projectId: Id, taskId: Id, options?: RequestOptions): Promise<void> {
    return this.remove(`${project(projectId)}/tasks/${pathId(taskId, "taskId")}`, options);
  }
}

/** Milestones (scopes `milestones:read`, `milestones:write`). */
export class MilestonesResource extends Resource {
  list(projectId: Id, params?: ListParams, options?: RequestOptions): PagePromise<Milestone> {
    return this.paginate<Milestone>(`${project(projectId)}/milestones`, params as Params, options);
  }

  get(projectId: Id, milestoneId: Id, options?: RequestOptions): Promise<Milestone> {
    return this.getOne<Milestone>(`${project(projectId)}/milestones/${pathId(milestoneId, "milestoneId")}`, options);
  }

  create(projectId: Id, input: MilestoneCreate, options?: RequestOptions): Promise<Milestone> {
    return this.send<Milestone>("POST", `${project(projectId)}/milestones`, input, options);
  }

  update(projectId: Id, milestoneId: Id, input: MilestoneUpdate, options?: RequestOptions): Promise<Milestone> {
    return this.send<Milestone>("PATCH", `${project(projectId)}/milestones/${pathId(milestoneId, "milestoneId")}`, input, options);
  }

  delete(projectId: Id, milestoneId: Id, options?: RequestOptions): Promise<void> {
    return this.remove(`${project(projectId)}/milestones/${pathId(milestoneId, "milestoneId")}`, options);
  }
}

/** Project calendar events (scopes `calendar:read`, `calendar:write`). A repeating event is changed or deleted as a whole series. */
export class CalendarEventsResource extends Resource {
  list(projectId: Id, params?: CalendarEventListParams, options?: RequestOptions): PagePromise<CalendarEvent> {
    return this.paginate<CalendarEvent>(`${project(projectId)}/calendar-events`, params as Params, options);
  }

  get(projectId: Id, eventId: Id, options?: RequestOptions): Promise<CalendarEvent> {
    return this.getOne<CalendarEvent>(`${project(projectId)}/calendar-events/${pathId(eventId, "eventId")}`, options);
  }

  create(projectId: Id, input: CalendarEventCreate, options?: RequestOptions): Promise<CalendarEvent> {
    return this.send<CalendarEvent>("POST", `${project(projectId)}/calendar-events`, input, options);
  }

  update(projectId: Id, eventId: Id, input: CalendarEventUpdate, options?: RequestOptions): Promise<CalendarEvent> {
    return this.send<CalendarEvent>("PATCH", `${project(projectId)}/calendar-events/${pathId(eventId, "eventId")}`, input, options);
  }

  delete(projectId: Id, eventId: Id, options?: RequestOptions): Promise<void> {
    return this.remove(`${project(projectId)}/calendar-events/${pathId(eventId, "eventId")}`, options);
  }
}

/** Your own calendar across projects (`GET /calendar`, scope `calendar:read`). */
export class CalendarResource extends Resource {
  /** Items between two days (at most 366 days apart). Not paginated. */
  list(range: CalendarRange, options?: RequestOptions): Promise<CalendarItem[]> {
    return this.getOne<CalendarItem[]>("/calendar", options, { from: range.from, to: range.to });
  }
}
