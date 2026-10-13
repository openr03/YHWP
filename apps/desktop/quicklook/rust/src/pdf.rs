use base64::Engine;
use pdf_writer::{Finish, Pdf, Ref};
use std::collections::HashMap;

pub(crate) fn png_pages_to_pdf(pages: Vec<PngPage>) -> Result<Vec<u8>, String> {
    let svg_pages = pages
        .into_iter()
        .map(PngPage::into_svg)
        .collect::<Result<Vec<_>, _>>()?;
    svgs_to_pdf(&svg_pages)
}

pub(crate) struct PngPage {
    pub png: Vec<u8>,
    pub width: f64,
    pub height: f64,
}

impl PngPage {
    fn into_svg(self) -> Result<String, String> {
        if self.png.is_empty() || self.width <= 0.0 || self.height <= 0.0 {
            return Err("invalid png page".to_string());
        }
        let encoded = base64::engine::general_purpose::STANDARD.encode(&self.png);
        Ok(format!(
            r#"<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{height}" viewBox="0 0 {width} {height}"><image width="{width}" height="{height}" href="data:image/png;base64,{encoded}"/></svg>"#,
            width = self.width,
            height = self.height,
        ))
    }
}

fn svgs_to_pdf(svg_pages: &[String]) -> Result<Vec<u8>, String> {
    if svg_pages.is_empty() {
        return Err("empty pages".to_string());
    }
    if svg_pages.len() == 1 {
        return svg_to_pdf(&svg_pages[0]);
    }

    let mut alloc = Ref::new(1);
    let catalog_ref = alloc.bump();
    let page_tree_ref = alloc.bump();

    struct PageData {
        chunk: pdf_writer::Chunk,
        svg_ref: Ref,
        width: f32,
        height: f32,
    }

    let mut page_datas = Vec::with_capacity(svg_pages.len());
    for svg in svg_pages {
        let tree = parse_svg_tree(svg).map_err(|error| error.to_string())?;
        let (chunk, svg_ref) =
            svg2pdf::to_chunk(&tree, conversion_options()).map_err(|error| format!("{error:?}"))?;
        let dpi_ratio = 72.0 / 96.0;
        page_datas.push(PageData {
            chunk,
            svg_ref,
            width: tree.size().width() * dpi_ratio,
            height: tree.size().height() * dpi_ratio,
        });
    }

    let mut page_refs = Vec::with_capacity(page_datas.len());
    let mut renumbered_chunks = Vec::with_capacity(page_datas.len());
    let mut renumbered_svg_refs = Vec::with_capacity(page_datas.len());
    for data in &page_datas {
        page_refs.push(alloc.bump());

        let mut map = HashMap::new();
        let renumbered = data
            .chunk
            .renumber(|old| *map.entry(old).or_insert_with(|| alloc.bump()));
        let svg_ref = map.get(&data.svg_ref).copied().unwrap_or(data.svg_ref);
        renumbered_chunks.push(renumbered);
        renumbered_svg_refs.push(svg_ref);
    }

    let mut pdf = Pdf::new();
    pdf.catalog(catalog_ref).pages(page_tree_ref);
    pdf.pages(page_tree_ref)
        .kids(page_refs.iter().copied())
        .count(page_refs.len() as i32);

    for (idx, data) in page_datas.iter().enumerate() {
        let page_ref = page_refs[idx];
        let content_ref = alloc.bump();
        let svg_name = pdf_writer::Name(b"S1");

        let mut page = pdf.page(page_ref);
        page.media_box(pdf_writer::Rect::new(0.0, 0.0, data.width, data.height));
        page.parent(page_tree_ref);
        page.contents(content_ref);
        let mut resources = page.resources();
        resources
            .x_objects()
            .pair(svg_name, renumbered_svg_refs[idx]);
        resources.finish();
        page.finish();

        let mut content = pdf_writer::Content::new();
        content.transform([data.width, 0.0, 0.0, data.height, 0.0, 0.0]);
        content.x_object(svg_name);
        pdf.stream(content_ref, &content.finish());
    }

    for chunk in &renumbered_chunks {
        pdf.extend(chunk);
    }

    pdf.document_info(alloc.bump())
        .producer(pdf_writer::TextStr("yhwp-quicklook"));
    Ok(pdf.finish())
}

fn svg_to_pdf(svg_content: &str) -> Result<Vec<u8>, String> {
    let tree = parse_svg_tree(svg_content).map_err(|error| error.to_string())?;
    svg2pdf::to_pdf(&tree, conversion_options(), svg2pdf::PageOptions::default())
        .map_err(|error| format!("{error:?}"))
}

fn parse_svg_tree(svg_content: &str) -> Result<usvg::Tree, usvg::Error> {
    usvg::Tree::from_str(svg_content, &usvg::Options::default())
}

fn conversion_options() -> svg2pdf::ConversionOptions {
    svg2pdf::ConversionOptions {
        embed_text: false,
        ..svg2pdf::ConversionOptions::default()
    }
}
