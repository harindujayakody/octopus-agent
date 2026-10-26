//! Per-profile window icon: the profile's own name on a platform-shaped badge,
//! so a dozen windows are tellable apart in the Dock, taskbar and Alt-Tab.
//! Composed and cached here; the browser only loads the file.

use ab_glyph::{Font, FontRef, PxScale, ScaleFont};
use anyhow::{Context, Result};
use std::path::{Path, PathBuf};
use tiny_skia::{Color, FillRule, Paint, PathBuilder, Pixmap, Transform};

const FONT: &[u8] = include_bytes!("../assets/NotoSans-Bold.ttf");
/// The product mark, drawn into the accent band so a profile icon still reads
/// as ShardX at a glance.
const MARK: &[u8] = include_bytes!("../icons/icon.png");

/// Rendered at 512 and downscaled by the toolkit.
const SIZE: f32 = 512.0;

/// Per-platform geometry, matching what each shell draws around an icon.
struct Geometry {
    /// Inset from the canvas edge, as a fraction of SIZE.
    margin: f32,
    /// Corner radius as a fraction of SIZE (ignored for the squircle).
    radius: f32,
    squircle: bool,
    shadow: bool,
    outline: bool,
    /// Whether the body itself carries the profile's colour.
    ///
    /// A macOS icon does not follow the system theme — the same file is shown
    /// on a light Dock and on a dark one — so it has to read on both. A white
    /// card with a thin coloured band does not: against a dark Dock it is a
    /// pale blank with the one thing that tells profiles apart reduced to a
    /// stripe a few pixels tall. Every ordinary Mac icon is a filled shape,
    /// so this one is too, and the profile's colour is what fills it.
    coloured_body: bool,
}

const fn geometry() -> Geometry {
    #[cfg(target_os = "macos")]
    {
        Geometry { margin: 0.098, radius: 0.0, squircle: true, shadow: true, outline: false, coloured_body: true }
    }
    #[cfg(target_os = "windows")]
    {
        Geometry { margin: 0.045, radius: 0.115, squircle: false, shadow: false, outline: false, coloured_body: false }
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        Geometry { margin: 0.055, radius: 0.165, squircle: false, shadow: false, outline: true, coloured_body: false }
    }
}

/// Superellipse exponent; 5.0 is close to the macOS curve.
const N: f32 = 5.0;

/// Accent for a profile with no colour of its own: derived from the name, so
/// the same profile is always the same colour. It is the only thing still
/// telling profiles apart at 32 px, where no type is legible.
fn accent(name: &str) -> Color {
    let mut h: u64 = 1469598103934665603;
    for b in name.as_bytes() {
        h ^= *b as u64;
        h = h.wrapping_mul(1099511628211);
    }
    let hue = (h % 360) as f32;
    let (r, g, b) = hsv_to_rgb(hue, 0.70, 0.86);
    Color::from_rgba8(r, g, b, 255)
}

/// `#rgb` / `#rrggbb`, as the colour picker writes it.
fn parse_hex(raw: &str) -> Option<Color> {
    let h = raw.trim().trim_start_matches('#');
    let (r, g, b) = match h.len() {
        3 => {
            let d = |i: usize| u8::from_str_radix(&h[i..i + 1].repeat(2), 16).ok();
            (d(0)?, d(1)?, d(2)?)
        }
        6 => {
            let d = |i: usize| u8::from_str_radix(&h[i..i + 2], 16).ok();
            (d(0)?, d(2)?, d(4)?)
        }
        _ => return None,
    };
    Some(Color::from_rgba8(r, g, b, 255))
}

fn hsv_to_rgb(h: f32, s: f32, v: f32) -> (u8, u8, u8) {
    let c = v * s;
    let x = c * (1.0 - ((h / 60.0) % 2.0 - 1.0).abs());
    let m = v - c;
    let (r, g, b) = match (h as u32) / 60 {
        0 => (c, x, 0.0),
        1 => (x, c, 0.0),
        2 => (0.0, c, x),
        3 => (0.0, x, c),
        4 => (x, 0.0, c),
        _ => (c, 0.0, x),
    };
    (
        ((r + m) * 255.0) as u8,
        ((g + m) * 255.0) as u8,
        ((b + m) * 255.0) as u8,
    )
}

