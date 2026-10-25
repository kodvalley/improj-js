import { pathId, type RequestOptions } from "../core.js";
import type { PagePromise } from "../pagination.js";
import type { ActivityListParams, Activity, Id, ListParams, Me, Meeting, Member, Project, WorkPackage } from "../types.js";
import { Resource } from "./base.js";

/** `GET /me` (scope `user:read`). */
export class MeResource extends Resource {
  /** The token's owner and the token itself. */
  get(options?: RequestOptions): Promise<Me> {
    return this.getOne<Me>("/me", options);
  }
}

/** Projects, work packages and activities (scope `projects:read`). */
export class ProjectsResource extends Resource {
  /** Projects the token reaches. */
  list(params?: ListParams, options?: RequestOptions): PagePromise<Project> {
    return this.page_<Project>("/projects", params, options);
  }

  get(projectId: Id, options?: RequestOptions): Promise<Project> {
    return this.getOne<Project>(`/projects/${pathId(projectId, "projectId")}`, options);
  }

  workPackages(projectId: Id, params?: ListParams, options?: RequestOptions): PagePromise<WorkPackage> {
    return this.page_<WorkPackage>(`/projects/${pathId(projectId, "projectId")}/work-packages`, params, options);
  }

  activities(projectId: Id, params?: ActivityListParams, options?: RequestOptions): PagePromise<Activity> {
    const { work_package_id, ...rest } = params ?? {};
    const query = work_package_id === undefined ? rest : { ...rest, work_package_id: pathId(work_package_id, "work_package_id") };
    return this.page_<Activity>(`/projects/${pathId(projectId, "projectId")}/activities`, query, options);
  }

  private page_<T>(path: string, params: object | undefined, options?: RequestOptions): PagePromise<T> {
    return this.paginate<T>(path, params as ListParams & Record<string, unknown>, options);
  }
}

/** Project members (scope `members:read`). Email addresses follow each person's privacy setting. */
export class MembersResource extends Resource {
  list(projectId: Id, params?: ListParams, options?: RequestOptions): PagePromise<Member> {
    return this.paginate<Member>(`/projects/${pathId(projectId, "projectId")}/members`, params as ListParams & Record<string, unknown>, options);
  }
}

/** Project meetings (scope `meetings:read`). */
export class MeetingsResource extends Resource {
  list(projectId: Id, params?: ListParams, options?: RequestOptions): PagePromise<Meeting> {
    return this.paginate<Meeting>(`/projects/${pathId(projectId, "projectId")}/meetings`, params as ListParams & Record<string, unknown>, options);
  }

  get(projectId: Id, meetingId: Id, options?: RequestOptions): Promise<Meeting> {
    return this.getOne<Meeting>(`/projects/${pathId(projectId, "projectId")}/meetings/${pathId(meetingId, "meetingId")}`, options);
  }
}
