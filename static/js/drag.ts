// Shared drag state
let draggedCard: HTMLElement | null = null;
// Where the card sat before the drag, to put it back when it is dropped outside a list.
let draggedCardOrigin: { parent: ParentNode; nextSibling: Element | null } | null = null;
let dragSuccess = false;

export const getDraggedCard = () => draggedCard;
export const getDraggedCardOrigin = () => draggedCardOrigin;
export const getDragSuccess = () => dragSuccess;

export function setDragSuccess(success: boolean) {
  dragSuccess = success;
}

export function setDraggedCard(card: HTMLElement | null) {
  draggedCard = card;
}

export function setDraggedCardOrigin(origin: typeof draggedCardOrigin) {
  draggedCardOrigin = origin;
}

export function getDragAfterElement(column: Element, y: number) {
  const draggableElements = [...column.querySelectorAll('.card:not(.dragging)')];

  return draggableElements.reduce<{ offset: number; element?: Element }>((closest, child) => {
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
let draggedTask: HTMLElement | null = null;

export const getDraggedTask = () => draggedTask;

export function setDraggedTask(task: HTMLElement | null) {
  draggedTask = task;
}

export function getDragAfterTaskElement(container: Element, y: number) {
  const draggableElements = [...container.querySelectorAll('.task-item:not(.dragging)')];

  return draggableElements.reduce<{ offset: number; element?: Element }>((closest, child) => {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;

    if (offset < 0 && offset > closest.offset) {
      return { offset: offset, element: child };
    } else {
      return closest;
    }
  }, { offset: Number.NEGATIVE_INFINITY }).element;
}
