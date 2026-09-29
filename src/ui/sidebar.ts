import type { AppState } from '../appState';
import type { Design } from '../model';
import { designLocalBox, pasteLayer } from '../model';
import { alignHorizontal, alignVertical, distributeEvenly, distributeWithGap, placeAdjacent, type Placeable } from '../tools/align';
import { loadFiles } from '../io/load';
import { exportMergedPaste } from '../gerber/exportGerber';
import { el, downloadText } from './dom';
import type { Rotation90 } from '../gerber/geometry';

function toPlaceable(d: Design): Placeable {
  return { id: d.id, x: d.x, y: d.y, rotation: d.rotation, localBox: designLocalBox(d) };
}

function helpIcon(text: string): HTMLElement {
  return el('span', { className: 'help-icon', title: text }, ['?']);
}

export class Sidebar {
  readonly root: HTMLElement;
  private readonly listEl: HTMLElement;
  private readonly statusEl: HTMLElement;
  private readonly state: AppState;
  private readonly notify: () => void;
  private marginMm = 15;
  private gapMm = 5;

  constructor(state: AppState, notify: () => void) {
    this.state = state;
    this.notify = notify;
    this.listEl = el('div', { className: 'design-list' });
    this.statusEl = el('div', { className: 'status' });

    this.root = el('div', { className: 'sidebar' }, [
      el('h1', {}, ['Gerber Paste Merger']),
      el('p', { className: 'hint' }, ['Runs entirely in your browser. Files never leave your computer.']),
      this.buildLoadSection(),
      el('h2', {}, ['Designs']),
      this.listEl,
      this.buildAlignSection(),
      this.buildDistributeSection(),
      this.buildViewSection(),
      this.buildExportSection(),
      this.statusEl,
    ]);
  }

  setStatus(text: string): void {
    this.statusEl.textContent = text;
  }

  /** Rebuilds the parts of the sidebar that depend on current state (design list, selection). */
  refresh(): void {
    this.listEl.replaceChildren(...this.state.designs.map((d) => this.buildDesignRow(d)));
  }

  // ---- Load ----

  private buildLoadSection(): HTMLElement {
    const input = el('input', {
      type: 'file',
      multiple: true,
      onchange: async () => {
        const files = Array.from(input.files ?? []);
        if (files.length === 0) return;
        const result = await loadFiles(files);
        if (result.designs.length > 0) this.state.addDesigns(result.designs);
        if (result.warnings.length > 0) this.setStatus(result.warnings.join(' '));
        else if (result.designs.length > 0) this.setStatus(`Loaded ${result.designs.length} design(s).`);
        input.value = '';
        this.notify();
      },
    }) as HTMLInputElement;

    const dropZone = el(
      'div',
      {
        className: 'dropzone',
        ondragover: (e: Event) => e.preventDefault(),
        ondrop: async (e: Event) => {
          e.preventDefault();
          const dt = (e as DragEvent).dataTransfer;
          if (!dt) return;
          const files = Array.from(dt.files ?? []);
          if (files.length === 0) return;
          const result = await loadFiles(files);
          if (result.designs.length > 0) this.state.addDesigns(result.designs);
          if (result.warnings.length > 0) this.setStatus(result.warnings.join(' '));
          else if (result.designs.length > 0) this.setStatus(`Loaded ${result.designs.length} design(s).`);
          this.notify();
        },
      },
      ['Drop Gerber files or a fab .zip here', el('br'), 'or ', input],
    );
    return el('section', {}, [dropZone]);
  }

  // ---- Design list ----

