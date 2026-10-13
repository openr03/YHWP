#ifndef YHWP_QUICKLOOK_FFI_H
#define YHWP_QUICKLOOK_FFI_H

#include <stddef.h>
#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

typedef struct YhwpQuickLookBytes {
  uint8_t *ptr;
  size_t len;
} YhwpQuickLookBytes;

typedef struct YhwpQuickLookRenderResult {
  int32_t status;
  YhwpQuickLookBytes bytes;
  uint32_t page_count;
  double width;
  double height;
} YhwpQuickLookRenderResult;

typedef struct YhwpQuickLookThumbnailResult {
  int32_t status;
  YhwpQuickLookBytes bytes;
  uint32_t width;
  uint32_t height;
} YhwpQuickLookThumbnailResult;

YhwpQuickLookRenderResult yhwp_ql_render_preview_pdf(const uint8_t *data, size_t len);
YhwpQuickLookRenderResult yhwp_ql_render_first_page_png(const uint8_t *data, size_t len, uint32_t max_dimension);
YhwpQuickLookThumbnailResult yhwp_ql_extract_embedded_thumbnail(const uint8_t *data, size_t len);
void yhwp_ql_free_bytes(uint8_t *ptr, size_t len);

#ifdef __cplusplus
}
#endif

#endif