fn squircle(cx: f32, cy: f32, a: f32) -> Option<tiny_skia::Path> {
    let mut pb = PathBuilder::new();
    let steps = 720;
    for i in 0..steps {
        let t = std::f32::consts::TAU * (i as f32) / (steps as f32);
        let (st, ct) = t.sin_cos();
        let x = cx + a * ct.abs().powf(2.0 / N) * ct.signum();
        let y = cy + a * st.abs().powf(2.0 / N) * st.signum();
        if i == 0 {
            pb.move_to(x, y);
        } else {
            pb.line_to(x, y);
        }
    }
    pb.close();
    pb.finish()
}

/// Rounded rectangle; tiny-skia has none. Quadratic corners are under a pixel
/// off at 512 px.
fn rounded_rect(l: f32, t: f32, r: f32, b: f32, rad: f32) -> Option<tiny_skia::Path> {
    let mut pb = PathBuilder::new();
    pb.move_to(l + rad, t);
    pb.line_to(r - rad, t);
    pb.quad_to(r, t, r, t + rad);
    pb.line_to(r, b - rad);
    pb.quad_to(r, b, r - rad, b);
    pb.line_to(l + rad, b);
    pb.quad_to(l, b, l, b - rad);
    pb.line_to(l, t + rad);
    pb.quad_to(l, t, l + rad, t);
    pb.close();
    pb.finish()
}

/// The body outline for this platform, plus its bounding box.
fn body_path(g: &Geometry) -> Option<(tiny_skia::Path, (f32, f32, f32, f32))> {
    let m = SIZE * g.margin;
    let (l, t, r, b) = (m, m, SIZE - m, SIZE - m);
    let path = if g.squircle {
        squircle(SIZE / 2.0, SIZE / 2.0, (r - l) / 2.0)?
    } else {
        rounded_rect(l, t, r, b, SIZE * g.radius)?
    };
    Some((path, (l, t, r, b)))
}

/// Wraps `name` to at most `max_lines` and picks the largest size that fits.
fn layout<'a>(
    font: &FontRef<'a>,
    name: &str,
    max_w: f32,
    max_h: f32,
    max_lines: usize,
) -> (f32, Vec<String>) {
    let words: Vec<&str> = name.split_whitespace().collect();
    let words = if words.is_empty() { vec![name] } else { words };

    let mut px = SIZE * 0.21;
    while px > 14.0 {
        let scaled = font.as_scaled(PxScale::from(px));
        let width = |s: &str| -> f32 {
            s.chars()
                .map(|c| scaled.h_advance(scaled.scaled_glyph(c).id))
                .sum()
        };
        let mut lines: Vec<String> = Vec::new();
        let mut cur = String::new();
        for w in &words {
            let cand = if cur.is_empty() {
                w.to_string()
            } else {
                format!("{cur} {w}")
            };
            if width(&cand) <= max_w {
                cur = cand;
            } else {
                if !cur.is_empty() {
                    lines.push(std::mem::take(&mut cur));
                }
                cur = w.to_string();
                // A word wider than the line is ellipsised, not overflowed.
                while !cur.is_empty() && width(&format!("{cur}…")) > max_w {
                    cur.pop();
                }
                if width(w) > max_w {
                    cur.push('…');
                }
            }
        }
        if !cur.is_empty() {
            lines.push(cur);
        }
        if lines.len() <= max_lines && (lines.len() as f32) * px * 1.16 <= max_h {
            return (px, lines);
        }
        px -= 4.0;
    }
    (14.0, vec![name.chars().take(9).collect()])
}

