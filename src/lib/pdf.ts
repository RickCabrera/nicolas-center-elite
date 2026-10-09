import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFImage, type PDFPage } from 'pdf-lib';

/**
 * Constructor de PDF en hoja carta con el membrete de la clínica (REC-08, PAG-08, EXP-07).
 * Flujo vertical simple: cada método dibuja y avanza el cursor; salta de página solo.
 *
 *   const pdf = await PdfBuilder.create({ clinicName: 'Nicolas Center Elite', subtitle: '…' });
 *   pdf.title('Receta médica', 'Folio COR-RX-000001');
 *   pdf.kv([{ label: 'Paciente', value: '…' }, { label: 'Edad', value: '34 años' }]);
 *   pdf.paragraph('…');
 *   return pdfResponse(await pdf.finish('pie de página'), 'receta.pdf');
 */
const W = 612, H = 792, M = 50;
const INK = rgb(0.08, 0.09, 0.1), GREY = rgb(0.43, 0.46, 0.51), BLUE = rgb(0.07, 0.45, 0.84), LINE = rgb(0.8, 0.8, 0.78), RED = rgb(0.78, 0.16, 0.16);

/** Las fuentes estándar solo cubren WinAnsi: se sustituye lo que no exista para no romper el PDF. */
function clean(s: unknown): string {
  return String(s ?? '')
    .replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/–|—/g, '-').replace(/…/g, '...')
    .replace(/ /g, ' ').replace(/\t/g, '  ')
     
    .replace(/[^\x0A\x20-\x7E¡-ÿ€•°]/g, '');
}

export class PdfBuilder {
  private page!: PDFPage;
  private y = 0;
  private constructor(
    private doc: PDFDocument, private font: PDFFont, private bold: PDFFont, private logo: PDFImage | null,
    private head: { clinicName: string; subtitle?: string },
  ) {}

  static async create(head: { clinicName: string; subtitle?: string }): Promise<PdfBuilder> {
    const doc = await PDFDocument.create();
    doc.setCreator('Nicolas Center Elite');
    doc.setProducer('Nicolas Center Elite');
    const font = await doc.embedFont(StandardFonts.Helvetica);
    const bold = await doc.embedFont(StandardFonts.HelveticaBold);
    let logo: PDFImage | null = null;
    try {
      logo = await doc.embedPng(await readFile(join(process.cwd(), 'public', 'logo.png')));
    } catch {
      /* sin logo: el membrete sale solo con texto */
    }
    const b = new PdfBuilder(doc, font, bold, logo, head);
    b.newPage();
    return b;
  }

  private newPage() {
    this.page = this.doc.addPage([W, H]);
    this.y = H - M;
    const x = this.logo ? M + 56 : M;
    if (this.logo) this.page.drawImage(this.logo, { x: M, y: this.y - 44, width: 44, height: 44 });
    const [first, ...restWords] = clean(this.head.clinicName).toUpperCase().split(' ');
    this.page.drawText(first, { x, y: this.y - 18, size: 16, font: this.bold, color: BLUE });
    this.page.drawText(restWords.join(' '), { x: x + this.bold.widthOfTextAtSize(first + ' ', 16), y: this.y - 18, size: 16, font: this.bold, color: INK });
    if (this.head.subtitle) this.page.drawText(clean(this.head.subtitle).slice(0, 110), { x, y: this.y - 34, size: 9, font: this.font, color: GREY });
    this.y -= 54;
    this.page.drawLine({ start: { x: M, y: this.y }, end: { x: W - M, y: this.y }, thickness: 1.5, color: INK });
    this.y -= 20;
  }

  private need(h: number) {
    if (this.y - h < M + 30) this.newPage();
  }

  private wrap(text: string, font: PDFFont, size: number, width: number): string[] {
    const out: string[] = [];
    for (const para of clean(text).split('\n')) {
      let line = '';
      for (const word of para.split(/\s+/)) {
        const trial = line ? `${line} ${word}` : word;
        if (font.widthOfTextAtSize(trial, size) <= width) line = trial;
        else {
          if (line) out.push(line);
          let w = word;
          while (font.widthOfTextAtSize(w, size) > width && w.length > 1) {
            let cut = w.length - 1;
            while (cut > 1 && font.widthOfTextAtSize(w.slice(0, cut), size) > width) cut--;
            out.push(w.slice(0, cut));
            w = w.slice(cut);
          }
          line = w;
        }
      }
      out.push(line);
    }
    return out;
  }

  space(n = 10) { this.y -= n; return this; }

  title(text: string, right?: string) {
    this.need(30);
    this.page.drawText(clean(text).toUpperCase(), { x: M, y: this.y - 12, size: 13, font: this.bold, color: INK });
    if (right) {
      const t = clean(right);
      this.page.drawText(t, { x: W - M - this.bold.widthOfTextAtSize(t, 10), y: this.y - 11, size: 10, font: this.bold, color: INK });
    }
    this.y -= 26;
    return this;
  }

  heading(text: string) {
    this.need(26);
    this.page.drawText(clean(text).toUpperCase(), { x: M, y: this.y - 10, size: 9.5, font: this.bold, color: BLUE });
    this.y -= 18;
    return this;
  }

