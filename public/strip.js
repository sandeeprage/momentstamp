export const CAPTURE_ROUNDS = 4;

const STRIP_WIDTH = 1200;

const spacingPresets = {
  compact: { margin: 24, columnGap: 8, rowGap: 28 },
  regular: { margin: 32, columnGap: 12, rowGap: 44 },
  wide: { margin: 40, columnGap: 20, rowGap: 64 },
  beside: { margin: 32, columnGap: 0, rowGap: 44 },
};

export const paperColors = [
  { id: 'paper', label: 'Paper', color: '#f8f3e8' },
  { id: 'rose', label: 'Rose', color: '#f3d6d2' },
  { id: 'sage', label: 'Sage', color: '#dce7da' },
  { id: 'sky', label: 'Sky', color: '#dce7f3' },
  { id: 'midnight', label: 'Midnight', color: '#1b272d' },
];

export const defaultStripStyle = () => ({
  color: '#f8f3e8', caption: '',
  font: 'mono', spacing: 'regular', rounded: false, showDate: false,
});

export function sanitizeStripStyle(input, fallback = defaultStripStyle()) {
  const value = input && typeof input === 'object' ? input : {};
  return {
    color: typeof value.color === 'string' && /^#[0-9a-f]{6}$/i.test(value.color) ? value.color.toLowerCase() : fallback.color,
    caption: typeof value.caption === 'string' ? value.caption.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 48) : fallback.caption,
    font: ['sans', 'serif', 'mono'].includes(value.font) ? value.font : fallback.font,
    spacing: ['compact', 'regular', 'wide', 'beside'].includes(value.spacing) ? value.spacing : fallback.spacing,
    rounded: typeof value.rounded === 'boolean' ? value.rounded : fallback.rounded,
    showDate: typeof value.showDate === 'boolean' ? value.showDate : fallback.showDate,
  };
}

export function stripGeometry(style) {
  const width = STRIP_WIDTH;
  const scale = width / 1200;
  const preset = spacingPresets[style.spacing] || spacingPresets.regular;
  const margin = preset.margin * scale;
  const columnGap = preset.columnGap * scale;
  const rowGap = preset.rowGap * scale;
  const size = (width - 2 * margin - columnGap) / 2;
  const top = margin;
  const photos = Array.from({ length: CAPTURE_ROUNDS * 2 }, (_, index) => ({
    x: margin + (index % 2) * (size + columnGap),
    y: top + Math.floor(index / 2) * (size + rowGap),
    size,
  }));
  const bottom = photos.at(-1).y + size;
  const height = Math.ceil(bottom + 144 * scale);
  return { width, height, photos, footerY: bottom + 50 * scale, columnGap, rowGap, scale };
}

export function stripInk(color) {
  const channels = color.slice(1).match(/.{2}/g).map(hex => {
    const channel = parseInt(hex, 16) / 255;
    return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
  });
  return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722 > .179 ? '#000000' : '#ffffff';
}

export function renderStrip(canvas, photos, input, capturedAt) {
  if (!Array.isArray(photos) || photos.length !== CAPTURE_ROUNDS * 2) throw new Error('A strip needs four photos from each person.');
  const style = sanitizeStripStyle(input);
  const geometry = stripGeometry(style);
  const { width, height, scale, footerY } = geometry;
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = style.color; ctx.fillRect(0, 0, width, height);
  geometry.photos.forEach(({ x, y, size }, index) => {
    const image = photos[index];
    const crop = Math.min(image.width, image.height);
    const joined = style.spacing === 'beside';
    const left = joined ? geometry.photos[index - index % 2].x : x;
    const right = left + (joined ? size * 2 : size);
    ctx.save();
    if (style.rounded) {
      const radius = size * .018;
      ctx.beginPath();
      ctx.moveTo(left + radius, y);
      ctx.arcTo(right, y, right, y + size, radius);
      ctx.arcTo(right, y + size, left, y + size, radius);
      ctx.arcTo(left, y + size, left, y, radius);
      ctx.arcTo(left, y, right, y, radius);
      ctx.closePath(); ctx.clip();
    }
    ctx.drawImage(image, (image.width - crop) / 2, (image.height - crop) / 2, crop, crop, x, y, size, size);
    if (!joined || index % 2 === 1) {
      ctx.strokeStyle = 'rgba(0, 0, 0, .16)'; ctx.lineWidth = scale;
      ctx.strokeRect(left + scale / 2, y + scale / 2, right - left - scale, size - scale);
    }
    ctx.restore();
  });
  ctx.fillStyle = stripInk(style.color); ctx.textAlign = 'center';
  const fonts = { sans: 'Arial, sans-serif', serif: 'Georgia, serif', mono: 'monospace' };
  ctx.font = `${style.font === 'serif' ? 'italic ' : ''}${Math.round(26 * scale)}px ${fonts[style.font]}`;
  ctx.fillText(style.caption, width / 2, footerY, width - 100);
  if (style.showDate && Number.isFinite(capturedAt) && Math.abs(capturedAt) <= 8.64e15) {
    ctx.font = `${Math.round(17 * scale)}px monospace`;
    ctx.fillText(new Date(capturedAt).toISOString().slice(0, 10), width / 2, footerY + (style.caption ? 30 * scale : 0));
  }
  ctx.font = `${Math.round(16 * scale)}px monospace`;
  ctx.fillText('MOMENTSTAMP', width / 2, height - 28 * scale);
  return canvas;
}
