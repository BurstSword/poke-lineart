import { Component, ElementRef, ViewChild } from '@angular/core';
import {
  IonHeader,
  IonToolbar,
  IonTitle,
  IonContent,
  IonCard,
  IonCardHeader,
  IonCardTitle,
  IonCardSubtitle,
  IonCardContent,
  IonButton,
  IonItem,
  IonLabel,
  IonAccordion,
  IonAccordionGroup,
} from '@ionic/angular/standalone';
import { NgIf, NgFor } from '@angular/common';
import { FormsModule } from '@angular/forms';
import {
  ImageProcessorService,
  PresetGroup,
  FrameType,
  PolaroidFrameOptions,
} from '../services/image-processor.service';
import { Directory, Filesystem } from '@capacitor/filesystem';
import { Capacitor } from '@capacitor/core';
import { Share } from '@capacitor/share';

@Component({
  selector: 'app-home',
  templateUrl: 'home.page.html',
  styleUrls: ['home.page.scss'],
  standalone: true,
  imports: [
    IonHeader,
    IonToolbar,
    IonTitle,
    IonContent,
    IonCard,
    IonCardHeader,
    IonCardTitle,
    IonCardSubtitle,
    IonCardContent,
    IonButton,
    IonItem,
    IonLabel,
    IonAccordion,
    IonAccordionGroup,
    NgIf,
    NgFor,
    FormsModule,
  ],
})
export class HomePage {
  @ViewChild('fileInput') fileInput?: ElementRef<HTMLInputElement>;

  // 1: Imagen, 2: Presets, 3: Ajustes finales
  currentStep = 1;

  selectedFile: File | null = null;
  originalImage: string | null = null;

  // Vista previa seleccionada en paso 2/3
  processedImage: string | null = null;

  // Tipos de preset
  presetGroups: PresetGroup[] = [];
  openedGroupId: string | null = null;

  // Variantes por grupo
  groupVariants: Record<string, { label: string; dataUrl: string }[]> = {};
  groupLoading: Record<string, boolean> = {};

  // Selección activa global (qué preset está escogido ahora)
  selectedGroupId: string | null = null;
  selectedVariantIndex = 0;

  openedCustomSections: string[] = ['lines', 'polaroid'];
  // Editor custom
  customPreview: string | null = null;
  customConfig: {
    blockSize: number;
    C: number;
    lowThresh: number;
    highThresh: number;
    dilationSize: number;
    laserFriendly: boolean;
    cleanOutlines?: boolean;
    frameType?: FrameType;
    // 👇 NUEVO
    polaroidOptions?: PolaroidFrameOptions;
  } = {
      blockSize: 21,
      C: 10,
      lowThresh: 30,
      highThresh: 90,
      dilationSize: 2,
      laserFriendly: false,
      frameType: 'none',

    };

  processing = false;
  errorMessage = '';
  private customPreviewTimeout: any = null;

  constructor(private imageProcessor: ImageProcessorService) {
    this.presetGroups = this.imageProcessor.getPresetGroups();
    this.openedGroupId = this.presetGroups[0]?.id ?? null;
  }

  // ---------- Navegación ----------
  goToStep(step: number): void {
    if (step < 1 || step > 3) return;

    if (step === 2 && !this.selectedFile) {
      this.currentStep = 1;
      return;
    }

    if (step === 3 && !this.selectedFile) {
      this.currentStep = 1;
      return;
    }

    this.currentStep = step;

    if (step === 3 && this.selectedFile) {
      this.updateCustomPreview();
    }
  }

  // ---------- Imagen ----------
  openFilePicker(): void {
    this.fileInput?.nativeElement.click();
  }

  onFileSelected(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0] ?? null;

    this.errorMessage = '';
    this.processedImage = null;
    this.customPreview = null;

    this.groupVariants = {};
    this.groupLoading = {};
    this.selectedGroupId = null;
    this.selectedVariantIndex = 0;

    if (!file) {
      this.selectedFile = null;
      this.originalImage = null;
      this.currentStep = 1;
      return;
    }

    this.selectedFile = file;

