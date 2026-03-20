/*
 * Copyright (c) 2022-2026 Samuel Ugochukwu <sammycageagle@gmail.com>
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

#include <plutobook.h>

#include <unicode/putil.h>

#include <stdlib.h>
#include <string.h>
#include <stdint.h>

#define STB_IMAGE_WRITE_IMPLEMENTATION
#define STBIW_MALLOC(sz)        malloc(sz)
#define STBIW_REALLOC(p, sz)    realloc(p, sz)
#define STBIW_FREE(p)           free(p)
#include "stb_image_write.h"

/* ---- In-memory resource map ---- */

typedef struct resource_entry {
    char* url;
    uint8_t* data;
    unsigned int data_len;
    char* mime_type;
    struct resource_entry* next;
} resource_entry_t;

static resource_entry_t* g_resource_map = NULL;

/* Register a pre-loaded resource (URL → binary blob). */
void plutobook_wasm_register_resource(const char* url, const uint8_t* data, unsigned int data_len, const char* mime_type)
{
    resource_entry_t* entry = (resource_entry_t*)malloc(sizeof(resource_entry_t));
    if(!entry) return;

    entry->url = strdup(url ? url : "");
    entry->data = (uint8_t*)malloc(data_len);
    if(entry->data) memcpy(entry->data, data, data_len);
    entry->data_len = data_len;
    entry->mime_type = strdup(mime_type ? mime_type : "application/octet-stream");
    entry->next = g_resource_map;
    g_resource_map = entry;
}

/* Clear all pre-registered resources. */
void plutobook_wasm_clear_resources(void)
{
    resource_entry_t* entry = g_resource_map;
    while(entry) {
        resource_entry_t* next = entry->next;
        free(entry->url);
        free(entry->data);
        free(entry->mime_type);
        free(entry);
        entry = next;
    }
    g_resource_map = NULL;
}

/* Custom resource fetcher: looks up URL in the in-memory map. */
static plutobook_resource_data_t* wasm_resource_fetcher(void* closure, const char* url)
{
    (void)closure;
    resource_entry_t* entry = g_resource_map;
    while(entry) {
        if(strcmp(entry->url, url) == 0) {
            return plutobook_resource_data_create(
                (const char*)entry->data,
                entry->data_len,
                entry->mime_type,
                ""
            );
        }
        entry = entry->next;
    }
    /* Fall through: let plutobook try its default fetcher (file:// etc.) */
    return plutobook_fetch_url(url);
}

/* ---- Grow-on-demand PDF output buffer ---- */

typedef struct {
    uint8_t* data;
    unsigned int size;
    unsigned int capacity;
} pdf_buffer_t;

static plutobook_stream_status_t pdf_write_callback(void* closure, const char* data, unsigned int length)
{
    pdf_buffer_t* buf = (pdf_buffer_t*)closure;
    unsigned int needed = buf->size + length;
    if(needed > buf->capacity) {
        unsigned int new_cap = buf->capacity ? buf->capacity * 2 : 65536;
        while(new_cap < needed) new_cap *= 2;
        uint8_t* new_data = (uint8_t*)realloc(buf->data, new_cap);
        if(!new_data) return PLUTOBOOK_STREAM_STATUS_WRITE_ERROR;
        buf->data = new_data;
        buf->capacity = new_cap;
    }
    memcpy(buf->data + buf->size, data, length);
    buf->size += length;
    return PLUTOBOOK_STREAM_STATUS_SUCCESS;
}

/* ---- Public WASM API ---- */

/* Must be called once before any rendering, after fonts are written to MEMFS. */
void plutobook_wasm_init(void)
{
    u_setDataDirectory("/icudata");
    plutobook_set_fontconfig_path("/fonts");
}

/*
 * Convert HTML to PDF bytes.
 *
 * Returns a malloc'd buffer that the caller must free with
 * plutobook_wasm_free_buffer(). On failure returns NULL and *out_len = 0.
 */
