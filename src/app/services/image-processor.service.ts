import { Injectable } from '@angular/core';

declare const cv: any; // OpenCV global

export interface LineArtConfig {
  blockSize: number;
  C: number;
  lowThresh: number;
  highThresh: number;
  dilationSize: number;
  laserFriendly?: boolean;
  cleanOutlines?: boolean;

  // 👇 NUEVO
  polaroidOptions?: PolaroidFrameOptions;
}


export type FrameType = 'none' | 'polaroid';

export interface PresetItem {
  label: string;
  config: LineArtConfig;
  frameType?: FrameType;
}

export interface PresetGroup {
  id: string;
  label: string;
  presets: PresetItem[];
}

export type PolaroidFit = 'cover' | 'stretch';

export interface PolaroidFrameOptions {
  fit?: PolaroidFit;   // cover por defecto
  zoom?: number;       // 1 = normal
  offsetX?: number;    // -100..100 (porcentaje relativo)
  offsetY?: number;    // -100..100
}


@Injectable({
  providedIn: 'root'
})
export class ImageProcessorService {

  private cvReady = false;
  private cvReadyPromise: Promise<void>;

  constructor() {
    this.cvReadyPromise = new Promise((resolve) => {
      if ((window as any).cv && cv['onRuntimeInitialized']) {
        cv['onRuntimeInitialized'] = () => {
          this.cvReady = true;
          resolve();
        };
      } else {
        this.cvReady = true;
        resolve();
      }
    });
  }

  private async ensureCvReady(): Promise<void> {
    if (this.cvReady) return;
    await this.cvReadyPromise;
  }

  /** Grupos de presets por tipo */
  getPresetGroups(): PresetGroup[] {
    const cardPresets: PresetItem[] = [
      {
        label: 'Suave',
        config: { blockSize: 15, C: 5, lowThresh: 50, highThresh: 120, dilationSize: 1 }
      },
      {
        label: 'Medio',
        config: { blockSize: 21, C: 10, lowThresh: 30, highThresh: 90, dilationSize: 2 }
      },
      {
        label: 'Intenso',
        config: { blockSize: 25, C: 12, lowThresh: 20, highThresh: 70, dilationSize: 3 }
      },
      {
        label: 'Laser',
        config: {
          blockSize: 23, C: 12, lowThresh: 35, highThresh: 100, dilationSize: 2,
          laserFriendly: true
        }
      },
      {
        label: 'Coloring',
        config: {
          blockSize: 21, C: 10, lowThresh: 40, highThresh: 120, dilationSize: 2,
          cleanOutlines: true
        }
      },
      // Extras
      {
        label: 'Ultra Suave',
        config: { blockSize: 13, C: 3, lowThresh: 60, highThresh: 140, dilationSize: 1 }
      },
      {
        label: 'Clean',
        config: { blockSize: 19, C: 8, lowThresh: 45, highThresh: 130, dilationSize: 1, cleanOutlines: true }
      }
    ];

    const polaroidPresets: PresetItem[] = [
      {
        label: 'Suave',
        frameType: 'polaroid',
        config: { blockSize: 15, C: 5, lowThresh: 50, highThresh: 120, dilationSize: 1 }
      },
      {
        label: 'Medio',
        frameType: 'polaroid',
        config: { blockSize: 21, C: 10, lowThresh: 30, highThresh: 90, dilationSize: 2 }
      },
      {
        label: 'Coloring',
        frameType: 'polaroid',
        config: {
          blockSize: 21, C: 10, lowThresh: 40, highThresh: 120, dilationSize: 2,
          cleanOutlines: true
        }
      },
      {
        label: 'Medio',
        frameType: 'polaroid',
        config: {
          blockSize: 21, C: 10, lowThresh: 30, highThresh: 90, dilationSize: 2,
          polaroidOptions: { fit: 'cover', zoom: 1, offsetX: 0, offsetY: 0 }
        }
      },

    ];

    return [
      { id: 'card', label: 'Carta', presets: cardPresets },
      { id: 'polaroid', label: 'Polaroid (8.8 × 10.7 cm)', presets: polaroidPresets },
    ];

  }

