import { describe, it, expect, beforeEach } from 'vitest';
import {
  getDraggedCard, setDraggedCard,
  getDraggedCardOrigin, setDraggedCardOrigin,
  getDragSuccess, setDragSuccess,
  getDraggedTask, setDraggedTask,
  getDragAfterElement,
  getDragAfterTaskElement,
} from '../drag.js';

// Build a container with positioned elements whose bounding rects are mocked.
function makeContainer(selector, items) {
  const container = document.createElement('div');
  for (const { top, height, isDragging = false } of items) {
    const el = document.createElement('div');
    el.className = isDragging ? `${selector} dragging` : selector;
    el.getBoundingClientRect = () => ({ top, height });
    container.appendChild(el);
  }
  return container;
}

describe('drag state', () => {
  it('card state: set and get', () => {
    const card = document.createElement('div');
    setDraggedCard(card);
    expect(getDraggedCard()).toBe(card);
    setDraggedCard(null);
    expect(getDraggedCard()).toBeNull();
  });

  it('card origin state: set and get', () => {
    const origin = document.createElement('div');
    setDraggedCardOrigin(origin);
    expect(getDraggedCardOrigin()).toBe(origin);
    setDraggedCardOrigin(null);
  });

  it('drag success state: set and get', () => {
    setDragSuccess(true);
    expect(getDragSuccess()).toBe(true);
    setDragSuccess(false);
    expect(getDragSuccess()).toBe(false);
  });

  it('task state: set and get', () => {
    const task = document.createElement('li');
    setDraggedTask(task);
    expect(getDraggedTask()).toBe(task);
    setDraggedTask(null);
    expect(getDraggedTask()).toBeNull();
  });
});

describe('getDragAfterElement', () => {
  // Card layout used in most tests:
  //   Card A: top=100, height=50 → midpoint=125
  //   Card B: top=200, height=50 → midpoint=225
  //   Card C: top=300, height=50 → midpoint=325
  let column;

  beforeEach(() => {
    column = makeContainer('card', [
      { top: 100, height: 50 },
      { top: 200, height: 50 },
      { top: 300, height: 50 },
    ]);
  });

  it('returns undefined when column has no cards', () => {
    const empty = document.createElement('div');
    expect(getDragAfterElement(empty, 150)).toBeUndefined();
  });

  it('returns undefined when cursor is below all card midpoints', () => {
    // y=400 is below card C midpoint (325) → all offsets positive
    expect(getDragAfterElement(column, 400)).toBeUndefined();
  });

  it('returns first card when cursor is above its midpoint', () => {
    // y=100 → card A offset = 100-100-25 = -25 (closest to 0 from below)
    const cards = [...column.querySelectorAll('.card')];
    expect(getDragAfterElement(column, 100)).toBe(cards[0]);
  });

  it('returns second card when cursor is between first and second midpoints', () => {
    // y=160: card A offset = 160-100-25 = 35 (positive, ignored)
    //        card B offset = 160-200-25 = -65 (negative, candidate)
    //        card C offset = 160-300-25 = -165 (more negative)
    const cards = [...column.querySelectorAll('.card')];
    expect(getDragAfterElement(column, 160)).toBe(cards[1]);
  });

  it('returns third card when cursor is between second and third midpoints', () => {
    // y=260: card A offset=135 (>0), card B offset=35 (>0), card C offset=-65
    const cards = [...column.querySelectorAll('.card')];
    expect(getDragAfterElement(column, 260)).toBe(cards[2]);
  });

  it('excludes dragging card from candidates', () => {
    const col = makeContainer('card', [
      { top: 100, height: 50, isDragging: true },
      { top: 200, height: 50 },
    ]);
    // y=150: dragging card is excluded, card B offset=-75 → returns card B
    const nonDragging = col.querySelector('.card:not(.dragging)');
    expect(getDragAfterElement(col, 150)).toBe(nonDragging);
  });
});

describe('getDragAfterTaskElement', () => {
  it('returns undefined when container has no task items', () => {
    const empty = document.createElement('div');
    expect(getDragAfterTaskElement(empty, 100)).toBeUndefined();
  });

  it('returns task below cursor', () => {
    const container = makeContainer('task-item', [
      { top: 50, height: 40 },
      { top: 120, height: 40 },
    ]);
    // y=60: task A offset=60-50-20=-10, task B offset=60-120-20=-80 → task A is closest
    const tasks = [...container.querySelectorAll('.task-item')];
    expect(getDragAfterTaskElement(container, 60)).toBe(tasks[0]);
  });

  it('returns undefined when cursor is below all task midpoints', () => {
    const container = makeContainer('task-item', [
      { top: 50, height: 40 },
    ]);
    expect(getDragAfterTaskElement(container, 300)).toBeUndefined();
  });

  it('excludes dragging task', () => {
    const container = makeContainer('task-item', [
      { top: 50, height: 40, isDragging: true },
      { top: 120, height: 40 },
    ]);
    const nonDragging = container.querySelector('.task-item:not(.dragging)');
    expect(getDragAfterTaskElement(container, 80)).toBe(nonDragging);
  });
});