fn draw_text(
    pix: &mut Pixmap,
    font: &FontRef<'_>,
    lines: &[String],
    px: f32,
    cx: f32,
    top: f32,
    color: (u8, u8, u8),
) {
    let scaled = font.as_scaled(PxScale::from(px));
    let mut y = top + scaled.ascent();
    for line in lines {
        let w: f32 = line
            .chars()
            .map(|c| scaled.h_advance(scaled.scaled_glyph(c).id))
            .sum();
        let mut x = cx - w / 2.0;
        for ch in line.chars() {
            let glyph = scaled.scaled_glyph(ch);
            let advance = scaled.h_advance(glyph.id);
            if let Some(outline) = font.outline_glyph(glyph.clone()) {
                let bounds = outline.px_bounds();
                outline.draw(|gx, gy, cov| {
                    if cov <= 0.0 {
                        return;
                    }
                    let px_x = (bounds.min.x + gx as f32 + x) as i32;
                    let px_y = (bounds.min.y + gy as f32 + y) as i32;
                    if px_x < 0 || px_y < 0 {
                        return;
                    }
                    let (w, h) = (pix.width() as i32, pix.height() as i32);
                    if px_x >= w || px_y >= h {
                        return;
                    }
                    // tiny_skia has no glyph rasteriser: ab_glyph gives coverage,
                    // we composite it.
                    let idx = (px_y * w + px_x) as usize * 4;
                    let data = pix.data_mut();
                    let a = cov.clamp(0.0, 1.0);
                    for (i, c) in [color.0, color.1, color.2].iter().enumerate() {
                        let dst = data[idx + i] as f32;
                        data[idx + i] = (dst * (1.0 - a) + (*c as f32) * a) as u8;
                    }
                    let dst_a = data[idx + 3] as f32;
                    data[idx + 3] = (dst_a * (1.0 - a) + 255.0 * a) as u8;
                });
            }
            x += advance;
        }
        y += px * 1.16;
    }
}

/// Composes the icon for `name` in `color` (None = derived from the name) and
/// returns the PNG path, reusing the cached file when neither has changed.
pub fn ensure_icon(cache_dir: &Path, name: &str, color: Option<&str>) -> Result<PathBuf> {
    // The drawing is part of the key, not just the name and the colour. The
    // folder outlives updates, so when the mark or the layout changes an
    // existing profile would otherwise keep showing the icon drawn by the
    // version before — until somebody renamed it.
    let key = format!(
        "{name}\u{1}{}\u{1}{}\u{1}{}",
        color.unwrap_or(""),
        env!("CARGO_PKG_VERSION"),
        MARK.len()
    );
    let mut h: u64 = 1469598103934665603;
    for b in key.as_bytes() {
        h ^= *b as u64;
        h = h.wrapping_mul(1099511628211);
    }
    let dir = cache_dir.join("profile-icons");
    std::fs::create_dir_all(&dir).ok();
    let out = dir.join(format!("{h:016x}.png"));
    if out.exists() {
        return Ok(out);
    }

    let g = geometry();
    let s = SIZE as u32;
    let mut pix = Pixmap::new(s, s).context("allocate pixmap")?;
    let (body, (x0, y0, x1, y1)) = body_path(&g).context("body path")?;
    let cx = (x0 + x1) / 2.0;

    let mut paint = Paint::default();
    paint.anti_alias = true;

    // Shadow (macOS only): stacked offset copies at low alpha — tiny-skia has
    // no blur, and at icon sizes the stack is indistinguishable.
    if g.shadow {
        for (i, alpha) in [(3.0_f32, 16u8), (6.0, 14), (10.0, 11), (15.0, 8)] {
            if let Some(sh) = body_path(&g).map(|(p, _)| p) {
                paint.set_color(Color::from_rgba8(0, 0, 0, alpha));
                let t = Transform::from_translate(0.0, i)
                    .pre_scale(1.0 + i / SIZE, 1.0 + i / SIZE)
                    .pre_translate(-cx * (i / SIZE), -(y0 + y1) / 2.0 * (i / SIZE));
                pix.fill_path(&sh, &paint, FillRule::Winding, t, None);
            }
        }
    }

    let tint = color.and_then(parse_hex).unwrap_or_else(|| accent(name));

    // The body: the profile's colour where the icon has to carry it alone,
    // white where the surface behind it is predictable.
    paint.set_color(if g.coloured_body {
        tint
    } else {
        Color::from_rgba8(255, 255, 255, 255)
    });
    pix.fill_path(&body, &paint, FillRule::Winding, Transform::identity(), None);

    // The band the mark sits on, clipped to the body so its corners follow
    // the same curve. On a coloured body it is a darker shade of the same
    // colour rather than the colour itself, which would be invisible.
    let band_h = y0 + (y1 - y0) * 0.30;
    let mut band = PathBuilder::new();
    band.push_rect(tiny_skia::Rect::from_ltrb(0.0, 0.0, SIZE, band_h).context("band rect")?);
    if let Some(rect) = band.finish() {
        let mut clip = tiny_skia::Mask::new(s, s).context("mask")?;
        clip.fill_path(&body, FillRule::Winding, true, Transform::identity());
        paint.set_color(if g.coloured_body { shade(tint, 0.72) } else { tint });
        pix.fill_path(&rect, &paint, FillRule::Winding, Transform::identity(), Some(&clip));
        draw_mark(&mut pix, cx, (y0 + band_h) / 2.0, (band_h - y0) * 0.62);
    }

    // Hairline outline, Linux only.
    if g.outline {
        paint.set_color(Color::from_rgba8(0, 0, 0, 38));
        let stroke = tiny_skia::Stroke { width: SIZE * 0.006, ..Default::default() };
        pix.stroke_path(&body, &paint, &stroke, Transform::identity(), None);
    }

    let font = FontRef::try_from_slice(FONT).context("load font")?;
    let top = y0 + (y1 - y0) * 0.36;
    let (px, lines) = layout(&font, name, (x1 - x0) * 0.82, (y1 - top) * 0.72, 3);
    let block_h = lines.len() as f32 * px * 1.16;
    let text_top = top + ((y1 - top) - block_h) / 2.0;
    // Dark type on a white card; white type on a coloured one. Which way
    // round is decided by the colour the operator picked, not by the theme,
    // because the file is the same on both.
    let ink = if g.coloured_body {
        if luminance(tint) > 0.62 { (28, 30, 36) } else { (255, 255, 255) }
    } else {
        (34, 36, 42)
    };
    draw_text(&mut pix, &font, &lines, px, cx, text_top, ink);

    pix.save_png(&out).context("write icon png")?;
    Ok(out)
}