  /**
   * Compatibilidad con tu API anterior.
   * Devuelve los presets del grupo "Carta".
   */
  getPresetConfigs(): { label: string; config: LineArtConfig }[] {
    const card = this.getPresetGroups().find(g => g.id === 'card');
    return (card?.presets ?? []).map(p => ({ label: p.label, config: p.config }));
  }

  async generateVariants(
    file: File,
    groupId: string = 'card'
  ): Promise<{ label: string; dataUrl: string }[]> {
    await this.ensureCvReady();

    const img = await this.loadImageFromFile(file);
    const groups = this.getPresetGroups();
    const group = groups.find(g => g.id === groupId) ?? groups[0];

    const variants: { label: string; dataUrl: string }[] = [];

    for (const item of group.presets) {
      const raw = this.processImage(img, item.config);
      const framed = await this.applyFrameIfNeeded(
        raw,
        item.frameType ?? 'none',
        item.config.polaroidOptions
      );
      variants.push({ label: item.label, dataUrl: framed });
    }


    return variants;
  }

  async toLineArt(file: File): Promise<string> {
    const variants = await this.generateVariants(file, 'card');
    return variants[1]?.dataUrl ?? variants[0].dataUrl;
  }

  async generateCustomVariant(
    file: File,
    config: LineArtConfig & { frameType?: FrameType }
  ): Promise<string> {
    await this.ensureCvReady();
    const img = await this.loadImageFromFile(file);

    const raw = this.processImage(img, config);
    return this.applyFrameIfNeeded(
      raw,
      config.frameType ?? 'none',
      config.polaroidOptions
    );
  }

  private processImage(img: HTMLImageElement, cfg: LineArtConfig): string {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;

    const maxWidth = 900;
    const scale = img.width > maxWidth ? maxWidth / img.width : 1;

    canvas.width = img.width * scale;
    canvas.height = img.height * scale;
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

    const src = cv.imread(canvas);
    const gray = new cv.Mat();
    const blurred = new cv.Mat();
    const edges = new cv.Mat();
    const thresh = new cv.Mat();
    const base = new cv.Mat();

    try {
      cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
      cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0, 0, cv.BORDER_DEFAULT);

      cv.Canny(blurred, edges, cfg.lowThresh, cfg.highThresh);

      if (cfg.cleanOutlines) {
        cv.threshold(edges, base, 10, 255, cv.THRESH_BINARY);
      } else {
        cv.adaptiveThreshold(
          blurred,
          thresh,
          255,
          cv.ADAPTIVE_THRESH_MEAN_C,
          cv.THRESH_BINARY_INV,
          cfg.blockSize,
          cfg.C
        );
        cv.bitwise_or(thresh, edges, base);
      }

      const kernel = cv.getStructuringElement(
        cv.MORPH_RECT,
        new cv.Size(cfg.dilationSize, cfg.dilationSize)
      );

      const dilated = new cv.Mat();
      cv.dilate(base, dilated, kernel);

      let finalMat = new cv.Mat();

      if (cfg.laserFriendly) {
        const openKernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3));
        const opened = new cv.Mat();
        cv.morphologyEx(dilated, opened, cv.MORPH_OPEN, openKernel);

        const smooth = new cv.Mat();
        cv.GaussianBlur(opened, smooth, new cv.Size(3, 3), 0, 0, cv.BORDER_DEFAULT);

        const tmp = new cv.Mat();
        cv.threshold(smooth, tmp, 180, 255, cv.THRESH_BINARY);

        cv.bitwise_not(tmp, finalMat);

