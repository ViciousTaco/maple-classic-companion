//! Screen watcher: window list, one-off setup snapshot and OCR of owner-selected regions (I-29, D-10 amended).
//!
//! What this touches — and what it never does:
//! * Reads **composed screen pixels** (a GDI copy from the desktop, like any screenshot tool) of the window the
//!   owner picked, and only when the UI calls a command. The UI owns on/off; nothing here runs by itself.
//! * Never opens a handle to another process, never sends it window messages or input, never hooks or injects.
//!   Titles come from the window manager, exe names from a Toolhelp process list, occlusion from window rects.
//! * Frames live in memory for one call and are dropped. Nothing is written to disk; `screen_snapshot` hands one
//!   downscaled PNG to the UI for the region picker and Rust keeps no copy.
//!
//! Caveat of screen copying: a region covered by another window (e.g. the always-on-top mini window) reads that
//! window's pixels. `RegionText::covered` / `Snapshot::covered` tell the UI so it can ignore or warn.
use serde::{Deserialize, Serialize};

pub const MAX_REGION_SIDE: u32 = 4000;
pub const MAX_REGIONS: usize = 16;
pub const DEFAULT_SCALE: f64 = 2.0;
pub const MAX_SCALE: f64 = 4.0;
pub const SNAPSHOT_LONG_EDGE: u32 = 1600;
/// Border (source pixels, filled with the region's background) added before OCR: Windows OCR misses text that
/// touches the image edge. Measured on rendered 12-13 px UI text: no border ≈ 25-30% of lines exact, 16 px ≈ 75%.
pub const OCR_PAD: u32 = 16;
/// Bytes per pixel of every buffer here (BGRA, top-down rows).
const BPP: usize = 4;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WindowInfo {
    pub id: u32,
    pub title: String,
    /// Exe file name, e.g. `MapleStory.exe` (empty if unknown).
    pub app: String,
    /// Physical pixels; for a minimised window, its restored size.
    pub width: u32,
    pub height: u32,
    pub minimized: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub png_base64: String,
    /// PNG size.
    pub width: u32,
    pub height: u32,
    /// Real window size in pixels: region coordinates for `screen_read` use this space.
    pub source_width: u32,
    pub source_height: u32,
    /// Part of the window was behind another window or off-screen when the snapshot was taken.
    pub covered: bool,
}

/// Upscaling filter before OCR: `bilinear` (default; smooth/anti-aliased text) or `nearest` (pixel fonts).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Filter {
    #[default]
    Bilinear,
    Nearest,
}

/// A rectangle in **source window pixels** (fractions are rounded). `scale` = OCR upscale, 1–4, default 2.
#[derive(Debug, Clone, Deserialize)]
pub struct Region {
    pub name: String,
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
    #[serde(default)]
    pub scale: Option<f64>,
    #[serde(default)]
    pub filter: Filter,
    /// `"bar"`: measure how far a progress bar is filled instead of reading text (the EXP bar; I-45).
    #[serde(default)]
    pub mode: Mode,
}

#[derive(Debug, Clone, Copy, Default, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Mode {
    #[default]
    Ocr,
    Bar,
    /// Text *and* bar fill from the same box (the EXP strip: digits above a thin bar).
    Both,
}

/// One recognised line; the box is in region pixels.
#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct OcrLine {
    pub text: String,
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
}

#[derive(Debug, Clone, Serialize)]
pub struct RegionText {
    pub name: String,
    pub lines: Vec<OcrLine>,
    /// Another window overlapped this region (or it was off-screen): the text is probably not the game's.
    pub covered: bool,
    /// `mode: "bar"` only — the filled fraction 0..1, or null when the box doesn't look like a bar.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fill: Option<f64>,
}

/// The bar in an EXP strip sits under the digits: measure the bottom 40 % of the box (at least 3 rows).
pub fn bar_fill_lower(px: &[u8], w: u32, h: u32) -> Option<f64> {
    if h < 4 {
        return bar_fill(px, w, h);
    }
    let rows = (h * 2 / 5).max(3).min(h);
    let start = (h - rows) as usize * w as usize * BPP;
    bar_fill(&px[start..], w, rows)
}