  private buildDesignRow(design: Design): HTMLElement {
    const selected = this.state.selected.has(design.id);
    const top = pasteLayer(design, 'top');
    const bottom = pasteLayer(design, 'bottom');
    const badges = [
      top ? 'Top paste' : null,
      bottom ? 'Bottom paste' : null,
      design.layers.some((l) => l.type === 'outline') ? 'Outline' : null,
      design.flipped ? 'Flipped' : null,
    ]
      .filter(Boolean)
      .join(' · ');

    const numField = (label: string, value: number, onInput: (v: number) => void) =>
      el('label', { className: 'num-field' }, [
        label,
        el('input', {
          type: 'number',
          step: '0.01',
          value: value.toFixed(3),
          oninput: (e: Event) => {
            const v = Number((e.target as HTMLInputElement).value);
            if (Number.isFinite(v)) {
              onInput(v);
              this.notify();
            }
          },
          onchange: () => this.state.pushHistory(),
        }),
      ]);

    const row = el(
      'div',
      {
        className: `design-row${selected ? ' selected' : ''}`,
        onclick: (e: Event) => {
          if ((e.target as HTMLElement).closest('input, button, select')) return;
          const additive = (e as MouseEvent).shiftKey || (e as MouseEvent).metaKey || (e as MouseEvent).ctrlKey;
          if (additive) this.state.toggleSelect(design.id);
          else this.state.select([design.id]);
          this.notify();
        },
      },
      [
        el('div', { className: 'design-row-head' }, [
          el('input', {
            type: 'checkbox',
            checked: design.visible,
            title: 'Visible',
            onchange: (e: Event) => {
              design.visible = (e.target as HTMLInputElement).checked;
              this.notify();
            },
          }),
          el('span', { className: 'design-name' }, [design.name]),
          el(
            'button',
            {
              className: 'icon-btn',
              title: 'Remove design',
              onclick: () => {
                this.state.removeDesign(design.id);
                this.notify();
              },
            },
            ['✕'],
          ),
        ]),
        el('div', { className: 'design-badges' }, [badges || 'No paste layer detected']),
        el('div', { className: 'design-fields' }, [
          numField('X (mm)', design.x, (v) => (design.x = v)),
          numField('Y (mm)', design.y, (v) => (design.y = v)),
          el('label', { className: 'num-field' }, [
            'Rotation',
            el(
              'select',
              {
                onchange: (e: Event) => {
                  this.state.pushHistory();
                  design.rotation = Number((e.target as HTMLSelectElement).value) as Rotation90;
                  this.notify();
                },
              },
              ([0, 90, 180, 270] as const).map((r) => el('option', { value: r, selected: design.rotation === r }, [`${r}°`])),
            ),
          ]),
          el('label', { className: 'num-field checkbox-field' }, [
            el('input', {
              type: 'checkbox',
              checked: design.flipped,
              title:
                'Mount this design upside-down on the panel: its bottom paste (mirrored, in place) becomes its top-side contribution to export, and vice versa.',
              onchange: (e: Event) => {
                this.state.pushHistory();
                design.flipped = (e.target as HTMLInputElement).checked;
                this.notify();
              },
            }),
            'Flip top/bottom',
          ]),
        ]),
      ],
    );
    return row;
  }

  // ---- Align ----

  private buildAlignSection(): HTMLElement {
    const btn = (label: string, title: string, onClick: () => void) =>
      el(
        'button',
        {
          onclick: () => {
            onClick();
            this.notify();
          },
          title,
        },
        [label],
      );

    const withRefAndTargets = (fn: (ref: Placeable, targets: Placeable[]) => Array<{ id: string; x: number; y: number }>) => {
      const ref = this.state.referenceDesign;
      const targets = this.state.selectedDesigns;
      if (!ref || targets.length < 2) {
        this.setStatus('Select a reference design first, then shift-click one or more others to align to it.');
        return;
      }
      const updates = fn(toPlaceable(ref), targets.map(toPlaceable));
      this.state.applyPlacementUpdates(updates);
    };

    const marginInput = el('input', {
      type: 'number',
      value: String(this.marginMm),
      step: '0.5',
      oninput: (e: Event) => (this.marginMm = Number((e.target as HTMLInputElement).value) || 0),
    }) as HTMLInputElement;

    const placeAdjacentRow = (side: 'left' | 'right' | 'above' | 'below', label: string) =>
      btn(label, `Place after the reference with a margin`, () => {
        const ref = this.state.referenceDesign;
        const targets = this.state.selectedDesigns.filter((d) => d.id !== ref?.id);
        if (!ref || targets.length === 0) {
          this.setStatus('Select a reference design first, then shift-click one or more others to place next to it.');
          return;
        }
        const updates = targets.map((t) => placeAdjacent(toPlaceable(ref), toPlaceable(t), side, this.marginMm));
        this.state.applyPlacementUpdates(updates);
      });

    return el('section', {}, [
      el('h2', {}, ['Align', helpIcon('First click selects the reference; shift-click adds others to align to it.')]),
      el('div', { className: 'btn-grid' }, [
        btn('⟸ Left', 'Align left edges', () => withRefAndTargets((r, t) => alignHorizontal(r, t, 'left'))),
        btn('Center ↕', 'Align horizontal centers', () => withRefAndTargets((r, t) => alignHorizontal(r, t, 'hcenter'))),
        btn('Right ⟹', 'Align right edges', () => withRefAndTargets((r, t) => alignHorizontal(r, t, 'right'))),
        btn('⟰ Top', 'Align top edges', () => withRefAndTargets((r, t) => alignVertical(r, t, 'top'))),
        btn('Center ↔', 'Align vertical centers', () => withRefAndTargets((r, t) => alignVertical(r, t, 'vcenter'))),
        btn('Bottom ⟱', 'Align bottom edges', () => withRefAndTargets((r, t) => alignVertical(r, t, 'bottom'))),
      ]),
      el('h3', {}, ['Place adjacent, with margin']),
      el('label', { className: 'num-field' }, ['Margin (mm)', marginInput]),
      el('div', { className: 'btn-grid' }, [
        placeAdjacentRow('left', '⟸ Left of ref'),
        placeAdjacentRow('right', 'Right of ref ⟹'),
        placeAdjacentRow('above', '⟰ Above ref'),
        placeAdjacentRow('below', 'Below ref ⟱'),
      ]),
    ]);
  }