        openKernel.delete();
        opened.delete();
        smooth.delete();
        tmp.delete();
      } else {
        cv.bitwise_not(dilated, finalMat);
      }

      cv.imshow(canvas, finalMat);
      const dataUrl = canvas.toDataURL('image/png');

      kernel.delete();
      dilated.delete();
      finalMat.delete();

      return dataUrl;
    } finally {
      src.delete();
      gray.delete();
      blurred.delete();
      edges.delete();
      thresh.delete();
      base.delete();
    }
  }

  private async applyFrameIfNeeded(
    dataUrl: string,
    frameType: FrameType,
    polaroidOptions?: PolaroidFrameOptions
  ): Promise<string> {
    if (frameType !== 'polaroid') return dataUrl;

    const img = await this.loadImageFromDataUrl(dataUrl);

    // --- Polaroid estándar aprox a 300 DPI ---
    const POLA_W = 1020; // ~3.4 in
    const POLA_H = 1260; // ~4.2 in
    const PHOTO_SIZE = 930; // ~3.1 in

    const sideMargin = Math.round((POLA_W - PHOTO_SIZE) / 2);
    const topMargin = sideMargin;

    const outerStroke = 2;
    const innerStroke = 1;

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d')!;

    canvas.width = POLA_W;
    canvas.height = POLA_H;

    // Fondo blanco
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Área de foto
    const photoX = sideMargin;
    const photoY = topMargin;
    const photoW = PHOTO_SIZE;
    const photoH = PHOTO_SIZE;

    // Opciones
    const fit = polaroidOptions?.fit ?? 'cover';
    const zoom = Math.max(0.5, Math.min(polaroidOptions?.zoom ?? 1, 3));

    const offsetXPercent = Math.max(-100, Math.min(polaroidOptions?.offsetX ?? 0, 100));
    const offsetYPercent = Math.max(-100, Math.min(polaroidOptions?.offsetY ?? 0, 100));

    // Convertimos offsets % a px relativos al área de foto
    const offsetX = (offsetXPercent / 100) * (photoW * 0.5);
    const offsetY = (offsetYPercent / 100) * (photoH * 0.5);

    let drawW = photoW;
    let drawH = photoH;

    if (fit === 'stretch') {
      // Estira sin respetar aspecto para NO dejar hueco sin recortar
      drawW = photoW * zoom;
      drawH = photoH * zoom;
    } else {
      // cover: respeta aspecto, rellena sin hueco, puede recortar
      const baseScale = Math.max(photoW / img.width, photoH / img.height);
      const scale = baseScale * zoom;
      drawW = Math.round(img.width * scale);
      drawH = Math.round(img.height * scale);
    }

    // Centramos y aplicamos pan
    const centerX = photoX + photoW / 2;
    const centerY = photoY + photoH / 2;

    const drawX = Math.round(centerX - drawW / 2 + offsetX);
    const drawY = Math.round(centerY - drawH / 2 + offsetY);

    // Dibujamos dentro del área de foto, recortando lo que salga
    ctx.save();
    ctx.beginPath();
    ctx.rect(photoX, photoY, photoW, photoH);
    ctx.clip();

    ctx.drawImage(img, drawX, drawY, drawW, drawH);

    ctx.restore();

    // Línea interna
    ctx.lineWidth = innerStroke;
    ctx.strokeStyle = '#111111';
    ctx.strokeRect(
      photoX - innerStroke / 2,
      photoY - innerStroke / 2,
      photoW + innerStroke,
      photoH + innerStroke
    );

    // Línea exterior
    ctx.lineWidth = outerStroke;
    ctx.strokeStyle = '#111111';
    ctx.strokeRect(
      outerStroke / 2,
      outerStroke / 2,
      canvas.width - outerStroke,
      canvas.height - outerStroke
    );

    return canvas.toDataURL('image/png');
  }


  /**
   * Dibuja una imagen tipo "cover" ocupando todo el rectángulo destino,
   * recortando centrado si es necesario.
   */
  private drawCoverImage(
    ctx: CanvasRenderingContext2D,
    img: HTMLImageElement,
    dx: number, dy: number, dw: number, dh: number
  ): void {
    const sRatio = img.width / img.height;
    const dRatio = dw / dh;

    let sx = 0, sy = 0, sw = img.width, sh = img.height;

    if (sRatio > dRatio) {
      // Imagen más ancha -> recorta laterales
      sw = Math.round(img.height * dRatio);
      sx = Math.round((img.width - sw) / 2);
    } else {
      // Imagen más alta -> recorta arriba/abajo
      sh = Math.round(img.width / dRatio);
      sy = Math.round((img.height - sh) / 2);
    }

    ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh);
  }



  private loadImageFromFile(file: File): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = (e) => reject(e);
        img.src = reader.result as string;
      };
      reader.onerror = (e) => reject(e);
      reader.readAsDataURL(file);
    });
  }

  private loadImageFromDataUrl(dataUrl: string): Promise<HTMLImageElement> {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = (e) => reject(e);
      img.src = dataUrl;
    });
  }
}
