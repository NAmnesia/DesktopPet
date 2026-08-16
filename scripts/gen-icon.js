// 生成应用图标 assets/icon.png（32x32 简易宠物脸，纯 Node 无依赖）
const zlib = require('zlib');
const fs = require('fs');
const path = require('path');

const W = 32, H = 32;

// CRC32（PNG 校验用）
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

// ---- 像素绘制 ----
const px = new Uint8Array(W * H * 4); // RGBA，默认全透明

function setPixel(x, y, r, g, b, a = 255) {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 4;
  // 简单 alpha 混合
  const sa = a / 255, da = px[i + 3] / 255;
  const oa = sa + da * (1 - sa);
  if (oa === 0) return;
  px[i] = Math.round((r * sa + px[i] * da * (1 - sa)) / oa);
  px[i + 1] = Math.round((g * sa + px[i + 1] * da * (1 - sa)) / oa);
  px[i + 2] = Math.round((b * sa + px[i + 2] * da * (1 - sa)) / oa);
  px[i + 3] = Math.round(oa * 255);
}

function fillCircle(cx, cy, r, color, a = 255) {
  for (let y = Math.floor(cy - r) - 1; y <= cy + r + 1; y++) {
    for (let x = Math.floor(cx - r) - 1; x <= cx + r + 1; x++) {
      const d = Math.hypot(x + 0.5 - cx, y + 0.5 - cy);
      if (d <= r - 0.5) setPixel(x, y, ...color, a);
      else if (d < r + 0.5) setPixel(x, y, ...color, Math.round(a * (r + 0.5 - d)));
    }
  }
}

const BODY = [255, 240, 214];   // 奶油色身体
const EDGE = [232, 179, 107];   // 描边
const EYE = [51, 42, 38];       // 眼睛
const BLUSH = [255, 171, 171];  // 腮红
const MOUTH = [51, 42, 38];

// 身体（圆脸）+ 描边
fillCircle(16, 16, 14.2, EDGE);
fillCircle(16, 16, 13.0, BODY);
// 耳朵（两个小圆）
fillCircle(7, 6, 4.5, EDGE);  fillCircle(7, 6.5, 3.4, BODY);
fillCircle(25, 6, 4.5, EDGE); fillCircle(25, 6.5, 3.4, BODY);
// 眼睛
fillCircle(10.5, 14, 2.2, EYE);
fillCircle(21.5, 14, 2.2, EYE);
// 眼睛高光
fillCircle(11.3, 13.2, 0.7, [255, 255, 255]);
fillCircle(22.3, 13.2, 0.7, [255, 255, 255]);
// 腮红
fillCircle(6.5, 19.5, 2.4, BLUSH, 190);
fillCircle(25.5, 19.5, 2.4, BLUSH, 190);
// 嘴（小弧线，用点拼）
for (let dx = -2; dx <= 2; dx++) {
  const dy = Math.round(Math.sqrt(Math.max(0, 4 - dx * dx)) * 0.7);
  setPixel(16 + dx, 19 + dy, ...MOUTH);
  if (dx !== -2 && dx !== 2) setPixel(16 + dx, 20 + dy, ...MOUTH);
}

// ---- 组装 PNG ----
const raw = Buffer.alloc(H * (W * 4 + 1));
for (let y = 0; y < H; y++) {
  raw[y * (W * 4 + 1)] = 0; // filter: None
  Buffer.from(px.buffer, y * W * 4, W * 4).copy(raw, y * (W * 4 + 1) + 1);
}
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(W, 0);
ihdr.writeUInt32BE(H, 4);
ihdr[8] = 8;  // bit depth
ihdr[9] = 6;  // RGBA
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', zlib.deflateSync(raw)),
  chunk('IEND', Buffer.alloc(0)),
]);

const out = path.join(__dirname, '..', 'assets', 'icon.png');
fs.writeFileSync(out, png);
console.log('icon 写入', out, png.length, 'bytes');