uint8_t* plutobook_wasm_html_to_pdf(
    const char* html,
    int          html_len,
    float        page_width,
    float        page_height,
    float        margin_top,
    float        margin_right,
    float        margin_bottom,
    float        margin_left,
    const char*  base_url,
    const char*  user_style,
    unsigned int* out_len)
{
    *out_len = 0;

    plutobook_page_size_t page_size = PLUTOBOOK_MAKE_PAGE_SIZE(page_width, page_height);
    plutobook_page_margins_t margins = PLUTOBOOK_MAKE_PAGE_MARGINS(
        margin_top, margin_right, margin_bottom, margin_left);

    plutobook_t* book = plutobook_create(page_size, margins, PLUTOBOOK_MEDIA_TYPE_PRINT);
    if(!book) return NULL;

    plutobook_set_custom_resource_fetcher(book, wasm_resource_fetcher, NULL);

    if(!plutobook_load_html(book, html, html_len, user_style, NULL, base_url)) {
        plutobook_destroy(book);
        return NULL;
    }

    pdf_buffer_t buf = {NULL, 0, 0};
    if(!plutobook_write_to_pdf_stream(book, pdf_write_callback, &buf)) {
        free(buf.data);
        plutobook_destroy(book);
        return NULL;
    }

    plutobook_destroy(book);
    *out_len = buf.size;
    return buf.data;
}

/* Free a buffer returned by plutobook_wasm_html_to_pdf/image. */
void plutobook_wasm_free_buffer(uint8_t* ptr)
{
    free(ptr);
}

/* ---- Image output (PNG / JPEG / WEBP) ---- */

/* stb_image_write callback: appends encoded bytes into a pdf_buffer_t. */
static void stbiw_write_callback(void* context, void* data, int size)
{
    pdf_buffer_t* buf = (pdf_buffer_t*)context;
    unsigned int needed = buf->size + (unsigned int)size;
    if(needed > buf->capacity) {
        unsigned int new_cap = buf->capacity ? buf->capacity * 2 : 65536;
        while(new_cap < needed) new_cap *= 2;
        uint8_t* new_data = (uint8_t*)realloc(buf->data, new_cap);
        if(!new_data) return;
        buf->data     = new_data;
        buf->capacity = new_cap;
    }
    memcpy(buf->data + buf->size, data, size);
    buf->size += (unsigned int)size;
}

/* Cairo ARGB32 (premultiplied, B G R A little-endian) → RGB for JPEG encoding.
 * Alpha is composited onto white. */
static void argb32_row_to_rgb(const uint8_t* src, uint8_t* dst, int width)
{
    for(int x = 0; x < width; x++) {
        uint8_t b = src[0], g = src[1], r = src[2], a = src[3];
        if(a == 255) {
            dst[0] = r; dst[1] = g; dst[2] = b;
        } else {
            /* blend onto white */
            dst[0] = (uint8_t)(r + (255 - a));
            dst[1] = (uint8_t)(g + (255 - a));
            dst[2] = (uint8_t)(b + (255 - a));
        }
        src += 4;
        dst += 4;  /* stride to keep same loop math; actual dst step is 3 */
        dst -= 1;
    }
}

/*
 * Render HTML to an image.
 *
 * format  : "png", "jpeg" / "jpg"
 * img_w   : output width in pixels  (-1 = auto from page size at 96 dpi)
 * img_h   : output height in pixels (-1 = auto)
 * quality : JPEG quality 1-100 (ignored for PNG)
 *
 * Returns malloc'd buffer that must be freed with plutobook_wasm_free_buffer().
 */