/// The same colour, darker, for the band under the mark.
fn shade(c: Color, factor: f32) -> Color {
    Color::from_rgba8(
        (c.red() * 255.0 * factor) as u8,
        (c.green() * 255.0 * factor) as u8,
        (c.blue() * 255.0 * factor) as u8,
        255,
    )
}

/// Perceived brightness, for deciding whether type on this colour is dark or
/// light. A pale colour an operator picked must not end up white on white.
fn luminance(c: Color) -> f32 {
    0.2126 * c.red() + 0.7152 * c.green() + 0.0722 * c.blue()
}

/// The product mark, centred on (`cx`, `cy`) at `height` pixels.
fn draw_mark(pix: &mut Pixmap, cx: f32, cy: f32, height: f32) {
    let Some(mark) = mark_pixmap() else { return };
    if height <= 1.0 {
        return;
    }
    let scale = height / mark.height() as f32;
    let w = mark.width() as f32 * scale;
    let paint = tiny_skia::PixmapPaint {
        quality: tiny_skia::FilterQuality::Bicubic,
        ..Default::default()
    };
    // draw_pixmap places the pixmap's origin at (x, y) and then applies the
    // transform, so the scale has to be folded into the offset by hand.
    pix.draw_pixmap(
        0,
        0,
        mark.as_ref(),
        &paint,
        Transform::from_scale(scale, scale)
            .post_translate(cx - w / 2.0, cy - height / 2.0),
        None,
    );
}

/// The mark, decoded once and premultiplied — tiny-skia wants premultiplied
/// alpha, PNG stores straight.
fn mark_pixmap() -> Option<&'static Pixmap> {
    static CACHE: std::sync::OnceLock<Option<Pixmap>> = std::sync::OnceLock::new();
    CACHE
        .get_or_init(|| {
            let mut reader = png::Decoder::new(MARK).read_info().ok()?;
            let mut buf = vec![0; reader.output_buffer_size()];
            let info = reader.next_frame(&mut buf).ok()?;
            if info.color_type != png::ColorType::Rgba || info.bit_depth != png::BitDepth::Eight {
                return None;
            }
            buf.truncate(info.buffer_size());
            for px in buf.chunks_exact_mut(4) {
                let a = px[3] as u32;
                for c in 0..3 {
                    px[c] = ((px[c] as u32 * a + 127) / 255) as u8;
                }
            }
            Pixmap::from_vec(buf, tiny_skia::IntSize::from_wh(info.width, info.height)?)
        })
        .as_ref()
}
