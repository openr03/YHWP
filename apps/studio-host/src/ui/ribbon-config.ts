/**
 * 리본 도구 상자 구성. 탭 id 는 메뉴 막대의 data-menu 값과 같다.
 * 'edit' 탭은 index.html 의 기존 #icon-toolbar 그룹을 그대로 쓰고 아이콘만 바꾼다.
 */
export interface RibbonItem {
  cmd: string;
  icon: string;
  label: string;
  /** 큰 버튼(아이콘 위, 라벨 아래). 기본은 작은 버튼(세 줄로 쌓임) */
  large?: boolean;
}

export type RibbonGroup = { title: string; items: RibbonItem[] };

export interface RibbonTab {
  id: string;
  groups: RibbonGroup[];
}

const L = (cmd: string, icon: string, label: string): RibbonItem => ({ cmd, icon, label, large: true });
const S = (cmd: string, icon: string, label: string): RibbonItem => ({ cmd, icon, label });

export const RIBBON_TABS: RibbonTab[] = [
  {
    id: 'file',
    groups: [
      { title: '문서', items: [L('file:new-doc', 'FilePlus2', '새 문서'), L('file:new-from-template', 'LayoutTemplate', '서식 파일'), L('file:open', 'FolderOpen', '열기'), L('file:save', 'Save', '저장'), L('file:save-as', 'SaveAll', '다른 이름')] },
      { title: '최근', items: [S('file:open-recent', 'History', '최근 문서'), S('file:new-window', 'AppWindow', '새 탭')] },
      { title: '내보내기', items: [L('file:export-pdf', 'FileOutput', 'PDF'), L('file:batch-pdf', 'FolderSync', '일괄 변환'), S('file:export-png', 'FileImage', 'PNG 그림')] },
      { title: '인쇄', items: [L('file:print-preview', 'ScanEye', '미리 보기'), L('file:print', 'Printer', '인쇄'), L('file:page-setup', 'FileCog', '편집 용지')] },
    ],
  },
  {
    id: 'view',
    groups: [
      { title: '화면 배율', items: [L('view:zoom-in', 'ZoomIn', '확대'), L('view:zoom-out', 'ZoomOut', '축소'), S('view:zoom-fit-page', 'Maximize', '쪽 맞춤'), S('view:zoom-fit-width', 'MoveHorizontal', '폭 맞춤'), S('view:zoom-100', 'Scan', '100%'), S('view:zoom-dialog', 'Percent', '배율 지정')] },
      { title: '표시', items: [L('view:ctrl-mark', 'Code', '조판 부호'), L('view:para-mark', 'Pilcrow', '문단 부호'), S('view:border-transparent', 'SquareDashed', '투명 선'), S('view:toggle-grid', 'Grid3x3', '격자'), S('view:toggle-clip', 'Crop', '잘림 보기')] },
      { title: '창', items: [L('view:nav-pane', 'PanelLeft', '탐색 창'), L('tool:ai-assistant', 'Sparkles', 'AI 도우미'), L('view:form-mode', 'ClipboardList', '양식 모드')] },
      { title: '화면', items: [L('view:theme-toggle', 'SunMoon', '밝게/어둡게'), S('view:yhwp-skin-modern', 'Sparkles', '모던'), S('view:yhwp-skin-hancom', 'LayoutTemplate', '한컴 클래식'), S('view:toolbar-labels', 'Tags', '라벨 표시')] },
    ],
  },
  {
    id: 'insert',
    groups: [
      { title: '개체', items: [L('table:create', 'Table', '표'), L('insert:image', 'Image', '그림'), L('insert:shape', 'Shapes', '도형'), L('insert:textbox', 'TextSelect', '글상자'), L('insert:equation', 'Sigma', '수식')] },
      { title: '참조', items: [S('insert:footnote', 'ArrowDownToLine', '각주'), S('insert:endnote', 'BookOpenText', '미주'), S('insert:comment', 'MessageSquareText', '주석'), S('insert:bookmark', 'Bookmark', '책갈피'), S('insert:hyperlink', 'Link', '하이퍼링크'), S('insert:field', 'Braces', '필드')] },
      { title: '문자', items: [L('insert:symbols', 'Omega', '문자표'), L('insert:para-band', 'RectangleHorizontal', '문단 띠')] },
    ],
  },
  {
    id: 'format',
    groups: [
      { title: '글자', items: [L('format:char-shape', 'Type', '글자 모양'), S('format:bold', 'Bold', '진하게'), S('format:italic', 'Italic', '기울임'), S('format:underline', 'Underline', '밑줄'), S('format:strikethrough', 'Strikethrough', '취소선'), S('format:superscript', 'Superscript', '위 첨자'), S('format:subscript', 'Subscript', '아래 첨자')] },
      { title: '크기', items: [S('format:font-size-increase', 'AArrowUp', '크게'), S('format:font-size-decrease', 'AArrowDown', '작게')] },
      { title: '문단', items: [L('format:para-shape', 'TextQuote', '문단 모양'), S('format:align-left', 'AlignLeft', '왼쪽'), S('format:align-center', 'AlignCenter', '가운데'), S('format:align-right', 'AlignRight', '오른쪽'), S('format:align-justify', 'AlignJustify', '양쪽'), S('format:align-distribute', 'AlignHorizontalSpaceAround', '배분'), S('format:line-spacing-increase', 'ChevronsUpDown', '줄 간격+')] },
      { title: '번호', items: [S('format:para-num-shape', 'ListOrdered', '문단 번호'), S('format:bullet-shape', 'List', '글머리표'), S('format:level-increase', 'IndentIncrease', '수준 증가'), S('format:level-decrease', 'IndentDecrease', '수준 감소')] },
      { title: '스타일', items: [L('format:style-dialog', 'Palette', '스타일'), L('edit:format-copy', 'Paintbrush', '모양 복사')] },
    ],
  },
  {
    id: 'page',
    groups: [
      { title: '쪽', items: [L('page:setup', 'FileCog', '편집 용지'), L('page:page-border', 'Frame', '테두리/배경')] },
      { title: '머리말', items: [L('page:header-create', 'PanelTop', '머리말'), L('page:footer-create', 'PanelBottom', '꼬리말')] },
      { title: '나누기', items: [S('page:break', 'SeparatorHorizontal', '쪽 나누기'), S('page:column-break', 'SeparatorVertical', '단 나누기'), S('page:new-page-num', 'Hash', '새 번호')] },
      { title: '다단', items: [S('page:col-1', 'Square', '하나'), S('page:col-2', 'Columns2', '둘'), S('page:col-3', 'Columns3', '셋'), S('page:col-settings', 'Settings2', '다단 설정')] },
      { title: '구역', items: [L('page:section-settings', 'LayoutPanelTop', '구역 설정'), S('page:hide-current', 'EyeOff', '쪽 감추기')] },
    ],
  },
  {
    id: 'table',
    groups: [
      { title: '표', items: [L('table:create', 'Table', '표 만들기'), L('table:cell-props', 'TableProperties', '표/셀 속성')] },
      { title: '줄/칸', items: [S('table:insert-row-above', 'ArrowUpToLine', '위에 줄'), S('table:insert-row-below', 'ArrowDownToLine', '아래에 줄'), S('table:insert-col-left', 'ArrowLeftToLine', '왼쪽에 칸'), S('table:insert-col-right', 'ArrowRightToLine', '오른쪽에 칸'), S('table:delete-row', 'Rows2', '줄 지우기'), S('table:delete-col', 'Columns2', '칸 지우기')] },
      { title: '셀', items: [L('table:cell-merge', 'Merge', '셀 합치기'), L('table:cell-split', 'Split', '셀 나누기'), S('table:cell-height-equal', 'StretchVertical', '높이 같게'), S('table:cell-width-equal', 'StretchHorizontal', '너비 같게'), S('table:split', 'Scissors', '표 나누기')] },
      { title: '계산', items: [S('table:block-sum', 'Sigma', '합계'), S('table:block-avg', 'Divide', '평균'), S('table:formula', 'Calculator', '계산식')] },
    ],
  },
  {
    id: 'edit-review',
    groups: [
      { title: '찾기', items: [L('edit:find', 'Search', '찾기'), L('edit:find-replace', 'Replace', '찾아 바꾸기'), S('edit:goto', 'CornerDownRight', '찾아가기')] },
      { title: '검토', items: [L('edit:compare-documents', 'GitCompare', '문서 비교'), L('edit:document-history', 'History', '문서 이력')] },
      { title: '도구', items: [L('tool:ai-assistant', 'Sparkles', 'AI 도우미'), L('tool:ai-batch', 'FolderSync', 'AI 일괄'), L('tool:command-palette', 'Command', '명령 찾기'), L('tool:options', 'Settings', '환경 설정')] },
    ],
  },
];

