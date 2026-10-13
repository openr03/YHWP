/** AI 가 부를 수 있는 모든 도구 (문서 편집 + 긴 문서 읽기) */
import { DOC_TOOLS, type DocTool } from './doc-tools';
import { LONG_DOC_TOOLS } from './long-doc';

export const ALL_TOOLS: DocTool[] = [...DOC_TOOLS, ...LONG_DOC_TOOLS];
export const TOOL_MAP = new Map(ALL_TOOLS.map((t) => [t.def.name, t]));
