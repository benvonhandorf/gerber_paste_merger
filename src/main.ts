import './style.css';
import { AppState } from './appState';
import { Workspace } from './render/workspace';
import { Sidebar } from './ui/sidebar';
import { el } from './ui/dom';

const state = new AppState();

const cursorEl = el('span', {}, ['—']);
const zoomFitBtn = el('button', { className: 'ghost' }, ['Zoom to fit']);
const undoBtn = el('button', { className: 'ghost' }, ['Undo']);
const redoBtn = el('button', { className: 'ghost' }, ['Redo']);
const toolbar = el('div', { className: 'toolbar' }, [zoomFitBtn, undoBtn, redoBtn, el('span', { className: 'spacer' }), 'Cursor: ', cursorEl, ' mm']);

const workspace = new Workspace({
  onSelectionChange(ids) {
    state.select(ids);
    render();
  },
  onDragStart() {
    state.pushHistory();
  },
  onCommit() {
    sidebar.refresh();
  },
  onCursorMove(x, y) {
    cursorEl.textContent = `${x.toFixed(2)}, ${y.toFixed(2)}`;
  },
});

const sidebar = new Sidebar(state, render);

function render(): void {
  workspace.render(state.designs, state.selected);
  workspace.setGridMm(state.gridMm);
  sidebar.refresh();
  undoBtn.toggleAttribute('disabled', !state.canUndo());
  redoBtn.toggleAttribute('disabled', !state.canRedo());
}

zoomFitBtn.addEventListener('click', () => workspace.zoomToFit());
undoBtn.addEventListener('click', () => {
  if (state.undo()) render();
});
redoBtn.addEventListener('click', () => {
  if (state.redo()) render();
});

window.addEventListener('keydown', (e) => {
  const inField = e.target instanceof HTMLElement && /INPUT|SELECT|TEXTAREA/.test(e.target.tagName);
  if (inField) return;

  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) {
    e.preventDefault();
    if (state.undo()) render();
    return;
  }
  if (mod && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) {
    e.preventDefault();
    if (state.redo()) render();
    return;
  }
  if (e.key === 'Escape') {
    state.select([]);
    render();
    return;
  }
  if (e.key === 'Delete' || e.key === 'Backspace') {
    if (state.selected.size === 0) return;
    e.preventDefault();
    for (const id of [...state.selected]) state.removeDesign(id);
    render();
    return;
  }
  if (mod && e.key.toLowerCase() === 'a') {
    e.preventDefault();
    state.selectAll();
    render();
    return;
  }
  if (e.key === '[' || e.key === ']') {
    if (state.selected.size === 0) return;
    state.rotateSelected(e.key === ']' ? 90 : -90);
    render();
    return;
  }
  if (e.key.toLowerCase() === 'f' && !mod) {
    if (state.selected.size === 0) return;
    state.flipSelected();
    render();
    return;
  }
  const step = e.shiftKey ? 10 : state.gridMm > 0 ? state.gridMm : 1;
  const arrows: Record<string, [number, number]> = {
    ArrowLeft: [-step, 0],
    ArrowRight: [step, 0],
    ArrowUp: [0, step],
    ArrowDown: [0, -step],
  };
  const delta = arrows[e.key];
  if (delta && state.selected.size > 0) {
    e.preventDefault();
    state.nudgeSelected(delta[0], delta[1]);
    render();
  }
});

const workspaceWrap = el('div', { className: 'workspace' }, [toolbar, workspace.svg]);
const app = document.querySelector<HTMLDivElement>('#app')!;
app.append(el('div', { className: 'layout' }, [workspaceWrap, sidebar.root]));

render();
