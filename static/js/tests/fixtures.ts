// Complete API objects for tests: each factory fills every field with an empty or neutral
// value, so a test states only the fields it is about.
import type { Comment, HistoryEntry, Issue, Label, Project, Release, StatusConfig, Task, User, UserRef } from '../models.ts';
import type { IssueWrite } from '../api.ts';

const TIMESTAMP = '2026-01-01T00:00:00Z';

export function makeUser(overrides: Partial<User> = {}): User {
  return {
    id: 1, email: 'user@example.com', first_name: '', last_name: '', role: 'user', active: true,
    created_at: TIMESTAMP, updated_at: TIMESTAMP, last_login: null,
    ...overrides,
  };
}

export function makeUserRef(overrides: Partial<UserRef> = {}): UserRef {
  return { id: 1, email: 'user@example.com', first_name: '', last_name: '', ...overrides };
}

export function makeProject(overrides: Partial<Project> = {}): Project {
  return { id: 1, name: '', description: '', ...overrides };
}

export function makeLabel(overrides: Partial<Label> = {}): Label {
  return { id: 1, name: '', color: '#000000', project_id: 1, ...overrides };
}

export function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: 1, issue_id: 1, title: '', done: false, position: 0, deadline: null,
    created_at: TIMESTAMP, updated_at: TIMESTAMP,
    ...overrides,
  };
}

export function makeRelease(overrides: Partial<Release> = {}): Release {
  return {
    id: 1, project_id: 1, name: '', description: '', start_date: null, release_date: null,
    closed_at: null, status: 'open', owner_id: null,
    created_at: TIMESTAMP, updated_at: TIMESTAMP,
    ...overrides,
  };
}

export function makeIssue(overrides: Partial<Issue> = {}): Issue {
  return {
    id: 1, title: '', description: '', status: 'Open', position: 0, deadline: null,
    planned_dates: null, priority: 'Normal', creator_id: 1, assignee_id: null, updated_by: null,
    project_id: 1, release_id: null, label: null, release: null, tasks: null,
    created_at: TIMESTAMP, updated_at: TIMESTAMP,
    ...overrides,
  };
}

// The issue the server answers a save with: the sent fields, with label and deadline as stored.
export function savedIssue(sent: IssueWrite & { id: number }): Issue {
  const { label, deadline, ...fields } = sent;
  return makeIssue({
    ...fields,
    label: label && makeLabel(label),
    deadline: deadline instanceof Date ? deadline.toISOString() : deadline,
  });
}

export function makeStatusConfig(overrides: Partial<StatusConfig> = {}): StatusConfig {
  return { project_id: 1, stage1_name: '', stage2_name: '', stage3_name: '', stage4_name: '', ...overrides };
}

export function makeHistoryEntry(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return { id: 1, issue_id: 1, user_id: null, event: 'created', data: {}, created_at: TIMESTAMP, ...overrides };
}

export function makeComment(overrides: Partial<Comment> = {}): Comment {
  return {
    id: 1, issue_id: 1, user_id: null, body: '', edited: false,
    created_at: TIMESTAMP, updated_at: TIMESTAMP,
    ...overrides,
  };
}
