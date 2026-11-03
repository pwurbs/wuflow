// Shared drag state
let draggedCard: HTMLElement | null = null;
// Where the card sat before the drag, to put it back when it is dropped outside a list.
let draggedCardOrigin: { parent: ParentNode | null; nextSibling: Element | null } | null = null;
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

// The first element matching selector in container whose vertical center is below y.
function getDragAfter(container: Element, selector: string, y: number): Element | null {
  const draggableElements = [...container.querySelectorAll(selector)];

  return draggableElements.reduce<{ offset: number; element?: Element }>((closest, child) => {
    const box = child.getBoundingClientRect();
    const offset = y - box.top - box.height / 2;

    if (offset < 0 && offset > closest.offset) {
      return { offset: offset, element: child };
    } else {
      return closest;
    }
  }, { offset: Number.NEGATIVE_INFINITY }).element ?? null;
}

export function getDragAfterElement(column: Element, y: number): Element | null {
  return getDragAfter(column, '.card:not(.dragging)', y);
}

// Task drag helpers
let draggedTask: HTMLElement | null = null;

export const getDraggedTask = () => draggedTask;

export function setDraggedTask(task: HTMLElement | null) {
  draggedTask = task;
}

export function getDragAfterTaskElement(container: Element, y: number): Element | null {
  return getDragAfter(container, '.task-item:not(.dragging)', y);
}
