# YHWP 엔진 패치 (rhwp 0.8.7 위)

`third_party/rhwp` 는 업스트림 v0.8.7(`1a76570e`)이지만, YHWP 0.2.0 은 아래 성능 패치를 얹어 빌드한다.
`apps/studio-host/vendor/rhwp-core/rhwp_bg.wasm` 도 이 소스로 다시 빌드했다(wasm-pack 0.14.0, Rust 1.93.1).
`PROVENANCE.json` 의 commit 은 업스트림 기준값이며, 패치 내용은 이 문서가 기록한다.

패치 원본은 `patches/rhwp-0.8.7-yhwp-perf.patch` 에 있다. 새로 받은 저장소에서는 데스크톱을 빌드하기 전에 적용한다:

```bash
git -C third_party/rhwp apply ../../patches/rhwp-0.8.7-yhwp-perf.patch
```

## 큰 표 조판 속도 (출력 동일)

표의 모든 셀을 행·셀·쪽마다 다시 훑던 계산을 한 번 훑기·캐시로 바꿨다.

- `renderer/typeset.rs` — `rowbreak_table_has_internal_saved_vpos_reset` 한 번 훑기
- `renderer/typeset/table/continuation/fragment/budget.rs` — `stored_row_heights` 한 번 훑기
- `model/table.rs` — `declared_width_rows_exceeding` 행 버킷, `rowspan_declared_overflow_shrink` 누적합·표별 캐시
- `renderer/height_measurer.rs` — `measure_table_impl` (행,열) 조회표
- `renderer/layout/table_partial.rs` — `leading_header_rows()` 한 번 계산
- `renderer/layout/table_row_index.rs` (신규) — `LayoutEngine` 에 캐시되는 행 색인, `clear_layout_caches` 와 함께 비움
- `renderer/typeset/table/block/prepare.rs`, `renderer/layout.rs` — 행 색인 사용

## 검증

- 코퍼스 1,680개: 쪽 수·모든 쪽 SVG 해시·재저장 쪽 수가 패치 전후 동일(네이티브·WASM 모두)
- rhwp lib 테스트 3,870 통과
- `issue2063_huge_cellbreak_table.hwp`: 열기 94초 → 3.8초, 전체 렌더 60초 → 14초 (WASM)
- `2017년기준 시장구조조사.hwp` (314쪽): 열기 16.6초 → 4.1초, 전체 렌더 51초 → 4.8초 (WASM)

## 알려진 미해결

- `german-legislative-system.hwp` 는 HWP 3.0 파일이라 저장이 HWP3→HWP5 변환이 되며 쪽 수가 262→259 로 바뀐다(업스트림 #4680, 조판 규칙 차이).
- HWPX→HWP 변환 7건의 쪽 수 변화도 형식별 조판 규칙 차이로, 저장기 버그가 아니다.
