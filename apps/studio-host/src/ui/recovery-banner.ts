import type { RecoveryEntry } from '@/core/autosave';

interface RecoveryActions {
  open(entry: RecoveryEntry): void;
  discard(entry: RecoveryEntry): Promise<void>;
}

function formatTime(ms: number): string {
  return new Date(ms).toLocaleString('ko-KR', {
    month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

/** 시작 화면에 "복구할 문서" 목록을 그린다. 항목이 없으면 영역을 지운다. */
export function renderRecoveryBanner(home: HTMLElement, entries: RecoveryEntry[], actions: RecoveryActions): void {
  home.querySelector('.home-recovery')?.remove();
  if (entries.length === 0) return;

  const section = document.createElement('section');
  section.className = 'home-recovery';
  const title = document.createElement('h2');
  title.className = 'home-section-title';
  title.textContent = '복구할 문서가 있습니다';
  const hint = document.createElement('p');
  hint.className = 'home-recovery-hint';
  hint.textContent = '지난번에 프로그램이 정상적으로 닫히지 않아 자동 저장된 사본을 찾았습니다. 연 다음 "다른 이름으로 저장"으로 보관하세요.';
  section.append(title, hint);

  for (const entry of entries) {
    const row = document.createElement('div');
    row.className = 'home-recovery-row';
    const label = document.createElement('div');
    label.className = 'home-recovery-name';
    label.textContent = entry.name || '이름 없는 문서';
    const time = document.createElement('span');
    time.className = 'home-recovery-time';
    time.textContent = `${formatTime(entry.savedAt)} 자동 저장`;
    label.append(time);

    const open = document.createElement('button');
    open.type = 'button';
    open.className = 'home-recovery-open';
    open.textContent = '복구해서 열기';
    open.addEventListener('click', () => actions.open(entry));
    const discard = document.createElement('button');
    discard.type = 'button';
    discard.className = 'home-recovery-discard';
    discard.textContent = '버리기';
    discard.addEventListener('click', async () => {
      if (!confirm(`"${entry.name}" 자동 저장 사본을 버릴까요? 되돌릴 수 없습니다.`)) return;
      await actions.discard(entry).catch(() => undefined);
      row.remove();
      if (!section.querySelector('.home-recovery-row')) section.remove();
    });
    row.append(label, open, discard);
    section.append(row);
  }

  const hero = home.querySelector('.home-hero');
  if (hero) hero.after(section);
  else home.prepend(section);
}
