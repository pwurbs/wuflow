import { byId, continueListOnEnter, showNotification } from '../utils.ts';
import { renderMarkdown, renderMarkdownWithReport } from '../markdown.ts';

function needsLeadingNewline(value: string, pos: number) {
  return pos > 0 && value[pos - 1] !== '\n';
}

// The description's inline editing in the edit modal, which Cmd/Ctrl+Enter saves and Escape discards.
export interface InlineEditor {
  isEditing: () => boolean;
  save: () => unknown;
  discard: () => unknown;
}

export function setupEditorToolbar(inlineEditor: InlineEditor) {
  const editor = byId('description-editor', HTMLTextAreaElement);
  const preview = byId('description-preview');

  function handleEnterKey(e: KeyboardEvent) {
    continueListOnEnter(editor, e);
  }

  function handleTabKey(e: KeyboardEvent) {
    e.preventDefault();
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    const value = editor.value;

    // If no text is selected, and Shift is NOT pressed, just insert two spaces.
    if (start === end && !e.shiftKey) {
      editor.value = value.substring(0, start) + '  ' + value.substring(end);
      editor.selectionStart = editor.selectionEnd = start + 2;
      editor.dispatchEvent(new Event('input'));
      return;
    }

    // Multi-line or Shift+Tab logic
    let adjustedEnd = end;
    if (end > start && value[end - 1] === '\n') {
      adjustedEnd = end - 1;
    }

    const lineStart = value.lastIndexOf('\n', start - 1) + 1;
    let lineEnd = value.indexOf('\n', adjustedEnd);
    if (lineEnd === -1) lineEnd = value.length;

    const beforeStr = value.substring(0, lineStart);
    const lines = value.substring(lineStart, lineEnd).split('\n');
    const afterStr = value.substring(lineEnd);

    let startOffset = 0;
    let endOffset = 0;

    const newLines = lines.map((line, idx) => {
      let newLine = line;
      let diff = 0;

      if (e.shiftKey) {
        if (newLine.startsWith('  ')) {
          newLine = newLine.substring(2);
          diff = -2;
        } else if (newLine.startsWith(' ') || newLine.startsWith('\t')) {
          newLine = newLine.substring(1);
          diff = -1;
        }
      } else {
        newLine = '  ' + newLine;
        diff = 2;
      }

      if (idx === 0) startOffset += diff;
      endOffset += diff;

      return newLine;
    });

    editor.value = beforeStr + newLines.join('\n') + afterStr;

    const newStart = Math.max(lineStart, start + startOffset);
    const newEnd = Math.max(lineStart, end + endOffset);

    editor.selectionStart = newStart;
    editor.selectionEnd = start === end ? newStart : newEnd;

    editor.dispatchEvent(new Event('input'));
  }

  editor.addEventListener('keydown', (e) => {
    // Saving and discarding only apply to the inline editor, not to the new-issue form.
    const inlineEditing = inlineEditor.isEditing();
    if (inlineEditing && e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void inlineEditor.save();
    } else if (inlineEditing && e.key === 'Escape') {
      e.preventDefault();
      void inlineEditor.discard();
    } else if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.metaKey) {
      handleEnterKey(e);
    } else if (e.key === 'Tab') {
      handleTabKey(e);
    }
  });

  function insertMarkdown(before: string, after = '') {
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    const selected = editor.value.slice(start, end);
    editor.value = editor.value.slice(0, start) + before + selected + after + editor.value.slice(end);
    editor.selectionStart = start + before.length;
    editor.selectionEnd = start + before.length + selected.length;
    editor.focus();
    preview.innerHTML = renderMarkdown(editor.value);
  }

  function applyList(type: 'ul' | 'ol') {
    const start = editor.selectionStart;
    const lines = editor.value.slice(start, editor.selectionEnd).split('\n');
    const replaced = lines.map((l, i) => type === 'ol' ? `${i + 1}. ` + l : '- ' + l).join('\n');
    editor.value = editor.value.slice(0, start) + replaced + editor.value.slice(editor.selectionEnd);
    editor.focus();
    preview.innerHTML = renderMarkdown(editor.value);
  }

  function applyHeading(level: 1 | 2) {
    const start = editor.selectionStart;
    const lines = editor.value.slice(start, editor.selectionEnd).split('\n');
    const prefix = level === 1 ? '# ' : '## ';
    const replaced = lines.map(l => prefix + l.replace(/^#+\s/, '')).join('\n');
    editor.value = editor.value.slice(0, start) + replaced + editor.value.slice(editor.selectionEnd);
    editor.focus();
    preview.innerHTML = renderMarkdown(editor.value);
  }

  function applyLink() {
    const selected = editor.value.slice(editor.selectionStart, editor.selectionEnd).trim();
    if (selected && /^https?:\/\//i.test(selected)) {
      insertMarkdown('[', `](${selected})`);
    } else {
      insertMarkdown('[', '](https://)');
    }
  }

  function applyCode() {
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    const selected = editor.value.slice(start, end);

    if (selected.includes('\n')) {
      const needsNewlineAfter = end < editor.value.length && editor.value[end] !== '\n';
      const beforePfx = needsLeadingNewline(editor.value, start) ? '\n```\n' : '```\n';
      const afterSfx = needsNewlineAfter ? '\n```\n' : '\n```';
      insertMarkdown(beforePfx, afterSfx);
    } else {
      insertMarkdown('`', '`');
    }
  }

  function applyTable() {
    const pos = editor.selectionStart;
    const value = editor.value;
    const prefix = needsLeadingNewline(value, pos) ? '\n' : '';
    const template = `${prefix}| Header 1 | Header 2 | Header 3 |\n| --- | --- | --- |\n| Cell | Cell | Cell |\n`;
    editor.value = value.slice(0, pos) + template + value.slice(pos);
    editor.selectionStart = editor.selectionEnd = pos + prefix.length + 2;
    editor.focus();
    preview.innerHTML = renderMarkdown(editor.value);
  }

  function handleMarkdownCommand(cmd: string) {
    switch (cmd) {
      case 'ul': applyList('ul'); break;
      case 'ol': applyList('ol'); break;
      case 'h1': applyHeading(1); break;
      case 'h2': applyHeading(2); break;
      case 'link': applyLink(); break;
      case 'code': applyCode(); break;
      case 'table': applyTable(); break;
    }
  }

  document.querySelectorAll<HTMLButtonElement>('.editor-btn[data-md]').forEach(btn => {
    btn.addEventListener('mousedown', (e) => e.preventDefault());
    btn.addEventListener('click', () => {
      if (btn.dataset.prefix) {
        insertMarkdown(btn.dataset.prefix, btn.dataset.suffix || '');
      } else if (btn.dataset.md) {
        handleMarkdownCommand(btn.dataset.md);
      }
    });
  });

  // Preview toggle
  const previewToggle = document.getElementById('md-preview-toggle');
  previewToggle?.addEventListener('click', () => {
    const showingPreview = !preview.classList.contains('hidden');
    const toolbarBtns = document.querySelectorAll<HTMLButtonElement>('.editor-btn[data-md]');

    if (showingPreview) {
      preview.classList.add('hidden');
      preview.classList.remove('active');
      editor.classList.remove('hidden');
      editor.focus();
      previewToggle.classList.remove('active');
      toolbarBtns.forEach(b => {
        b.disabled = false;
        b.classList.remove('disabled');
      });
    } else {
      const { html, strippedHTML } = renderMarkdownWithReport(editor.value);
      preview.innerHTML = html;
      if (strippedHTML) {
        showNotification('Unsupported HTML tags are not rendered for security.', 'error');
      }
      preview.classList.remove('hidden');
      preview.classList.add('active');
      editor.classList.add('hidden');
      previewToggle.classList.add('active');
      toolbarBtns.forEach(b => {
        b.disabled = true;
        b.classList.add('disabled');
      });
    }
  });
}
