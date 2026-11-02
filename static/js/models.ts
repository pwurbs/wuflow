// JSON shapes of the API resources. Mirror of the structs in backend/models.go — keep in sync
// when changing. Pointer fields are `| null`; timestamps are ISO 8601 strings.
import type { Priority, ReleaseStatus } from './domain-constants.ts';
import type { IssueStatus } from './status-config.ts';
import type { Role } from './permissions.ts';

export interface User {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  role: Role;
  active: boolean;
  created_at: string;
  updated_at: string;
  last_login: string | null;
}

// User embedded in another resource (assignee, owner, comment author): only these fields are filled.
export type UserRef = Pick<User, 'id' | 'email' | 'first_name' | 'last_name'>;

export interface Project {
  id: number;
  name: string;
  description: string;
}

export interface Label {
  id: number;
  name: string;
  color: string;
  project_id: number;
}

// Label embedded in an issue: only these fields are filled.
export type LabelRef = Pick<Label, 'id' | 'name' | 'color'>;

export interface Task {
  id: number;
  issue_id: number;
  title: string;
  done: boolean;
  position: number;
  deadline: string | null;
  created_at: string;
  updated_at: string;
}

export interface Release {
  id: number;
  project_id: number;
  name: string;
  description: string;
  start_date: string | null;
  release_date: string | null;
  closed_at: string | null;
  status: ReleaseStatus;
  owner_id: number | null;
  owner?: UserRef;
  created_at: string;
  updated_at: string;
}

// Release embedded in an issue: only these fields are filled.
export type ReleaseRef = Pick<Release, 'id' | 'name' | 'status' | 'release_date'>;

export interface Issue {
  id: number;
  title: string;
  description: string;
  status: IssueStatus;
  position: number;
  deadline: string | null;
  planned_dates: string[] | null; // YYYY-MM-DD
  priority: Priority;
  creator_id: number;
  assignee_id: number | null;
  updated_by: number | null;
  project_id: number;
  release_id: number | null;
  assignee?: UserRef;
  label: LabelRef | null;
  release: ReleaseRef | null;
  project?: Project;
  tasks: Task[] | null;
  created_at: string;
  updated_at: string;
}

export interface StatusConfig {
  project_id: number;
  stage1_name: string;
  stage2_name: string;
  stage3_name: string;
  stage4_name: string;
}

export type HistoryEvent = 'created' | 'updated' | 'archived' | 'unarchived' | 'moved' | 'task';

export interface HistoryEntry {
  id: number;
  issue_id: number;
  user_id: number | null;
  user?: UserRef;
  event: HistoryEvent;
  data: { field?: string; from?: string; to?: string; detail?: string };
  created_at: string;
}

export interface Comment {
  id: number;
  issue_id: number;
  user_id: number | null;
  user?: UserRef;
  body: string;
  edited: boolean;
  created_at: string;
  updated_at: string;
}

// One entry of a reorder request (PUT …/positions).
export interface PositionUpdate {
  id: number;
  position: number;
}