/** 기존 편집 도구 상자 버튼(data-cmd 또는 id) → 아이콘 */
export const HOME_ICON_MAP: Record<string, string> = {
  'edit:cut': 'Scissors',
  'edit:copy': 'Copy',
  'edit:paste': 'ClipboardPaste',
  'edit:format-copy': 'Paintbrush',
  'view:ctrl-mark': 'Code',
  'view:para-mark': 'Pilcrow',
  'view:toggle-grid': 'Grid3x3',
  'format:char-shape': 'Type',
  'format:para-shape': 'TextQuote',
  'format:toggle-numbering': 'ListOrdered',
  'tb-bullet': 'List',
  'format:level-increase': 'IndentIncrease',
  'format:level-decrease': 'IndentDecrease',
  'table:create': 'Table',
  'insert:shape': 'Shapes',
  'insert:image': 'Image',
  'format:object-properties': 'SlidersHorizontal',
  'insert:symbols': 'Omega',
  'insert:hyperlink': 'Link',
  'insert:rotate-ccw': 'RotateCcw',
  'insert:rotate-cw': 'RotateCw',
  'insert:flip-horz': 'FlipHorizontal2',
  'insert:flip-vert': 'FlipVertical2',
  'page:header-create': 'PanelTop',
  'page:footer-create': 'PanelBottom',
  'insert:footnote': 'ArrowDownToLine',
  'insert:endnote': 'BookOpenText',
  'edit:find': 'Search',
};

/** 리본 탭 표시 이름 (메뉴 막대에 없는 탭) */
export const EXTRA_TAB_LABELS: Record<string, string> = {
  'edit-review': '검토',
};
