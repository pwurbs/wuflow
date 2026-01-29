// Shared drag state
let draggedCard = null;
let draggedCardOrigin = null;

export const getDraggedCard = () => draggedCard;
export const getDraggedCardOrigin = () => draggedCardOrigin;

export function setDraggedCard(card) {
  draggedCard = card;
}

export function setDraggedCardOrigin(origin) {
  draggedCardOrigin = origin;
}

export function getDragAfterElement(column, y) {
  const draggableElements = [...column.querySelectorAll('.card:not(.dragging)')];

  return draggableElements.reduce((closest, child) => {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;

    if (offset < 0 && offset > closest.offset) {
      return { offset: offset, element: child };
    } else {
      return closest;
    }
  }, { offset: Number.NEGATIVE_INFINITY }).element;
}

// Task drag helpers
let draggedTask = null;

export const getDraggedTask = () => draggedTask;

export function setDraggedTask(task) {
  draggedTask = task;
}

export function getDragAfterTaskElement(container, y) {
  const draggableElements = [...container.querySelectorAll('.task-item:not(.dragging)')];

  return draggableElements.reduce((closest, child) => {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;

    if (offset < 0 && offset > closest.offset) {
      return { offset: offset, element: child };
    } else {
      return closest;
    }
  }, { offset: Number.NEGATIVE_INFINITY }).element;
}