    const reader = new FileReader();
    reader.onload = () => {
      this.originalImage = reader.result as string;
      this.currentStep = 1;
    };
    reader.readAsDataURL(file);
  }

  resetImage(): void {
    this.selectedFile = null;
    this.originalImage = null;
    this.processedImage = null;
    this.customPreview = null;

    this.groupVariants = {};
    this.groupLoading = {};
    this.selectedGroupId = null;
    this.selectedVariantIndex = 0;

    this.errorMessage = '';
    this.currentStep = 1;

    if (this.fileInput?.nativeElement) {
      this.fileInput.nativeElement.value = '';
    }
  }

  // ---------- Paso 1 -> genera por defecto el primer grupo ----------
  async generateDefaultPresets(): Promise<void> {
    if (!this.selectedFile) return;

    const firstGroupId = this.presetGroups[0]?.id;
    if (!firstGroupId) return;

    this.processing = true;
    this.errorMessage = '';

    try {
      await this.loadGroupVariants(firstGroupId, true);

      this.openedGroupId = firstGroupId;
      this.currentStep = 2;
    } catch (err) {
      console.error(err);
      this.errorMessage = 'Ha ocurrido un error procesando la imagen.';
    } finally {
      this.processing = false;
    }
  }

  // ---------- Accordions ----------
  async onGroupChange(ev: CustomEvent): Promise<void> {
    const groupId = ev.detail.value as string | undefined;
    if (!groupId || !this.selectedFile) return;

    this.openedGroupId = groupId;

    // Generar solo si aún no existe cache
    if (!this.groupVariants[groupId]?.length) {
      await this.loadGroupVariants(groupId, true);
    }
  }

  async forceGenerateGroup(groupId: string): Promise<void> {
    if (!this.selectedFile) return;
    await this.loadGroupVariants(groupId, true, true);
  }

  private async loadGroupVariants(
    groupId: string,
    setAsSelected: boolean,
    force: boolean = false
  ): Promise<void> {
    if (!this.selectedFile) return;

    if (!force && this.groupVariants[groupId]?.length) {
      if (setAsSelected) {
        this.selectGroupVariant(groupId, 0);
      }
      return;
    }

    this.groupLoading[groupId] = true;

    try {
      const variants = await this.imageProcessor.generateVariants(this.selectedFile, groupId);
      this.groupVariants[groupId] = variants;

      if (variants.length && setAsSelected) {
        const coloringIndex = variants.findIndex(v => v.label === 'Coloring');
        const medioIndex = variants.findIndex(v => v.label === 'Medio');
        const index = coloringIndex >= 0 ? coloringIndex : medioIndex >= 0 ? medioIndex : 0;

        this.selectGroupVariant(groupId, index);
      }
    } finally {
      this.groupLoading[groupId] = false;
    }
  }

  isVariantActive(groupId: string, index: number): boolean {
    return this.selectedGroupId === groupId && this.selectedVariantIndex === index;
  }

  selectGroupVariant(groupId: string, index: number): void {
    const list = this.groupVariants[groupId];
    if (!list || !list[index]) return;

    this.selectedGroupId = groupId;
    this.selectedVariantIndex = index;
    this.processedImage = list[index].dataUrl;
  }

  // ---------- Paso 2 -> Paso 3 ----------
  goToCustomFromSelected(): void {
    if (!this.selectedGroupId) return;

    const variants = this.groupVariants[this.selectedGroupId];
    const selected = variants?.[this.selectedVariantIndex];
    if (!selected) return;

    const group = this.imageProcessor.getPresetGroups().find(g => g.id === this.selectedGroupId);
    const preset = group?.presets.find(p => p.label === selected.label);

    if (preset) {
      this.customConfig = {
        blockSize: preset.config.blockSize,
        C: preset.config.C,
        lowThresh: preset.config.lowThresh,
        highThresh: preset.config.highThresh,
        dilationSize: preset.config.dilationSize,
        laserFriendly: !!preset.config.laserFriendly,
        cleanOutlines: preset.config.cleanOutlines,
        frameType: preset.frameType ?? 'none',
        polaroidOptions: preset.config.polaroidOptions ?? {
          fit: 'cover',
          zoom: 1,
          offsetX: 0,
          offsetY: 0
        }
      };
      this.openedCustomSections = this.customConfig.frameType === 'polaroid'
        ? ['lines', 'polaroid']
        : ['lines'];

    }


    this.currentStep = 3;
    this.customPreview = null;
    this.updateCustomPreview();
  }

  // ---------- Custom realtime ----------
  onCustomConfigChange(): void {
    if (!this.selectedFile || this.currentStep !== 3) return;

    if (this.customPreviewTimeout) {
      clearTimeout(this.customPreviewTimeout);
    }

    this.customPreviewTimeout = setTimeout(() => {
      this.updateCustomPreview();
    }, 200);
  }

  private async updateCustomPreview(): Promise<void> {
    if (!this.selectedFile) return;

    try {
      const cfg = { ...this.customConfig };

      // AdaptiveThreshold requiere blockSize impar
      if (cfg.blockSize % 2 === 0) {
        cfg.blockSize += 1;
      }

      const dataUrl = await this.imageProcessor.generateCustomVariant(this.selectedFile, cfg);

      this.customPreview = dataUrl;
      if (this.currentStep === 3) {
        this.processedImage = dataUrl;
      }
    } catch (err) {
      console.error(err);
      this.errorMessage = 'No se ha podido actualizar la vista previa.';
    }
  }

  // ---------- Descargar ----------
  downloadImage(): void {
    if (!this.processedImage) return;

    const a = document.createElement('a');
    a.href = this.processedImage;
    a.download = 'pokemon-lineart.png';
    a.click();
  }

  // ---------- Compartir ----------
  async shareImage(): Promise<void> {
    if (!this.processedImage) return;

    try {
      // Si estamos en web, intenta Web Share
      if (!Capacitor.isNativePlatform()) {
        const nav: any = navigator;
        if (nav?.share) {
          await nav.share({
            title: 'Line Art',
            text: 'Te comparto esta versión en líneas 🙂',
            url: this.processedImage,
          });
          return;
        }

        this.errorMessage = 'Compartir no está disponible en este navegador.';
        return;
      }

      // ---- Native (Android/iOS) ----
      // Convertimos DataURL -> base64 limpio
      const base64 = this.processedImage.split(',')[1];
      const fileName = `lineart-${Date.now()}.png`;

      // Guardar en caché
      const write = await Filesystem.writeFile({
        path: fileName,
        data: base64,
        directory: Directory.Cache,
      });

      // Compartir usando el URI nativo
      await Share.share({
        title: 'Line Art',
        text: 'Te comparto esta versión en líneas 🙂',
        url: write.uri,
        dialogTitle: 'Compartir imagen',
      });
    } catch (err) {
      console.error(err);
      this.errorMessage = 'No se ha podido compartir la imagen.';
    }
  }

  setPolaroidFit(fit: 'cover' | 'stretch'): void {
    this.customConfig.polaroidOptions = {
      ...(this.customConfig.polaroidOptions ?? {}),
      fit
    };
    this.onCustomConfigChange();
  }

  setPolaroidZoom(val: number): void {
    this.customConfig.polaroidOptions = {
      ...(this.customConfig.polaroidOptions ?? {}),
      zoom: Number(val)
    };
    this.onCustomConfigChange();
  }

  setPolaroidOffsetX(val: number): void {
    this.customConfig.polaroidOptions = {
      ...(this.customConfig.polaroidOptions ?? {}),
      offsetX: Number(val)
    };
    this.onCustomConfigChange();
  }

  setPolaroidOffsetY(val: number): void {
    this.customConfig.polaroidOptions = {
      ...(this.customConfig.polaroidOptions ?? {}),
      offsetY: Number(val)
    };
    this.onCustomConfigChange();
  }

  onCustomAccordionChange(ev: CustomEvent): void {
    const value = ev.detail.value;

    // Ionic puede devolver string o array según multiple
    if (Array.isArray(value)) {
      this.openedCustomSections = value;
    } else if (typeof value === 'string') {
      this.openedCustomSections = [value];
    } else {
      this.openedCustomSections = [];
    }
  }
}