/// How far a horizontal progress bar is filled, from its pixels (BGRA, `w`×`h`). The filled part is brighter /
/// more colourful than the empty part and sits on the left. Several rows are sampled (text drawn over the bar
/// spoils single rows) and the median taken. None when there is no clear bright/dark split.
pub fn bar_fill(px: &[u8], w: u32, h: u32) -> Option<f64> {
    if w < 8 || h < 2 {
        return None;
    }
    let rows: Vec<u32> = if h >= 6 { vec![h / 5, h * 2 / 5, h / 2, h * 3 / 5, h * 4 / 5] } else { (0..h).collect() };
    let mut fills: Vec<f64> = Vec::new();
    for &row in &rows {
        let mut v: Vec<f64> = (0..w)
            .map(|x| {
                let i = ((row * w + x) as usize) * BPP;
                let (b, g, r) = (px[i] as f64, px[i + 1] as f64, px[i + 2] as f64);
                let max = r.max(g).max(b);
                let min = r.min(g).min(b);
                0.6 * max + 0.4 * (max - min) // brightness, with a bonus for colour
            })
            .collect();
        let lo = v.iter().cloned().fold(f64::MAX, f64::min);
        let hi = v.iter().cloned().fold(f64::MIN, f64::max);
        if hi - lo < 40.0 {
            continue; // flat row: all filled, all empty, or not a bar
        }
        let th = (lo + hi) / 2.0;
        // Smooth 3 px to ignore thin tick marks, then find the last bright column with a bright run behind it.
        let n = v.len();
        let sm: Vec<f64> = (0..n).map(|i| (v[i.saturating_sub(1)] + v[i] + v[(i + 1).min(n - 1)]) / 3.0).collect();
        v.clear();
        let bright: Vec<bool> = sm.iter().map(|&b| b >= th).collect();
        let mut edge = 0usize;
        let mut run = 0usize;
        for (i, &b) in bright.iter().enumerate() {
            if b {
                run += 1;
                if run >= 3 {
                    edge = i + 1;
                }
            } else {
                run = 0;
            }
        }
        let bright_before = bright[..edge].iter().filter(|&&b| b).count() as f64 / edge.max(1) as f64;
        if edge > 0 && bright_before < 0.6 {
            continue; // bright bits scattered (text), not a bar fill
        }
        fills.push(edge as f64 / n as f64);
    }
    if fills.is_empty() {
        return None;
    }
    fills.sort_by(|a, b| a.partial_cmp(b).unwrap());
    Some(fills[fills.len() / 2])
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct PxRect {
    pub x: u32,
    pub y: u32,
    pub w: u32,
    pub h: u32,
}

/// Screen-space rectangle (virtual desktop pixels; may be negative on monitors left of / above the primary).
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ScreenRect {
    pub x: i32,
    pub y: i32,
    pub w: u32,
    pub h: u32,
}

impl ScreenRect {
    pub fn intersects(&self, o: &ScreenRect) -> bool {
        let (ax2, ay2) = (self.x as i64 + self.w as i64, self.y as i64 + self.h as i64);
        let (bx2, by2) = (o.x as i64 + o.w as i64, o.y as i64 + o.h as i64);
        (self.x as i64) < bx2 && (o.x as i64) < ax2 && (self.y as i64) < by2 && (o.y as i64) < ay2
    }

    pub fn offset(&self, r: PxRect) -> ScreenRect {
        ScreenRect { x: self.x + r.x as i32, y: self.y + r.y as i32, w: r.w, h: r.h }
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Pure helpers (unit-tested on every platform)
// ---------------------------------------------------------------------------------------------------------------

pub fn check_scale(scale: Option<f64>) -> Result<f64, String> {
    let s = scale.unwrap_or(DEFAULT_SCALE);
    if s.is_finite() && (1.0..=MAX_SCALE).contains(&s) {
        Ok(s)
    } else {
        Err(format!("scale must be between 1 and {MAX_SCALE}"))
    }
}

/// Validates one region against the window size and rounds it to whole pixels.
pub fn check_region(r: &Region, win_w: u32, win_h: u32) -> Result<PxRect, String> {
    let name = &r.name;
    if name.trim().is_empty() || name.chars().count() > 64 {
        return Err("Region name must be 1-64 characters".into());
    }
    if [r.x, r.y, r.w, r.h].iter().any(|v| !v.is_finite() || *v < 0.0) {
        return Err(format!("Region \"{name}\" has a negative or invalid coordinate"));
    }
    let (x, y, w, h) = (r.x.round(), r.y.round(), r.w.round(), r.h.round());
    if w < 1.0 || h < 1.0 {
        return Err(format!("Region \"{name}\" is empty"));
    }
    if w > MAX_REGION_SIDE as f64 || h > MAX_REGION_SIDE as f64 {
        return Err(format!("Region \"{name}\" is larger than {MAX_REGION_SIDE}x{MAX_REGION_SIDE}"));
    }
    if x + w > win_w as f64 || y + h > win_h as f64 {
        return Err(format!(
            "Region \"{name}\" ({x},{y} {w}x{h}) is outside the {win_w}x{win_h} window — set the boxes up again"
        ));
    }
    Ok(PxRect { x: x as u32, y: y as u32, w: w as u32, h: h as u32 })
}

/// Validates every region (names unique) and returns their pixel rects and scales.
pub fn check_regions(regions: &[Region], win_w: u32, win_h: u32) -> Result<Vec<(PxRect, f64)>, String> {
    if regions.len() > MAX_REGIONS {
        return Err(format!("At most {MAX_REGIONS} regions per read"));
    }
    let mut seen = std::collections::HashSet::new();
    regions
        .iter()
        .map(|r| {
            if !seen.insert(r.name.as_str()) {
                return Err(format!("Region name \"{}\" is used twice", r.name));
            }
            Ok((check_region(r, win_w, win_h)?, check_scale(r.scale)?))
        })
        .collect()
}

/// Smallest rect containing all `rects` (`None` when empty).
pub fn bounding(rects: &[PxRect]) -> Option<PxRect> {
    let first = rects.first()?;
    let (mut x1, mut y1, mut x2, mut y2) = (first.x, first.y, first.x + first.w, first.y + first.h);
    for r in &rects[1..] {
        x1 = x1.min(r.x);
        y1 = y1.min(r.y);
        x2 = x2.max(r.x + r.w);
        y2 = y2.max(r.y + r.h);
    }
    Some(PxRect { x: x1, y: y1, w: x2 - x1, h: y2 - y1 })
}

/// Copies `r` out of a BGRA buffer `src_w` pixels wide. `r` must lie inside the buffer.
pub fn crop(src: &[u8], src_w: u32, r: PxRect) -> Vec<u8> {
    let stride = src_w as usize * BPP;
    let row_len = r.w as usize * BPP;
    let mut out = Vec::with_capacity(row_len * r.h as usize);
    for row in r.y as usize..(r.y + r.h) as usize {
        let start = row * stride + r.x as usize * BPP;
        out.extend_from_slice(&src[start..start + row_len]);
    }
    out
}

/// OCR input size for a `w`×`h` region at `scale`, kept within the engine's `max_dim` on both sides.
pub fn ocr_size(w: u32, h: u32, scale: f64, max_dim: u32) -> (u32, u32) {
    let s = scale.min(max_dim as f64 / w.max(h) as f64);
    let fit = |v: u32| ((v as f64 * s).round() as u32).clamp(1, max_dim);
    (fit(w), fit(h))
}

/// Size that keeps the aspect ratio with the long edge ≤ `max` (never upscales).
pub fn fit_long_edge(w: u32, h: u32, max: u32) -> (u32, u32) {
    let long = w.max(h);
    if long <= max {
        return (w, h);
    }
    let s = max as f64 / long as f64;
    (((w as f64 * s).round() as u32).max(1), ((h as f64 * s).round() as u32).max(1))
}

/// Resizes a BGRA image: area-average when shrinking, bilinear when growing.
pub fn resize(src: &[u8], w: u32, h: u32, nw: u32, nh: u32) -> Vec<u8> {
    debug_assert_eq!(src.len(), w as usize * h as usize * BPP);
    if (nw, nh) == (w, h) {
        src.to_vec()
    } else if nw <= w && nh <= h {
        area_average(src, w, h, nw, nh)
    } else {
        bilinear(src, w, h, nw, nh)
    }
}

fn bilinear(src: &[u8], w: u32, h: u32, nw: u32, nh: u32) -> Vec<u8> {
    let (w, h, nw, nh) = (w as usize, h as usize, nw as usize, nh as usize);
    // For each destination column/row: the two source indices and the weight of the second one.
    let taps = |n: usize, len: usize| -> Vec<(usize, usize, f32)> {
        let f = len as f64 / n as f64;
        (0..n)
            .map(|d| {
                let s = ((d as f64 + 0.5) * f - 0.5).clamp(0.0, (len - 1) as f64);
                let i0 = s.floor() as usize;
                (i0, (i0 + 1).min(len - 1), (s - i0 as f64) as f32)
            })
            .collect()
    };
    let (xs, ys) = (taps(nw, w), taps(nh, h));
    let mut out = vec![0u8; nw * nh * BPP];
    for (dy, &(y0, y1, fy)) in ys.iter().enumerate() {
        let (r0, r1) = (&src[y0 * w * BPP..(y0 + 1) * w * BPP], &src[y1 * w * BPP..(y1 + 1) * w * BPP]);
        let dst = &mut out[dy * nw * BPP..(dy + 1) * nw * BPP];
        for (dx, &(x0, x1, fx)) in xs.iter().enumerate() {
            for c in 0..BPP {
                let top = r0[x0 * BPP + c] as f32 * (1.0 - fx) + r0[x1 * BPP + c] as f32 * fx;
                let bottom = r1[x0 * BPP + c] as f32 * (1.0 - fx) + r1[x1 * BPP + c] as f32 * fx;
                dst[dx * BPP + c] = (top * (1.0 - fy) + bottom * fy).round() as u8;
            }
        }
    }
    out
}

fn area_average(src: &[u8], w: u32, h: u32, nw: u32, nh: u32) -> Vec<u8> {
    let (w, h, nw, nh) = (w as usize, h as usize, nw as usize, nh as usize);
    let span = |d: usize, n: usize, len: usize| {
        let a = d * len / n;
        (a, ((d + 1) * len / n).max(a + 1).min(len))
    };
    let mut out = vec![0u8; nw * nh * BPP];
    for dy in 0..nh {
        let (ya, yb) = span(dy, nh, h);
        for dx in 0..nw {
            let (xa, xb) = span(dx, nw, w);
            let mut sum = [0u32; BPP];
            for y in ya..yb {
                for p in src[(y * w + xa) * BPP..(y * w + xb) * BPP].chunks_exact(BPP) {
                    for c in 0..BPP {
                        sum[c] += p[c] as u32;
                    }
                }
            }
            let n = ((yb - ya) * (xb - xa)) as u32;
            for c in 0..BPP {
                out[(dy * nw + dx) * BPP + c] = ((sum[c] + n / 2) / n) as u8;
            }
        }
    }
    out
}

/// Nearest-neighbour resize of a BGRA image (keeps pixel-font edges hard).
pub fn resize_nearest(src: &[u8], w: u32, h: u32, nw: u32, nh: u32) -> Vec<u8> {
    let (w, h, nw, nh) = (w as usize, h as usize, nw as usize, nh as usize);
    let xs: Vec<usize> = (0..nw).map(|d| (d * w / nw).min(w - 1)).collect();
    let mut out = Vec::with_capacity(nw * nh * BPP);
    for dy in 0..nh {
        let row = &src[(dy * h / nh).min(h - 1) * w * BPP..];
        for &sx in &xs {
            out.extend_from_slice(&row[sx * BPP..(sx + 1) * BPP]);
        }
    }
    out
}

/// Adds a `p`-pixel border filled with the median colour of the image's outer ring (its background), so text
/// that touches the edge doesn't get smeared outwards. Returns the `(w + 2p) × (h + 2p)` image.
pub fn pad_with_background(src: &[u8], w: u32, h: u32, p: u32) -> Vec<u8> {
    let (w, h, p) = (w as usize, h as usize, p as usize);
    let px = |x: usize, y: usize| &src[(y * w + x) * BPP..(y * w + x + 1) * BPP];
    let mut ring: Vec<&[u8]> = Vec::with_capacity(2 * (w + h));
    for x in 0..w {
        ring.push(px(x, 0));
        ring.push(px(x, h - 1));
    }
    for y in 0..h {
        ring.push(px(0, y));
        ring.push(px(w - 1, y));
    }
    let mut fill = [0u8, 0, 0, 255];
    for (c, slot) in fill.iter_mut().enumerate().take(3) {
        let mut v: Vec<u8> = ring.iter().map(|p| p[c]).collect();
        v.sort_unstable();
        *slot = v[v.len() / 2];
    }
    let nw = w + 2 * p;
    let mut out = fill.repeat(nw * (h + 2 * p));
    for y in 0..h {
        let dst = ((y + p) * nw + p) * BPP;
        out[dst..dst + w * BPP].copy_from_slice(&src[y * w * BPP..(y + 1) * w * BPP]);
    }
    out
}

pub fn bgra_to_rgb(src: &[u8]) -> Vec<u8> {
    src.chunks_exact(BPP).flat_map(|p| [p[2], p[1], p[0]]).collect()
}

pub fn encode_png_rgb(rgb: &[u8], w: u32, h: u32) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    let mut enc = png::Encoder::new(&mut out, w, h);
    enc.set_color(png::ColorType::Rgb);
    enc.set_depth(png::BitDepth::Eight);
    enc.set_compression(png::Compression::Fast);
    let mut writer = enc.write_header().map_err(|e| e.to_string())?;
    writer.write_image_data(rgb).map_err(|e| e.to_string())?;
    writer.finish().map_err(|e| e.to_string())?;
    Ok(out)
}

/// A box `(x, y, w, h)` in pixels.
pub type BoxF = (f32, f32, f32, f32);

/// Union of word boxes `(x, y, w, h)` measured on the padded, scaled image, mapped back to region pixels
/// (undo the scale `sx`/`sy`, then the border `pad`) and clamped to the `rw`×`rh` region.
pub fn line_box(words: &[BoxF], sx: f32, sy: f32, pad: f32, rw: u32, rh: u32) -> BoxF {
    if words.is_empty() {
        return (0.0, 0.0, 0.0, 0.0);
    }
    let (mut x1, mut y1, mut x2, mut y2) = (f32::MAX, f32::MAX, f32::MIN, f32::MIN);
    for &(x, y, w, h) in words {
        x1 = x1.min(x);
        y1 = y1.min(y);
        x2 = x2.max(x + w);
        y2 = y2.max(y + h);
    }
    let r = |v: f32| (v * 10.0).round() / 10.0;
    let (rw, rh) = (rw as f32, rh as f32);
    let (x1, x2) = ((x1 / sx - pad).clamp(0.0, rw), (x2 / sx - pad).clamp(0.0, rw));
    let (y1, y2) = ((y1 / sy - pad).clamp(0.0, rh), (y2 / sy - pad).clamp(0.0, rh));
    (r(x1), r(y1), r(x2 - x1), r(y2 - y1))
}

// ---------------------------------------------------------------------------------------------------------------
// Windows implementation
// ---------------------------------------------------------------------------------------------------------------

#[cfg(windows)]
mod win {
    use super::*;
    use base64::{engine::general_purpose::STANDARD, Engine};
    use std::{collections::HashMap, ffi::c_void, mem::size_of, sync::Mutex};
    use windows::{
        core::{BOOL, HSTRING},
        Globalization::Language,
        Graphics::Imaging::{BitmapPixelFormat, SoftwareBitmap},
        Media::Ocr::OcrEngine,
        Storage::Streams::DataWriter,
        Win32::{
            Foundation::{CloseHandle, HWND, LPARAM, POINT, RECT},
            Graphics::{
                Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED, DWMWA_EXTENDED_FRAME_BOUNDS},
                Gdi::{
                    BitBlt, CreateCompatibleDC, CreateDIBSection, DeleteDC, DeleteObject, GdiFlush, GetDC,
                    MonitorFromPoint, ReleaseDC, SelectObject, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS,
                    MONITOR_DEFAULTTONULL, SRCCOPY,
                },
            },
            System::Diagnostics::ToolHelp::{
                CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
            },
            UI::WindowsAndMessaging::{
                EnumWindows, GetClassNameW, GetWindowLongW, GetWindowPlacement, GetWindowRect, GetWindowTextW,
                GetWindowThreadProcessId, IsIconic, IsWindow, IsWindowVisible, GWL_EXSTYLE, WINDOWPLACEMENT,
                WS_EX_TOOLWINDOW, WS_EX_TRANSPARENT,
            },
        },
    };

    /// Largest window we copy (GDI bitmaps beyond this get unreliable).
    const MAX_WINDOW_SIDE: u32 = 16384;

    /// HWNDs are 32-bit values sign-extended on 64-bit Windows, so they round-trip through `u32`.
    fn hwnd_to_id(h: HWND) -> u32 {
        h.0 as isize as u32
    }

    fn id_to_hwnd(id: u32) -> HWND {
        HWND(id as i32 as isize as *mut c_void)
    }

    fn wide_to_string(buf: &[u16]) -> String {
        let end = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
        String::from_utf16_lossy(&buf[..end])
    }

    /// All top-level windows in z-order, topmost first.
    fn top_level_windows() -> Vec<HWND> {
        unsafe extern "system" fn collect(h: HWND, l: LPARAM) -> BOOL {
            // SAFETY: `l` is the `&mut Vec<HWND>` passed below; EnumWindows calls back synchronously.
            unsafe { (*(l.0 as *mut Vec<HWND>)).push(h) };
            BOOL(1)
        }
        let mut out: Vec<HWND> = Vec::new();
        // SAFETY: the callback only touches `out`, which outlives the call.
        let _ = unsafe { EnumWindows(Some(collect), LPARAM(&mut out as *mut Vec<HWND> as isize)) };
        out
    }

    /// pid → exe name from a Toolhelp snapshot (opens no process handles).
    fn process_names() -> HashMap<u32, String> {
        let mut map = HashMap::new();
        // SAFETY: plain Win32 calls with a correctly sized PROCESSENTRY32W; the snapshot handle is closed.
        unsafe {
            let Ok(snap) = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) else { return map };
            let mut e = PROCESSENTRY32W { dwSize: size_of::<PROCESSENTRY32W>() as u32, ..Default::default() };
            if Process32FirstW(snap, &mut e).is_ok() {
                loop {
                    map.insert(e.th32ProcessID, wide_to_string(&e.szExeFile));
                    if Process32NextW(snap, &mut e).is_err() {
                        break;
                    }
                }
            }
            let _ = CloseHandle(snap);
        }
        map
    }

    fn pid_of(h: HWND) -> u32 {
        let mut pid = 0u32;
        // SAFETY: valid out-pointer.
        unsafe { GetWindowThreadProcessId(h, Some(&mut pid)) };
        pid
    }

    fn is_cloaked(h: HWND) -> bool {
        let mut cloaked = 0u32;
        // SAFETY: out-pointer and size match a DWORD.
        let ok = unsafe {
            DwmGetWindowAttribute(h, DWMWA_CLOAKED, &mut cloaked as *mut u32 as *mut c_void, size_of::<u32>() as u32)
        };
        ok.is_ok() && cloaked != 0
    }

    fn ex_style(h: HWND) -> u32 {
        // SAFETY: reads a window long; no message is sent.
        unsafe { GetWindowLongW(h, GWL_EXSTYLE) as u32 }
    }

    fn rect_of(r: RECT) -> Option<ScreenRect> {
        let (w, h) = (r.right.checked_sub(r.left)?, r.bottom.checked_sub(r.top)?);
        (w > 0 && h > 0).then_some(ScreenRect { x: r.left, y: r.top, w: w as u32, h: h as u32 })
    }

    /// Visible frame in physical pixels (DWM bounds exclude the invisible resize border / shadow).
    fn frame_bounds(h: HWND) -> Option<ScreenRect> {
        let mut r = RECT::default();
        // SAFETY: out-pointer and size match a RECT.
        let dwm = unsafe {
            DwmGetWindowAttribute(
                h,
                DWMWA_EXTENDED_FRAME_BOUNDS,
                &mut r as *mut RECT as *mut c_void,
                size_of::<RECT>() as u32,
            )
        };
        // SAFETY: valid out-pointer.
        if dwm.is_err() && unsafe { GetWindowRect(h, &mut r) }.is_err() {
            return None;
        }
        rect_of(r)
    }

    fn restored_size(h: HWND) -> Option<(u32, u32)> {
        let mut p = WINDOWPLACEMENT { length: size_of::<WINDOWPLACEMENT>() as u32, ..Default::default() };
        // SAFETY: `length` is set as the API requires.
        unsafe { GetWindowPlacement(h, &mut p) }.ok()?;
        rect_of(p.rcNormalPosition).map(|r| (r.w, r.h))
    }

    /// Reads the caption the window manager stores. For other processes' windows GetWindowTextW does not send
    /// the window a message (documented behaviour); our own windows are filtered out before this is called.
    fn title_of(h: HWND) -> String {
        let mut buf = [0u16; 512];
        // SAFETY: buffer length is passed by the wrapper.
        let n = unsafe { GetWindowTextW(h, &mut buf) };
        wide_to_string(&buf[..n.max(0) as usize])
    }

    fn class_of(h: HWND) -> String {
        let mut buf = [0u16; 256];
        // SAFETY: buffer length is passed by the wrapper.
        let n = unsafe { GetClassNameW(h, &mut buf) };
        wide_to_string(&buf[..n.max(0) as usize])
    }

    /// Shown to the user: visible, uncloaked, not a tool window, has a title, isn't ours or the desktop.
    fn is_listable(h: HWND, me: u32) -> bool {
        // SAFETY: read-only window-manager query.
        let visible = unsafe { IsWindowVisible(h).as_bool() };
        visible
            && ex_style(h) & WS_EX_TOOLWINDOW.0 == 0
            && !is_cloaked(h)
            && pid_of(h) != me
            && !matches!(class_of(h).as_str(), "Progman" | "WorkerW" | "Shell_TrayWnd")
    }

    pub fn list_windows() -> Result<Vec<WindowInfo>, String> {
        let me = std::process::id();
        let exes = process_names();
        Ok(top_level_windows()
            .into_iter()
            .filter(|&h| is_listable(h, me))
            .filter_map(|h| {
                let title = title_of(h);
                if title.trim().is_empty() {
                    return None;
                }
                // SAFETY: read-only query.
                let minimized = unsafe { IsIconic(h).as_bool() };
                let (width, height) =
                    if minimized { restored_size(h)? } else { frame_bounds(h).map(|r| (r.w, r.h))? };
                Some(WindowInfo {
                    id: hwnd_to_id(h),
                    title,
                    app: exes.get(&pid_of(h)).cloned().unwrap_or_default(),
                    width,
                    height,
                    minimized,
                })
            })
            .collect())
    }

    /// The picked window and its on-screen frame, or a message the UI can show as is.
    fn target(id: u32) -> Result<(HWND, ScreenRect), String> {
        let h = id_to_hwnd(id);
        // SAFETY: read-only queries on a handle that may be stale; IsWindow guards the rest.
        unsafe {
            if id == 0 || !IsWindow(Some(h)).as_bool() {
                return Err("That window has closed — pick it again".into());
            }
            if pid_of(h) == std::process::id() {
                return Err("Pick the game window, not Maple Classic Companion".into());
            }
            if IsIconic(h).as_bool() {
                return Err("The window is minimised — restore it first".into());
            }
            if !IsWindowVisible(h).as_bool() || is_cloaked(h) {
                return Err("The window is hidden (or on another virtual desktop)".into());
            }
        }
        let r = frame_bounds(h).ok_or("Can't get the window's position")?;
        if r.w > MAX_WINDOW_SIDE || r.h > MAX_WINDOW_SIDE {
            return Err("The window is too large to read".into());
        }
        Ok((h, r))
    }

    pub fn bounds(id: u32) -> Result<ScreenRect, String> {
        target(id).map(|(_, r)| r)
    }

    /// Frames of the windows stacked above `target` that would hide its pixels in a screen copy.
    fn windows_above(target: HWND) -> Vec<ScreenRect> {
        top_level_windows()
            .into_iter()
            .take_while(|&h| h != target)
            .filter(|&h| {
                // SAFETY: read-only queries.
                let shown = unsafe { IsWindowVisible(h).as_bool() && !IsIconic(h).as_bool() };
                shown
                    && ex_style(h) & WS_EX_TRANSPARENT.0 == 0 // click-through overlays (e.g. GPU overlays)
                    && !is_cloaked(h)
            })
            .filter_map(frame_bounds)
            .collect()
    }

    fn on_some_monitor(x: i32, y: i32) -> bool {
        // SAFETY: pure geometry query.
        !unsafe { MonitorFromPoint(POINT { x, y }, MONITOR_DEFAULTTONULL) }.is_invalid()
    }

    fn is_covered(r: ScreenRect, above: &[ScreenRect]) -> bool {
        let (x2, y2) = (r.x + r.w as i32 - 1, r.y + r.h as i32 - 1);
        let off_screen = [(r.x, r.y), (x2, r.y), (r.x, y2), (x2, y2)].iter().any(|&(x, y)| !on_some_monitor(x, y));
        off_screen || above.iter().any(|a| a.intersects(&r))
    }

    /// Copies a screen rectangle (BGRA, top-down, alpha forced to 255).
    fn capture(r: ScreenRect) -> Result<Vec<u8>, String> {
        let (w, h) = (r.w as i32, r.h as i32);
        let len = r.w as usize * r.h as usize * BPP;
        // SAFETY: every GDI object created here is released before returning; `bits` is valid for `len`
        // bytes while the DIB section is alive and is copied out before DeleteObject.
        unsafe {
            let screen = GetDC(None);
            if screen.is_invalid() {
                return Err("Can't read the screen".into());
            }
            let mem = CreateCompatibleDC(Some(screen));
            let info = BITMAPINFO {
                bmiHeader: BITMAPINFOHEADER {
                    biSize: size_of::<BITMAPINFOHEADER>() as u32,
                    biWidth: w,
                    biHeight: -h, // top-down rows
                    biPlanes: 1,
                    biBitCount: 32,
                    biCompression: BI_RGB.0,
                    ..Default::default()
                },
                ..Default::default()
            };
            let mut bits: *mut c_void = std::ptr::null_mut();
            let result = match CreateDIBSection(Some(screen), &info, DIB_RGB_COLORS, &mut bits, None, 0) {
                Ok(dib) if !bits.is_null() => {
                    let old = SelectObject(mem, dib.into());
                    let blt = BitBlt(mem, 0, 0, w, h, Some(screen), r.x, r.y, SRCCOPY);
                    SelectObject(mem, old);
                    let out = blt.map_err(|e| format!("Screen copy failed: {e}")).map(|_| {
                        let _ = GdiFlush();
                        let mut px = std::slice::from_raw_parts(bits as *const u8, len).to_vec();
                        for p in px.chunks_exact_mut(BPP) {
                            p[3] = 255;
                        }
                        px
                    });
                    let _ = DeleteObject(dib.into());
                    out
                }
                Ok(dib) => {
                    let _ = DeleteObject(dib.into());
                    Err("Can't allocate the screen copy".into())
                }
                Err(e) => Err(format!("Can't allocate the screen copy: {e}")),
            };
            let _ = DeleteDC(mem);
            ReleaseDC(None, screen);
            result
        }
    }

    pub fn snapshot(id: u32) -> Result<Snapshot, String> {
        let (h, win) = target(id)?;
        let covered = is_covered(win, &windows_above(h));
        let frame = capture(win)?;
        let (nw, nh) = fit_long_edge(win.w, win.h, SNAPSHOT_LONG_EDGE);
        let small = resize(&frame, win.w, win.h, nw, nh);
        drop(frame);
        let png = encode_png_rgb(&bgra_to_rgb(&small), nw, nh)?;
        Ok(Snapshot {
            png_base64: STANDARD.encode(png),
            width: nw,
            height: nh,
            source_width: win.w,
            source_height: win.h,
            covered,
        })
    }

    // ---- OCR (Windows.Media.Ocr, offline) ----

    static ENGINE: Mutex<Option<OcrEngine>> = Mutex::new(None);

    fn create_engine() -> Result<OcrEngine, String> {
        OcrEngine::TryCreateFromUserProfileLanguages()
            .or_else(|_| OcrEngine::TryCreateFromLanguage(&Language::CreateLanguage(&HSTRING::from("en-US"))?))
            .map_err(|_| {
                "Windows text recognition isn't available. Add English under Settings > Time & Language > \
                 Language, then try again."
                    .to_string()
            })
    }

    /// Runs `f` with the cached engine; also serialises OCR calls.
    pub fn with_engine<T>(f: impl FnOnce(&OcrEngine) -> Result<T, String>) -> Result<T, String> {
        let mut guard = ENGINE.lock().unwrap_or_else(|p| p.into_inner());
        if guard.is_none() {
            *guard = Some(create_engine()?);
        }
        f(guard.as_ref().expect("engine was just created"))
    }

    pub fn max_dim() -> u32 {
        OcrEngine::MaxImageDimension().unwrap_or(4096)
    }

    /// Lines with word boxes `(x, y, w, h)` in the pixels of the image given.
    pub fn recognize(engine: &OcrEngine, bgra: &[u8], w: u32, h: u32) -> Result<Vec<(String, Vec<BoxF>)>, String> {
        let run = || -> windows::core::Result<Vec<(String, Vec<BoxF>)>> {
            let writer = DataWriter::new()?;
            writer.WriteBytes(bgra)?;
            let buffer = writer.DetachBuffer()?;
            let bitmap = SoftwareBitmap::CreateCopyFromBuffer(&buffer, BitmapPixelFormat::Bgra8, w as i32, h as i32)?;
            let result = engine.RecognizeAsync(&bitmap)?.join()?;
            let _ = bitmap.Close();
            let mut out = Vec::new();
            for line in result.Lines()? {
                let mut words = Vec::new();
                for word in line.Words()? {
                    let b = word.BoundingRect()?;
                    words.push((b.X, b.Y, b.Width, b.Height));
                }
                out.push((line.Text()?.to_string_lossy(), words));
            }
            Ok(out)
        };
        run().map_err(|e| format!("Text recognition failed: {}", e.message()))
    }

    /// OCR of one BGRA region buffer (`w`×`h`, region pixels): pad with background, upscale, recognise.
    pub fn ocr_region(
        engine: &OcrEngine,
        px: &[u8],
        (w, h): (u32, u32),
        scale: f64,
        filter: Filter,
        max: u32,
    ) -> Result<Vec<OcrLine>, String> {
        let padded = pad_with_background(px, w, h, OCR_PAD);
        let (pw, ph) = (w + 2 * OCR_PAD, h + 2 * OCR_PAD);
        let (nw, nh) = ocr_size(pw, ph, scale, max);
        let scaled = match filter {
            Filter::Nearest if nw >= pw => resize_nearest(&padded, pw, ph, nw, nh),
            _ => resize(&padded, pw, ph, nw, nh),
        };
        drop(padded);
        let (sx, sy) = (nw as f32 / pw as f32, nh as f32 / ph as f32);
        Ok(recognize(engine, &scaled, nw, nh)?
            .into_iter()
            .map(|(text, words)| {
                let (x, y, lw, lh) = line_box(&words, sx, sy, OCR_PAD as f32, w, h);
                OcrLine { text, x, y, w: lw, h: lh }
            })
            .collect())
    }

    pub fn read(id: u32, regions: &[Region]) -> Result<Vec<RegionText>, String> {
        if regions.is_empty() {
            return Ok(Vec::new());
        }
        let (h, win) = target(id)?;
        let checked = check_regions(regions, win.w, win.h)?;
        let rects: Vec<PxRect> = checked.iter().map(|(r, _)| *r).collect();
        let b = bounding(&rects).expect("regions is not empty");
        let above = windows_above(h);
        // One copy of the area the regions span; dropped when this function returns.
        let frame = capture(win.offset(b))?;
        let max = max_dim();
        with_engine(|engine| {
            regions
                .iter()
                .zip(&checked)
                .map(|(region, &(r, scale))| {
                    let local = PxRect { x: r.x - b.x, y: r.y - b.y, w: r.w, h: r.h };
                    let px = crop(&frame, b.w, local);
                    let covered = is_covered(win.offset(r), &above);
                    if region.mode == Mode::Bar {
                        return Ok(RegionText { name: region.name.clone(), lines: Vec::new(), covered, fill: bar_fill(&px, r.w, r.h) });
                    }
                    let lines = ocr_region(engine, &px, (r.w, r.h), scale, region.filter, max)?;
                    let fill = if region.mode == Mode::Both { bar_fill_lower(&px, r.w, r.h) } else { None };
                    Ok(RegionText { name: region.name.clone(), lines, covered, fill })
                })
                .collect()
        })
    }
}

