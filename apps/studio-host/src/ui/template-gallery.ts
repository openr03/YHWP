import { TEMPLATES, type TemplateSpec } from '@/core/templates';
import { ModalDialog } from './dialog';

const ICONS: Record<string, string> = { official: '📨', minutes: '🗒️', report: '📊', resume: '👤' };

class TemplateGallery extends ModalDialog {
  private chosen: TemplateSpec | null = null;
  private settled = false;

  constructor(private readonly resolve: (spec: TemplateSpec | null) => void) {
    super('서식 파일로 새 문서', 560);
  }

  protected createBody(): HTMLElement {
    const grid = document.createElement('div');
    grid.className = 'template-grid';
    for (const spec of TEMPLATES) {
      const card = document.createElement('button');
      card.type = 'button';
      card.className = 'template-card';
      const icon = document.createElement('span');
      icon.className = 'template-icon';
      icon.textContent = ICONS[spec.id] ?? '📄';
      const name = document.createElement('strong');
      name.textContent = spec.name;
      const desc = document.createElement('small');
      desc.textContent = spec.description;
      card.append(icon, name, desc);
      card.addEventListener('click', () => {
        this.chosen = spec;
        grid.querySelectorAll('.template-card').forEach((el) => el.classList.toggle('selected', el === card));
      });
      card.addEventListener('dblclick', () => {
        this.chosen = spec;
        this.finish();
      });
      grid.append(card);
    }
    return grid;
  }

  private finish(): void {
    if (!this.chosen) return;
    this.settled = true;
    this.resolve(this.chosen);
    this.hide();
  }

  protected onConfirm(): boolean {
    if (!this.chosen) return false;
    this.settled = true;
    this.resolve(this.chosen);
    return true;
  }

  override hide(): void {
    super.hide();
    if (!this.settled) {
      this.settled = true;
      this.resolve(null);
    }
  }
}

export function chooseTemplate(): Promise<TemplateSpec | null> {
  return new Promise((resolve) => new TemplateGallery(resolve).show());
}
