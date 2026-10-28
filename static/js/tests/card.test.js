import { describe, it, expect } from 'vitest';
import { createCardElement } from '../components/card.js';

const issue = {
  id: 7,
  title: 'Card Issue',
  status: 'Todo',
  priority: 'Normal',
  deadline: '2030-05-10T00:00:00Z',
  tasks: [
    { id: 1, title: 'Open task', done: false, deadline: '2030-05-09T00:00:00Z' },
    { id: 2, title: 'Done task', done: true },
  ],
};

describe('createCardElement', () => {
  it.each([
    ['board card', true],
    ['backlog row', false],
  ])('%s shows deadline and open tasks without emoji', (_, isBoard) => {
    const card = createCardElement(issue, isBoard);

    expect(card.textContent).not.toMatch(/📅|☐/u);
    expect(card.querySelector('.board-task-icon').textContent).toBe('');
    expect(card.querySelector('.board-task-icon').getAttribute('aria-hidden')).toBe('true');
    expect(card.querySelector('.tooltip-icon').textContent).toBe('');
    expect(card.querySelector('.tooltip-deadline').textContent.trim()).not.toBe('');
  });
});