  /** Fila de pares etiqueta/valor repartidos en columnas iguales. */
  kv(items: { label: string; value: unknown }[], columns = Math.min(items.length, 4)) {
    const colW = (W - 2 * M) / columns;
    for (let i = 0; i < items.length; i += columns) {
      const row = items.slice(i, i + columns);
      const lines = row.map((it) => this.wrap(String(it.value ?? '—') || '—', this.font, 10.5, colW - 10));
      const h = 14 + Math.max(...lines.map((l) => l.length)) * 13 + 6;
      this.need(h);
      row.forEach((it, c) => {
        const x = M + c * colW;
        this.page.drawText(clean(it.label).toUpperCase(), { x, y: this.y - 8, size: 7, font: this.bold, color: GREY });
        lines[c].forEach((ln, k) => this.page.drawText(ln, { x, y: this.y - 22 - k * 13, size: 10.5, font: this.font, color: INK }));
      });
      this.y -= h;
    }
    return this;
  }

  paragraph(text: string, opts: { size?: number; bold?: boolean; color?: 'grey' | 'red'; indent?: number } = {}) {
    const size = opts.size ?? 10.5;
    const font = opts.bold ? this.bold : this.font;
    const indent = opts.indent ?? 0;
    for (const ln of this.wrap(text, font, size, W - 2 * M - indent)) {
      this.need(size + 4);
      this.page.drawText(ln, { x: M + indent, y: this.y - size, size, font, color: opts.color === 'grey' ? GREY : opts.color === 'red' ? RED : INK });
      this.y -= size + 4;
    }
    return this;
  }

  rule() {
    this.need(12);
    this.page.drawLine({ start: { x: M, y: this.y - 4 }, end: { x: W - M, y: this.y - 4 }, thickness: 0.6, color: LINE });
    this.y -= 12;
    return this;
  }

  /** Tabla sencilla. `widths` son fracciones que suman 1. */
  table(headers: string[], rows: unknown[][], widths?: number[], alignRight: number[] = []) {
    const total = W - 2 * M;
    const ws = (widths ?? headers.map(() => 1 / headers.length)).map((f) => f * total);
    const drawRow = (cells: unknown[], font: PDFFont, color = INK, size = 9.5) => {
      const lines = cells.map((c, i) => this.wrap(String(c ?? ''), font, size, ws[i] - 8));
      const h = Math.max(...lines.map((l) => l.length)) * (size + 3) + 8;
      this.need(h);
      let x = M;
      lines.forEach((ls, i) => {
        ls.forEach((ln, k) => {
          const tx = alignRight.includes(i) ? x + ws[i] - 8 - font.widthOfTextAtSize(ln, size) : x;
          this.page.drawText(ln, { x: tx, y: this.y - size - 2 - k * (size + 3), size, font, color });
        });
        x += ws[i];
      });
      this.y -= h;
      this.page.drawLine({ start: { x: M, y: this.y }, end: { x: W - M, y: this.y }, thickness: 0.4, color: LINE });
    };
    drawRow(headers.map((h) => h.toUpperCase()), this.bold, GREY, 7.5);
    rows.forEach((r) => drawRow(r, this.font));
    this.y -= 8;
    return this;
  }

  /** Imagen PNG en data URL (firma trazada en pantalla). */
  async signatureImage(dataUrl: string, width = 180) {
    try {
      const b64 = dataUrl.split(',')[1];
      if (!b64) return this;
      const img = await this.doc.embedPng(Buffer.from(b64, 'base64'));
      const h = (img.height / img.width) * width;
      this.need(h + 6);
      this.page.drawImage(img, { x: M, y: this.y - h, width, height: h });
      this.y -= h + 6;
    } catch {
      /* firma ilegible: se omite la imagen */
    }
    return this;
  }

  /** Línea de firma alineada a la derecha con nombre y renglones debajo (cédula, institución…). */
  signature(name: string, lines: string[] = []) {
    const h = 60 + lines.length * 12;
    this.need(h);
    const w = 240, x = W - M - w;
    this.y -= 44;
    this.page.drawLine({ start: { x, y: this.y }, end: { x: W - M, y: this.y }, thickness: 0.8, color: INK });
    const center = (t: string, font: PDFFont, size: number, dy: number, color = INK) => {
      const s = clean(t);
      this.page.drawText(s, { x: x + (w - font.widthOfTextAtSize(s, size)) / 2, y: this.y - dy, size, font, color });
    };
    center(name, this.bold, 10.5, 14);
    lines.forEach((l, i) => center(l, this.font, 8.5, 27 + i * 11, GREY));
    this.y -= 20 + lines.length * 12;
    return this;
  }

  /** Sello diagonal (p. ej. CANCELADA). */
  stamp(text: string) {
    for (const p of this.doc.getPages()) {
      p.drawText(clean(text).toUpperCase(), { x: 120, y: 300, size: 64, font: this.bold, color: RED, opacity: 0.18, rotate: { type: 'degrees' as never, angle: 35 } });
    }
    return this;
  }

  async finish(footer?: string): Promise<Uint8Array> {
    const pages = this.doc.getPages();
    pages.forEach((p, i) => {
      if (footer) {
        this.wrap(footer, this.font, 7.5, W - 2 * M - 60).slice(0, 3).forEach((ln, k) =>
          p.drawText(ln, { x: M, y: 38 - k * 9, size: 7.5, font: this.font, color: GREY }));
      }
      const n = `${i + 1} / ${pages.length}`;
      p.drawText(n, { x: W - M - this.font.widthOfTextAtSize(n, 8), y: 38, size: 8, font: this.font, color: GREY });
    });
    return this.doc.save();
  }
}

export function pdfResponse(bytes: Uint8Array, filename: string, inline = true): Response {
  return new Response(Buffer.from(bytes), {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(filename)}`,
      'Cache-Control': 'private, no-store',
    },
  });
}
