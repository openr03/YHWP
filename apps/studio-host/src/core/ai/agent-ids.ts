let seq = 0;

/** AI 요청마다 붙이는 id (취소에 쓴다) */
export function newRequestId(): string {
  seq += 1;
  return `ai-${Date.now().toString(36)}-${seq}`;
}
