/**
 * Esc 로 닫히지 않는 upstream 비모달 창(문서 비교·문서 이력)을 한컴처럼 Esc 로 닫는다.
 * 다른 처리기가 이미 Esc 를 소비했으면(defaultPrevented) 건드리지 않는다.
 */
const CLOSABLE_SELECTORS = ['.compare-dialog .dialog-close'];

function isShown(el: HTMLElement): boolean {
  return el.isConnected && el.getClientRects().length > 0;
}

export function installEscapeCloser(root: Document = document): void {
  root.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || event.defaultPrevented) return;
    for (const selector of CLOSABLE_SELECTORS) {
      const buttons = [...root.querySelectorAll<HTMLElement>(selector)].filter(isShown);
      const last = buttons.at(-1);
      if (!last) continue;
      event.preventDefault();
      last.click();
      return;
    }
  });
}