uint8_t* plutobook_wasm_html_to_image(
    const char*   html,
    int           html_len,
    float         page_width,
    float         page_height,
    float         margin_top,
    float         margin_right,
    float         margin_bottom,
    float         margin_left,
    const char*   base_url,
    const char*   user_style,
    int           img_w,
    int           img_h,
    int           quality,
    const char*   format,
    unsigned int* out_len)
{
    *out_len = 0;

    plutobook_page_size_t    page_size = PLUTOBOOK_MAKE_PAGE_SIZE(page_width, page_height);
    plutobook_page_margins_t margins   = PLUTOBOOK_MAKE_PAGE_MARGINS(
        margin_top, margin_right, margin_bottom, margin_left);

    plutobook_t* book = plutobook_create(page_size, margins, PLUTOBOOK_MEDIA_TYPE_PRINT);
    if(!book) return NULL;

    plutobook_set_custom_resource_fetcher(book, wasm_resource_fetcher, NULL);

    if(!plutobook_load_html(book, html, html_len, user_style, NULL, base_url)) {
        plutobook_destroy(book);
        return NULL;
    }

    /* Use PNG stream path for PNG — avoids a pixel-format conversion. */
    int is_png = !format || format[0] == '\0'
              || (format[0]|32) == 'p';  /* "png" */

    if(is_png) {
        pdf_buffer_t buf = {NULL, 0, 0};
        if(!plutobook_write_to_png_stream(book, pdf_write_callback, &buf, img_w, img_h)) {
            free(buf.data);
            plutobook_destroy(book);
            return NULL;
        }
        plutobook_destroy(book);
        *out_len = buf.size;
        return buf.data;
    }

    /* For JPEG: render to an image canvas, convert pixels, then encode. */
    plutobook_canvas_t* canvas = NULL;

    /* plutobook_write_to_png_stream internally creates the canvas at the right
     * size.  We need the same logic but with raw pixel access, so create the
     * canvas ourselves using the book's document dimensions. */
    float doc_w = plutobook_get_document_width(book);
    float doc_h = plutobook_get_document_height(book);
    if(doc_w <= 0 || doc_h <= 0) { plutobook_destroy(book); return NULL; }

    int out_w = img_w, out_h = img_h;
    if(out_w <= 0 && out_h <= 0) {
        out_w = (int)(doc_w + 0.5f);
        out_h = (int)(doc_h + 0.5f);
    } else if(out_w > 0 && out_h <= 0) {
        out_h = (int)(out_w * doc_h / doc_w + 0.5f);
    } else if(out_h > 0 && out_w <= 0) {
        out_w = (int)(out_h * doc_w / doc_h + 0.5f);
    }

    canvas = plutobook_image_canvas_create(out_w, out_h, PLUTOBOOK_IMAGE_FORMAT_ARGB32);
    if(!canvas) { plutobook_destroy(book); return NULL; }

    float sx = out_w / doc_w, sy = out_h / doc_h;
    plutobook_canvas_scale(canvas, sx, sy);
    plutobook_render_document_rect(book, canvas, 0, 0, doc_w, doc_h);
    plutobook_canvas_flush(canvas);
    plutobook_destroy(book);

    const uint8_t* pixels = plutobook_image_canvas_get_data(canvas);
    int stride             = plutobook_image_canvas_get_stride(canvas);
    int q                  = (quality > 0 && quality <= 100) ? quality : 90;

    /* Build a contiguous RGB pixel array, then encode. */
    uint8_t* rgb = (uint8_t*)malloc((size_t)out_w * out_h * 3);
    if(!rgb) { plutobook_canvas_destroy(canvas); return NULL; }

    for(int y = 0; y < out_h; y++) {
        argb32_row_to_rgb(pixels + (size_t)y * stride, rgb + (size_t)y * out_w * 3, out_w);
    }

    pdf_buffer_t buf = {NULL, 0, 0};
    stbi_write_jpg_to_func(stbiw_write_callback, &buf, out_w, out_h, 3, rgb, q);
    free(rgb);
    plutobook_canvas_destroy(canvas);

    *out_len = buf.size;
    return buf.data;
}