#[cfg(not(windows))]
mod win {
    use super::*;
    const UNSUPPORTED: &str = "Screen reading is only available on Windows";
    pub fn list_windows() -> Result<Vec<WindowInfo>, String> {
        Err(UNSUPPORTED.into())
    }
    pub fn bounds(_: u32) -> Result<ScreenRect, String> {
        Err(UNSUPPORTED.into())
    }
    pub fn snapshot(_: u32) -> Result<Snapshot, String> {
        Err(UNSUPPORTED.into())
    }
    pub fn read(_: u32, _: &[Region]) -> Result<Vec<RegionText>, String> {
        Err(UNSUPPORTED.into())
    }
}

// ---------------------------------------------------------------------------------------------------------------
// Commands — all async so capture/OCR run off the main (UI) thread.
// ---------------------------------------------------------------------------------------------------------------

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| format!("Screen task failed: {e}"))?
}

#[tauri::command]
pub async fn screen_list_windows() -> Result<Vec<WindowInfo>, String> {
    blocking(win::list_windows).await
}

/// One-off setup snapshot. Our own windows that overlap the game are hidden for the copy, then shown again.
#[tauri::command]
pub async fn screen_snapshot(
    app: tauri::AppHandle,
    caller: tauri::WebviewWindow,
    window_id: u32,
) -> Result<Snapshot, String> {
    use tauri::Manager;
    let target = blocking(move || win::bounds(window_id)).await?;
    let overlapping: Vec<_> = app
        .webview_windows()
        .into_values()
        .filter(|w| {
            let shown = w.is_visible().unwrap_or(false) && !w.is_minimized().unwrap_or(true);
            let rect = match (w.outer_position(), w.outer_size()) {
                (Ok(p), Ok(s)) => ScreenRect { x: p.x, y: p.y, w: s.width, h: s.height },
                _ => return false,
            };
            shown && rect.intersects(&target)
        })
        .collect();
    for w in &overlapping {
        let _ = w.hide();
    }
    let wait = !overlapping.is_empty();
    let result = blocking(move || {
        if wait {
            // Let DWM finish the hide animation before copying the screen.
            std::thread::sleep(std::time::Duration::from_millis(350));
        }
        win::snapshot(window_id)
    })
    .await;
    for w in &overlapping {
        let _ = w.show();
    }
    if wait {
        let _ = caller.set_focus();
    }
    result
}

