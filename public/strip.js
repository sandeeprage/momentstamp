export const stripLayouts = [
  { id: 'classic', label: 'Classic strip', width: 850, height: 1830 },
  { id: 'duo', label: 'Side by side', width: 1640, height: 1030 },
  { id: 'square', label: 'Square', width: 1200, height: 1200 },
];

export const paperColors = [
  { id: 'paper', label: 'Paper', color: '#fbfcfc' },
  { id: 'rose', label: 'Rose', color: '#f3d6d2' },
  { id: 'sage', label: 'Sage', color: '#dce7da' },
  { id: 'sky', label: 'Sky', color: '#dce7f3' },
  { id: 'midnight', label: 'Midnight', color: '#1b272d' },
];

export const defaultStripStyle = () => ({
  layout: 'classic', color: '#fbfcfc', caption: 'even from here',
  font: 'serif', spacing: 'regular', rounded: false, showDate: false,
});

export function sanitizeStripStyle(input, fallback = defaultStripStyle()) {
  const value = input && typeof input === 'object' ? input : {};
  return {
    layout: stripLayouts.some(layout => layout.id === value.layout) ? value.layout : fallback.layout,
    color: typeof value.color === 'string' && /^#[0-9a-f]{6}$/i.test(value.color) ? value.color.toLowerCase() : fallback.color,
    caption: typeof value.caption === 'string' ? value.caption.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 48) : fallback.caption,
    font: ['sans', 'serif', 'mono'].includes(value.font) ? value.font : fallback.font,
    spacing: ['compact', 'regular', 'wide'].includes(value.spacing) ? value.spacing : fallback.spacing,
    rounded: typeof value.rounded === 'boolean' ? value.rounded : fallback.rounded,
    showDate: typeof value.showDate === 'boolean' ? value.showDate : fallback.showDate,
  };
}

export function stripGeometry(style) {
  const layout = stripLayouts.find(item => item.id === style.layout) || stripLayouts[0];
  const { width, height } = layout;
  const scale = Math.min(width, height) / 850;
  const margin = ({ compact: 32, regular: 62, wide: 90 }[style.spacing] || 62) * scale;
  const gap = margin / 2;
  const vertical = layout.id === 'classic';
  const size = vertical ? width - 2 * margin : (width - 2 * margin - gap) / 2;
  const top = layout.id === 'square' ? (height - size) / 2 - 60 : 100;
  const photos = vertical
    ? [{ x: margin, y: top, size }, { x: margin, y: top + size + gap, size }]
    : [{ x: margin, y: top, size }, { x: margin + size + gap, y: top, size }];
  const bottom = photos[1].y + size;
  return { width, height, photos, headerY: top - 38, footerY: bottom + (height - bottom) * .38, scale };
}

export function stripInk(color) {
  const channels = color.slice(1).match(/.{2}/g).map(hex => {
    const channel = parseInt(hex, 16) / 255;
    return channel <= .04045 ? channel / 12.92 : ((channel + .055) / 1.055) ** 2.4;
  });
  return channels[0] * .2126 + channels[1] * .7152 + channels[2] * .0722 > .179 ? '#000000' : '#ffffff';
}

export function renderStrip(canvas, photos, input, capturedAt) {
  const style = sanitizeStripStyle(input);
  const geometry = stripGeometry(style);
  const { width, height, scale, headerY, footerY } = geometry;
  canvas.width = width; canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = style.color; ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = stripInk(style.color); ctx.textAlign = 'center';
  ctx.font = '500 24px monospace';
  ctx.fillText('A MOMENT, MADE TOGETHER', width / 2, headerY, width - 64);
  geometry.photos.forEach(({ x, y, size }, index) => {
    const image = photos[index];
    const crop = Math.min(image.width, image.height);
    ctx.save();
    if (style.rounded) {
      const radius = size * .045;
      ctx.beginPath();
      ctx.moveTo(x + radius, y);
      ctx.arcTo(x + size, y, x + size, y + size, radius);
      ctx.arcTo(x + size, y + size, x, y + size, radius);
      ctx.arcTo(x, y + size, x, y, radius);
      ctx.arcTo(x, y, x + size, y, radius);
      ctx.closePath(); ctx.clip();
    }
    ctx.drawImage(image, (image.width - crop) / 2, (image.height - crop) / 2, crop, crop, x, y, size, size);
    ctx.restore();
  });
  const fonts = { sans: 'Arial, sans-serif', serif: 'Georgia, serif', mono: 'monospace' };
  ctx.font = `${style.font === 'serif' ? 'italic ' : ''}${Math.round(34 * scale)}px ${fonts[style.font]}`;
  ctx.fillText(style.caption, width / 2, footerY, width - 100);
  if (style.showDate && Number.isFinite(capturedAt) && Math.abs(capturedAt) <= 8.64e15) {
    ctx.font = `${Math.round(17 * scale)}px monospace`;
    ctx.fillText(new Date(capturedAt).toISOString().slice(0, 10), width / 2, footerY + 34 * scale);
  }
  ctx.font = '17px monospace'; ctx.fillText('momentstamp', width / 2, height - 28);
  return canvas;
}
