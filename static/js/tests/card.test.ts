import { describe, it, expect, vi } from 'vitest';
import { createCardElement } from '../components/card.ts';
import { makeIssue, makeRelease, makeTask, makeUserRef } from './fixtures.ts';
import { bySelector } from '../utils.ts';

const issue = makeIssue({
  id: 7,
  title: 'Card Issue',
  status: 'Todo',
  priority: 'Normal',
  deadline: '2030-05-10',
  tasks: [
    makeTask({ id: 1, title: 'Open task', done: false, deadline: '2030-05-09' }),
    makeTask({ id: 2, title: 'Done task', done: true }),
  ],
});

describe('createCardElement', () => {
  it.each([
    ['board card', true],
    ['backlog row', false],
  ])('%s shows deadline and open tasks without emoji', (_, isBoard) => {
    const card = createCardElement(issue, isBoard);

    expect(card.textContent).not.toMatch(/📅|☐/u);
    expect(bySelector(card, '.board-task-icon').textContent).toBe('');
    expect(bySelector(card, '.board-task-icon').getAttribute('aria-hidden')).toBe('true');
    expect(bySelector(card, '.tooltip-icon').textContent).toBe('');
    expect(bySelector(card, '.tooltip-deadline').textContent.trim()).not.toBe('');
  });

  it.each([
    ['board card', true, '.board-card-deadline'],
    ['backlog row', false, '.backlog-card-deadline'],
  ])('%s shows the deadline day itself, not the day before', (_, isBoard, selector) => {
    const card = createCardElement(issue, isBoard);
    expect(bySelector(card, selector).textContent).toBe(new Date(2030, 4, 10).toLocaleDateString(navigator.language, { month: 'numeric', day: 'numeric', year: 'numeric' }));
    expect(bySelector(card, '.tooltip-deadline').textContent).toBe(new Date(2030, 4, 9).toLocaleDateString(navigator.language, { month: 'numeric', day: 'numeric' }));
  });
});

describe('createCardElement options (My Work)', () => {
  const assigned = makeIssue({
    id: 8,
    title: 'Assigned',
    status: 'Stage2',
    assignee_id: 3,
    assignee: makeUserRef({ id: 3, first_name: 'Ada', last_name: 'Lovelace' }),
    release_id: 4,
    release: makeRelease({ id: 4, name: 'v2.0' }),
  });

  it('without options is the project board card: assignee badge, release chip, draggable, no stage chip', () => {
    const card = createCardElement(assigned, true);

    expect(bySelector(card, '.user-badge').textContent).toBe('AL');
    expect(bySelector(card, '.release-chip').textContent).toBe('v2.0');
    expect(card.querySelector('.stage-chip')).toBeNull();
    expect(card.draggable).toBe(true);
  });

  it('shows the column name in the release chip\'s place, without assignee badge and release', () => {
    const card = createCardElement(assigned, true, {}, { showAssignee: false, showRelease: false, stageName: 'Testing', draggable: false });

    expect(card.querySelector('.user-badge')).toBeNull();
    expect(card.textContent).not.toContain('v2.0');
    const chip = bySelector(card, '.board-card-label-space .release-chip.stage-chip');
    expect(chip.textContent).toBe('Testing');
    expect(chip.title).toBe('Status: Testing');
    expect(card.draggable).toBe(false);
  });

  it('leaves the release chip\'s place empty without a column name', () => {
    const card = createCardElement(assigned, true, {}, { showAssignee: false, showRelease: false });

    expect(card.querySelector('.release-chip')).toBeNull();
  });

  it('escapes the column name', () => {
    const card = createCardElement(assigned, true, {}, { showRelease: false, stageName: '<img src=x onerror=alert(1)>' });

    expect(card.querySelector('img')).toBeNull();
    expect(bySelector(card, '.stage-chip').textContent).toBe('<img src=x onerror=alert(1)>');
  });
});

describe('createCardElement context menu: assign entry', () => {
  function menuItems(callbacks: Parameters<typeof createCardElement>[2]) {
    const card = createCardElement(issue, true, { onTogglePriority: vi.fn(), ...callbacks });
    card.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    return [...document.querySelectorAll<HTMLButtonElement>('.card-context-menu-item')];
  }

  it('shows Unassign instead of Assign to me when the card has onUnassign', () => {
    const onUnassign = vi.fn();
    const items = menuItems({ onUnassign });

    expect(items.map(i => i.textContent)).not.toContain('Assign to me');
    const unassign = items.find(i => i.textContent === 'Unassign');
    expect(unassign?.disabled).toBe(false);
    unassign?.click();
    expect(onUnassign).toHaveBeenCalled();
  });

  it('shows Assign to me when the card has onAssignToMe', () => {
    const onAssignToMe = vi.fn();
    const items = menuItems({ onAssignToMe });

    expect(items.map(i => i.textContent)).not.toContain('Unassign');
    const assign = items.find(i => i.textContent === 'Assign to me');
    expect(assign?.disabled).toBe(false);
    assign?.click();
    expect(onAssignToMe).toHaveBeenCalled();
  });

  it('shows Assign to me disabled without either callback', () => {
    const assign = menuItems({}).find(i => i.textContent === 'Assign to me');
    expect(assign?.disabled).toBe(true);
  });
});