#[tauri::command]
pub async fn screen_read(window_id: u32, regions: Vec<Region>) -> Result<Vec<RegionText>, String> {
    blocking(move || win::read(window_id, &regions)).await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn region(name: &str, x: f64, y: f64, w: f64, h: f64) -> Region {
        Region { name: name.into(), x, y, w, h, scale: None, filter: Filter::Bilinear, mode: Mode::Ocr }
    }

    /// BGRA image where pixel (x, y) = [x, y, x + y, 255] (mod 256).
    fn ramp(w: u32, h: u32) -> Vec<u8> {
        (0..h).flat_map(|y| (0..w).flat_map(move |x| [x as u8, y as u8, (x + y) as u8, 255])).collect()
    }

    #[test]
    fn scale_defaults_to_2_and_is_bounded() {
        assert_eq!(check_scale(None), Ok(2.0));
        assert_eq!(check_scale(Some(1.0)), Ok(1.0));
        assert_eq!(check_scale(Some(4.0)), Ok(4.0));
        assert!(check_scale(Some(0.5)).is_err());
        assert!(check_scale(Some(4.01)).is_err());
        assert!(check_scale(Some(f64::NAN)).is_err());
    }

    #[test]
    fn regions_must_fit_the_window_and_the_size_limit() {
        assert_eq!(
            check_region(&region("exp", 10.4, 20.6, 100.0, 30.0), 800, 600),
            Ok(PxRect { x: 10, y: 21, w: 100, h: 30 })
        );
        assert!(check_region(&region("edge", 700.0, 570.0, 100.0, 30.0), 800, 600).is_ok());
        assert!(check_region(&region("out", 701.0, 0.0, 100.0, 30.0), 800, 600).is_err());
        assert!(check_region(&region("below", 0.0, 571.0, 100.0, 30.0), 800, 600).is_err());
        assert!(check_region(&region("neg", -1.0, 0.0, 10.0, 10.0), 800, 600).is_err());
        assert!(check_region(&region("empty", 0.0, 0.0, 0.2, 10.0), 800, 600).is_err());
        assert!(check_region(&region("inf", f64::INFINITY, 0.0, 10.0, 10.0), 800, 600).is_err());
        assert!(check_region(&region("huge", 0.0, 0.0, 4001.0, 10.0), 5000, 5000).is_err());
        assert!(check_region(&region("max", 0.0, 0.0, 4000.0, 4000.0), 5000, 5000).is_ok());
        assert!(check_region(&region(" ", 0.0, 0.0, 10.0, 10.0), 800, 600).is_err());
        assert!(check_region(&region(&"n".repeat(65), 0.0, 0.0, 10.0, 10.0), 800, 600).is_err());
    }

    #[test]
    fn region_lists_reject_duplicates_and_too_many() {
        let two = [region("a", 0.0, 0.0, 5.0, 5.0), region("a", 5.0, 5.0, 5.0, 5.0)];
        assert!(check_regions(&two, 100, 100).unwrap_err().contains("twice"));
        let many: Vec<_> = (0..=MAX_REGIONS).map(|i| region(&format!("r{i}"), 0.0, 0.0, 5.0, 5.0)).collect();
        assert!(check_regions(&many, 100, 100).is_err());
        let mut ok = [region("a", 0.0, 0.0, 5.0, 5.0), region("b", 1.0, 1.0, 5.0, 5.0)];
        ok[1].scale = Some(3.0);
        let checked = check_regions(&ok, 100, 100).unwrap();
        assert_eq!(checked[0].1, 2.0);
        assert_eq!(checked[1].1, 3.0);
    }

    #[test]
    fn bounding_box_spans_all_regions() {
        assert_eq!(bounding(&[]), None);
        let a = PxRect { x: 10, y: 500, w: 300, h: 20 };
        let b = PxRect { x: 5, y: 300, w: 200, h: 150 };
        assert_eq!(bounding(&[a]), Some(a));
        assert_eq!(bounding(&[a, b]), Some(PxRect { x: 5, y: 300, w: 305, h: 220 }));
    }

    #[test]
    fn bar_fill_measures_a_half_full_bar_and_ignores_flat_boxes() {
        let (w, h) = (200u32, 10u32);
        let mut px = vec![0u8; (w * h) as usize * BPP];
        for y in 0..h {
            for x in 0..w {
                let i = ((y * w + x) as usize) * BPP;
                let filled = x < 85; // 42.5 %
                let (b, g, r) = if filled { (40u8, 200u8, 255u8) } else { (30u8, 30u8, 30u8) }; // yellow on dark
                px[i] = b;
                px[i + 1] = g;
                px[i + 2] = r;
                px[i + 3] = 255;
            }
        }
        let fill = bar_fill(&px, w, h).unwrap();
        assert!((fill - 0.425).abs() < 0.02, "{fill}");
        // Text pixels over the empty part don't move the edge.
        for x in 120..140 {
            let i = ((5 * w + x) as usize) * BPP;
            px[i + 2] = 255;
        }
        let fill2 = bar_fill(&px, w, h).unwrap();
        assert!((fill2 - 0.425).abs() < 0.02, "{fill2}");
        let flat = vec![30u8; (w * h) as usize * BPP];
        assert_eq!(bar_fill(&flat, w, h), None);
    }

    #[test]
    fn crop_copies_the_right_pixels() {
        let img = ramp(8, 6);
        let out = crop(&img, 8, PxRect { x: 2, y: 3, w: 3, h: 2 });
        assert_eq!(out.len(), 3 * 2 * 4);
        assert_eq!(&out[0..4], &[2, 3, 5, 255]);
        assert_eq!(&out[8..12], &[4, 3, 7, 255]);
        assert_eq!(&out[12..16], &[2, 4, 6, 255]);
    }

    #[test]
    fn ocr_size_scales_and_respects_the_engine_limit() {
        assert_eq!(ocr_size(300, 40, 2.0, 10000), (600, 80));
        assert_eq!(ocr_size(300, 40, 1.5, 10000), (450, 60));
        assert_eq!(ocr_size(4000, 100, 4.0, 10000), (10000, 250));
        assert_eq!(ocr_size(4000, 4000, 2.0, 2600), (2600, 2600));
    }

    #[test]
    fn long_edge_fit_never_upscales() {
        assert_eq!(fit_long_edge(1280, 720, 1600), (1280, 720));
        assert_eq!(fit_long_edge(5120, 1440, 1600), (1600, 450));
        assert_eq!(fit_long_edge(1080, 1920, 1600), (900, 1600));
        assert_eq!(fit_long_edge(1600, 1600, 1600), (1600, 1600));
    }

    #[test]
    fn resize_upscale_keeps_corners_and_interpolates() {
        let img = ramp(2, 2); // (0,0)=[0,0,0] (1,0)=[1,0,1] (0,1)=[0,1,1] (1,1)=[1,1,2]
        let big = resize(&img, 2, 2, 4, 4);
        assert_eq!(big.len(), 4 * 4 * 4);
        assert_eq!(&big[0..4], &img[0..4]); // top-left stays
        assert_eq!(&big[(15 * 4)..(16 * 4)], &img[12..16]); // bottom-right stays
        assert!(big.chunks_exact(4).all(|p| p[3] == 255));
        // A 2x nearest-ish check on a solid image: unchanged colour.
        let solid: Vec<u8> = [9u8, 8, 7, 255].repeat(3 * 2);
        assert!(resize(&solid, 3, 2, 9, 6).chunks_exact(4).all(|p| p == [9, 8, 7, 255]));
    }

    #[test]
    fn resize_downscale_averages_blocks() {
        // 4x2 → 2x1: each output pixel averages a 2x2 block.
        let mut img = Vec::new();
        for v in [0u8, 100, 200, 250, 50, 150, 210, 230] {
            img.extend_from_slice(&[v, v, v, 255]);
        }
        let small = resize(&img, 4, 2, 2, 1);
        assert_eq!(small, vec![75, 75, 75, 255, 223, 223, 223, 255]);
        assert_eq!(resize(&img, 4, 2, 4, 2), img);
    }

    #[test]
    fn bgra_converts_to_rgb_and_png_encodes() {
        assert_eq!(bgra_to_rgb(&[1, 2, 3, 255, 4, 5, 6, 0]), vec![3, 2, 1, 6, 5, 4]);
        let png = encode_png_rgb(&[255, 0, 0].repeat(6), 3, 2).unwrap();
        assert!(png.starts_with(&[0x89, b'P', b'N', b'G']));
        let decoder = png::Decoder::new(std::io::Cursor::new(png));
        let reader = decoder.read_info().unwrap();
        assert_eq!((reader.info().width, reader.info().height), (3, 2));
    }

    #[test]
    fn nearest_resize_repeats_pixels() {
        let img = ramp(2, 1);
        let row = [&img[0..4], &img[0..4], &img[4..8], &img[4..8]].concat();
        assert_eq!(resize_nearest(&img, 2, 1, 4, 2), row.repeat(2));
    }

    #[test]
    fn padding_uses_the_background_colour() {
        // 3x3 dark background with one bright "text" pixel touching the right edge.
        let mut img = [10u8, 20, 30, 255].repeat(9);
        img[(3 + 2) * 4..(3 + 2) * 4 + 4].copy_from_slice(&[250, 250, 250, 255]);
        let out = pad_with_background(&img, 3, 3, 2);
        let at = |x: usize, y: usize| &out[(y * 7 + x) * 4..(y * 7 + x) * 4 + 4];
        assert_eq!(out.len(), 7 * 7 * 4);
        assert_eq!(at(0, 0), &[10, 20, 30, 255]); // border = median edge colour, not the bright pixel
        assert_eq!(at(6, 3), &[10, 20, 30, 255]); // right of the bright pixel: not smeared outwards
        assert_eq!(at(4, 3), &[250, 250, 250, 255]); // original pixels kept in place
        assert_eq!(at(2, 2), &[10, 20, 30, 255]);
    }

    #[test]
    fn line_boxes_union_words_and_undo_scale_and_padding() {
        let words = [(52.0, 42.0, 40.0, 16.0), (102.0, 40.0, 30.0, 20.0)];
        // scale 2, pad 16: x 52/2-16 = 10, y 40/2-16 = 4, right 132/2-16 = 50, bottom 60/2-16 = 14.
        assert_eq!(line_box(&words, 2.0, 2.0, 16.0, 300, 30), (10.0, 4.0, 40.0, 10.0));
        // Boxes reaching into the border are clamped to the region.
        assert_eq!(line_box(&[(0.0, 0.0, 700.0, 100.0)], 2.0, 2.0, 16.0, 300, 30), (0.0, 0.0, 300.0, 30.0));
        assert_eq!(line_box(&[], 2.0, 2.0, 16.0, 300, 30), (0.0, 0.0, 0.0, 0.0));
    }

    #[test]
    fn screen_rects_intersect_only_when_overlapping() {
        let a = ScreenRect { x: 0, y: 0, w: 100, h: 100 };
        assert!(a.intersects(&ScreenRect { x: 99, y: 99, w: 10, h: 10 }));
        assert!(!a.intersects(&ScreenRect { x: 100, y: 0, w: 10, h: 10 }));
        assert!(a.intersects(&ScreenRect { x: -5, y: -5, w: 10, h: 10 }));
        assert!(!a.intersects(&ScreenRect { x: -10, y: 0, w: 10, h: 10 }));
        assert_eq!(a.offset(PxRect { x: 5, y: 6, w: 7, h: 8 }), ScreenRect { x: 5, y: 6, w: 7, h: 8 });
    }

    #[test]
    fn region_json_matches_the_ts_shape() {
        let r: Region = serde_json::from_str(r#"{"name":"exp","x":1,"y":2.5,"w":3,"h":4}"#).unwrap();
        assert_eq!((r.name.as_str(), r.y, r.scale, r.filter), ("exp", 2.5, None, Filter::Bilinear));
        let r: Region =
            serde_json::from_str(r#"{"name":"c","x":1,"y":2,"w":3,"h":4,"scale":3,"filter":"nearest"}"#).unwrap();
        assert_eq!((r.scale, r.filter), (Some(3.0), Filter::Nearest));
        assert!(serde_json::from_str::<Region>(r#"{"name":"c","x":1,"y":2,"w":3,"h":4,"filter":"cubic"}"#).is_err());
        let t = RegionText {
            name: "exp".into(),
            lines: vec![OcrLine { text: "EXP".into(), x: 1.0, y: 2.0, w: 3.0, h: 4.0 }],
            covered: false,
            fill: None,
        };
        assert_eq!(
            serde_json::to_string(&t).unwrap(),
            r#"{"name":"exp","lines":[{"text":"EXP","x":1.0,"y":2.0,"w":3.0,"h":4.0}],"covered":false}"#
        );
    }

    /// Manual: `cargo test --manifest-path src-tauri/Cargo.toml ocr_ -- --ignored --nocapture`.
    /// Renders known text with GDI into memory, then runs the same OCR path `screen_read` uses.
    #[cfg(windows)]
    #[test]
    #[ignore]
    fn ocr_reads_rendered_text() {
        let (w, h) = (300u32, 24u32);
        let style = gdi_text::Style { px: 15, fg: 0x00FF_FFFF, bg: 30, aa: true, x: 4, y: 4 };
        let px = gdi_text::render_styled("You have gained experience (+512)", w, h, &style);
        let max = win::max_dim();
        let start = std::time::Instant::now();
        let lines = win::with_engine(|e| win::ocr_region(e, &px, (w, h), 2.0, Filter::Bilinear, max)).unwrap();
        let cold = start.elapsed();
        let start = std::time::Instant::now();
        let again = win::with_engine(|e| win::ocr_region(e, &px, (w, h), 2.0, Filter::Bilinear, max)).unwrap();
        println!("lines: {lines:?}\ncold (incl. engine start): {cold:?}, warm: {:?}", start.elapsed());
        assert_eq!(lines, again);
        assert_eq!(lines.len(), 1, "{lines:?}");
        let l = &lines[0];
        assert_eq!(l.text, "You have gained experience (+512)");
        assert!(l.x >= 2.0 && l.x <= 8.0 && l.y >= 2.0 && l.y <= 10.0, "{l:?}");
        assert!(l.x + l.w <= w as f32 && l.y + l.h <= h as f32 && l.w > 150.0, "{l:?}");
    }

    /// Manual accuracy report for tuning: exact-match rate of the production OCR path on rendered UI-like text.
    #[cfg(windows)]
    #[test]
    #[ignore]
    fn ocr_sample_report() {
        use gdi_text::Style;
        let texts = [
            "EXP 1234 [12.34%]",
            "EXP 1234",
            "1234 12.34",
            "MESO 123,456",
            "You have gained experience (+512)",
            "Lv. 23",
            "12.34%",
            "You have acquired Snail Shell.",
        ];
        let styles = [
            ("13px smooth, light on dark, tight", Style { px: 13, fg: 0x00FF_FFFF, bg: 30, aa: true, x: 2, y: 2 }, 19),
            ("13px smooth, light on dark, loose", Style { px: 13, fg: 0x00FF_FFFF, bg: 30, aa: true, x: 6, y: 8 }, 32),
            ("12px pixel, light on dark, tight", Style { px: 12, fg: 0x00FF_FFFF, bg: 30, aa: false, x: 2, y: 2 }, 18),
            ("12px pixel, dark on light, tight", Style { px: 12, fg: 0, bg: 235, aa: false, x: 2, y: 2 }, 18),
        ];
        let max = win::max_dim();
        for filter in [Filter::Bilinear, Filter::Nearest] {
            for scale in [2.0, 3.0] {
                let mut total = 0;
                for (label, style, h) in &styles {
                    let mut misses = Vec::new();
                    for text in texts {
                        let px = gdi_text::render_styled(text, 300, *h, style);
                        let lines =
                            win::with_engine(|e| win::ocr_region(e, &px, (300, *h), scale, filter, max)).unwrap();
                        let got = lines.iter().map(|l| l.text.as_str()).collect::<Vec<_>>().join(" | ");
                        if got == text {
                            total += 1;
                        } else {
                            misses.push(format!("{got:?}"));
                        }
                    }
                    println!("  {filter:?} x{scale} {label}: misses {}", misses.join(", "));
                }
                println!("{filter:?} x{scale}: {total}/{} exact", texts.len() * styles.len());
            }
        }
    }

    /// Manual timing on this PC: lists windows, then reads two small regions of the first sizeable one.
    /// Prints sizes, timings and counts only (no window titles or recognised text).
    /// `cargo test --manifest-path src-tauri/Cargo.toml screen_read_timing -- --ignored --nocapture`
    #[cfg(windows)]
    #[test]
    #[ignore]
    fn screen_read_timing() {
        let t = std::time::Instant::now();
        let windows = win::list_windows().unwrap();
        println!("list_windows: {} windows in {:?}", windows.len(), t.elapsed());
        let target = windows.iter().find(|w| !w.minimized && w.width >= 600 && w.height >= 400).expect("a window");
        let regions = vec![
            Region { name: "exp".into(), x: 20.0, y: 0.0, w: 300.0, h: 30.0, scale: None, filter: Filter::Bilinear, mode: Mode::Ocr },
            Region {
                name: "chat".into(),
                x: 20.0,
                y: 200.0,
                w: 400.0,
                h: 150.0,
                scale: None,
                filter: Filter::Bilinear,
                mode: Mode::Ocr,
            },
        ];
        for round in 0..4 {
            let t = std::time::Instant::now();
            let out = win::read(target.id, &regions).unwrap();
            let counts: Vec<_> = out.iter().map(|r| (r.lines.len(), r.covered)).collect();
            println!(
                "read #{round} ({}x{} window, regions 300x30 + 400x150): {:?}; (lines, covered) {counts:?}",
                target.width,
                target.height,
                t.elapsed()
            );
        }
        let t = std::time::Instant::now();
        let snap = win::snapshot(target.id).unwrap();
        println!(
            "snapshot {}x{} from {}x{} ({} KB base64, covered={}) in {:?}",
            snap.width,
            snap.height,
            snap.source_width,
            snap.source_height,
            snap.png_base64.len() / 1024,
            snap.covered,
            t.elapsed()
        );
    }

    /// Test-only: draws text with GDI into memory and returns BGRA pixels.
    #[cfg(windows)]
    mod gdi_text {
        use std::{ffi::c_void, mem::size_of};
        use windows::{
            core::w,
            Win32::{
                Foundation::COLORREF,
                Graphics::Gdi::{
                    CreateCompatibleDC, CreateDIBSection, CreateFontW, DeleteDC, DeleteObject, GdiFlush, SelectObject,
                    SetBkMode, SetTextColor, TextOutW, BITMAPINFO, BITMAPINFOHEADER, BI_RGB, CLEARTYPE_QUALITY,
                    CLIP_DEFAULT_PRECIS, DEFAULT_CHARSET, DIB_RGB_COLORS, NONANTIALIASED_QUALITY, OUT_DEFAULT_PRECIS,
                    TRANSPARENT,
                },
            },
        };

        /// Font height `px` (Arial), text colour `fg` (0x00BBGGRR), grey background `bg`, smooth or pixel
        /// glyphs, drawn at (`x`, `y`).
        pub struct Style {
            pub px: i32,
            pub fg: u32,
            pub bg: u8,
            pub aa: bool,
            pub x: i32,
            pub y: i32,
        }

        pub fn render_styled(text: &str, w: u32, h: u32, st: &Style) -> Vec<u8> {
            let len = (w * h * 4) as usize;
            // SAFETY: test helper; all GDI objects are released and `bits` is copied out while valid.
            unsafe {
                let dc = CreateCompatibleDC(None);
                let info = BITMAPINFO {
                    bmiHeader: BITMAPINFOHEADER {
                        biSize: size_of::<BITMAPINFOHEADER>() as u32,
                        biWidth: w as i32,
                        biHeight: -(h as i32),
                        biPlanes: 1,
                        biBitCount: 32,
                        biCompression: BI_RGB.0,
                        ..Default::default()
                    },
                    ..Default::default()
                };
                let mut bits: *mut c_void = std::ptr::null_mut();
                let dib = CreateDIBSection(Some(dc), &info, DIB_RGB_COLORS, &mut bits, None, 0).unwrap();
                std::slice::from_raw_parts_mut(bits as *mut u8, len).fill(st.bg);
                let old_bmp = SelectObject(dc, dib.into());
                let font = CreateFontW(
                    -st.px,
                    0,
                    0,
                    0,
                    400,
                    0,
                    0,
                    0,
                    DEFAULT_CHARSET,
                    OUT_DEFAULT_PRECIS,
                    CLIP_DEFAULT_PRECIS,
                    if st.aa { CLEARTYPE_QUALITY } else { NONANTIALIASED_QUALITY },
                    0,
                    w!("Arial"),
                );
                let old_font = SelectObject(dc, font.into());
                SetBkMode(dc, TRANSPARENT);
                SetTextColor(dc, COLORREF(st.fg));
                let wide: Vec<u16> = text.encode_utf16().collect();
                let _ = TextOutW(dc, st.x, st.y, &wide);
                let _ = GdiFlush();
                let mut px = std::slice::from_raw_parts(bits as *const u8, len).to_vec();
                for p in px.chunks_exact_mut(4) {
                    p[3] = 255;
                }
                SelectObject(dc, old_font);
                SelectObject(dc, old_bmp);
                let _ = DeleteObject(font.into());
                let _ = DeleteObject(dib.into());
                let _ = DeleteDC(dc);
                px
            }
        }
    }
}
