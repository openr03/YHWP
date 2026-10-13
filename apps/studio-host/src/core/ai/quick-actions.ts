/**
 * 빠른 실행: 선택한 글(없으면 현재 문단)을 한 번에 바꾸는 작업. 도구 없이 결과 글만 받는다.
 */
export interface QuickAction {
  id: string;
  label: string;
  instruction: string;
  /** 결과를 원문 대신 넣는 게 자연스러운가 (요약은 아래에 넣기가 기본) */
  replaces: boolean;
}

export const QUICK_ACTIONS: QuickAction[] = [
  { id: 'spell', label: '맞춤법', replaces: true, instruction: '다음 글의 맞춤법, 띄어쓰기, 문법 오류만 바로잡아라. 표현과 내용은 바꾸지 마라.' },
  { id: 'polish', label: '다듬기', replaces: true, instruction: '뜻은 그대로 두고 더 자연스럽고 매끄러운 문장으로 다듬어라.' },
  { id: 'official', label: '공문체', replaces: true, instruction: '한국 행정 공문서 문체로 바꿔라. 간결한 개조식, "~함", "~임" 종결, 높임과 군더더기 표현을 정리하라.' },
  { id: 'summary', label: '요약', replaces: false, instruction: '핵심만 3~5줄 개조식으로 요약하라. 각 줄은 "- " 로 시작한다.' },
  { id: 'english', label: '영어로', replaces: true, instruction: '자연스럽고 정확한 영어로 번역하라.' },
  { id: 'korean', label: '한국어로', replaces: true, instruction: '자연스러운 한국어로 번역하라.' },
  { id: 'expand', label: '늘리기', replaces: true, instruction: '같은 내용을 더 구체적이고 풍부하게 1.5~2배 길이로 늘려라. 없는 사실을 지어내지 마라.' },
  { id: 'shorten', label: '줄이기', replaces: true, instruction: '뜻을 유지하면서 절반 정도 길이로 줄여라.' },
];

export const QUICK_SYSTEM_PROMPT =
  '너는 한국어 문서 편집 도우미다. 요청한 결과 글만 출력한다. 설명, 머리말, 따옴표, 코드 블록을 붙이지 않는다. 줄바꿈은 문단 구분이다.';

export function quickPrompt(action: QuickAction, text: string): string {
  return `${action.instruction}\n\n<글>\n${text}\n</글>`;
}

/** 모델이 습관처럼 붙이는 머리말·따옴표·코드 울타리를 걷어낸다. */
export function cleanQuickResult(text: string): string {
  let out = text.trim();
  out = out.replace(/^```[a-z]*\n([\s\S]*?)\n```$/i, '$1').trim();
  out = out.replace(/^<글>\s*([\s\S]*?)\s*<\/글>$/, '$1').trim();
  if (/^["“'].*["”']$/s.test(out) && !out.slice(1, -1).includes('"')) out = out.slice(1, -1).trim();
  return out;
}
