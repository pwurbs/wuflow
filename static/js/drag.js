// Shared drag state
export let draggedCard = null;
export let draggedCardOrigin = null;

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
export let draggedTask = null;

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