  // ---- Distribute ----

  private buildDistributeSection(): HTMLElement {
    const gapInput = el('input', {
      type: 'number',
      value: String(this.gapMm),
      step: '0.5',
      oninput: (e: Event) => (this.gapMm = Number((e.target as HTMLInputElement).value) || 0),
    }) as HTMLInputElement;

    const run = (fn: (items: Placeable[]) => Array<{ id: string; x: number; y: number }>, minCount: number, hint: string) => {
      const items = this.state.selectedDesigns;
      if (items.length < minCount) {
        this.setStatus(hint);
        return;
      }
      this.state.applyPlacementUpdates(fn(items.map(toPlaceable)));
      this.notify();
    };

    const btn = (label: string, onClick: () => void) => el('button', { onclick: onClick }, [label]);

    return el('section', {}, [
      el('h2', {}, ['Distribute', helpIcon('Select all the designs to space out (order follows current position).')]),
      el('label', { className: 'num-field' }, ['Gap (mm)', gapInput]),
      el('div', { className: 'btn-grid' }, [
        btn('Gap →', () => run((items) => distributeWithGap(items, 'horizontal', this.gapMm), 2, 'Select at least 2 designs.')),
        btn('Gap ↓', () => run((items) => distributeWithGap(items, 'vertical', this.gapMm), 2, 'Select at least 2 designs.')),
        btn('Even →', () => run((items) => distributeEvenly(items, 'horizontal'), 3, 'Select at least 3 designs (first and last stay put).')),
        btn('Even ↓', () => run((items) => distributeEvenly(items, 'vertical'), 3, 'Select at least 3 designs (first and last stay put).')),
      ]),
    ]);
  }

  // ---- View ----

  private buildViewSection(): HTMLElement {
    return el('section', {}, [
      el('h2', {}, ['View']),
      el('label', { className: 'num-field' }, [
        'Snap grid (mm, 0 = off)',
        el('input', {
          type: 'number',
          value: String(this.state.gridMm),
          step: '0.1',
          min: '0',
          oninput: (e: Event) => {
            this.state.gridMm = Math.max(0, Number((e.target as HTMLInputElement).value) || 0);
            this.notify();
          },
        }),
      ]),
    ]);
  }

  // ---- Export ----

  private buildExportSection(): HTMLElement {
    const sideSelect = el(
      'select',
      {
        onchange: (e: Event) => {
          this.state.exportSide = (e.target as HTMLSelectElement).value as 'top' | 'bottom';
        },
      },
      [
        el('option', { value: 'top', selected: this.state.exportSide === 'top' }, ['Top paste']),
        el('option', { value: 'bottom', selected: this.state.exportSide === 'bottom' }, ['Bottom paste']),
      ],
    );

    return el('section', {}, [
      el('h2', {}, ['Export']),
      el('label', { className: 'num-field' }, ['Side', sideSelect]),
      el(
        'button',
        {
          className: 'primary',
          onclick: () => {
            if (this.state.designs.length === 0) {
              this.setStatus('Load at least one design first.');
              return;
            }
            const result = exportMergedPaste(this.state.designs, this.state.exportSide);
            const filename = `merged-paste-${this.state.exportSide}.gbr`;
            downloadText(filename, result.text);
            const parts = [`Exported ${filename} (${result.padCount} graphics).`, ...result.warnings];
            this.setStatus(parts.join(' '));
          },
        },
        ['Export merged paste Gerber'],
      ),
    ]);
  }
}
