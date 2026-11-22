/** WebGL-слой отпечатка: полноэкранный ShaderMaterial (three.js), один шейдер на все процессы. */
import * as THREE from 'three';
import vert from './shaders/fullscreen.vert.glsl?raw';
import frag from './shaders/print.frag.glsl?raw';
import { processParams, uniformName, type ShaderParams } from './params';

export const FRAME_ASPECT = 4 / 5;
const MAX_TEX = 2048;
const PAPER: [number, number, number] = [0xf3 / 255, 0xef / 255, 0xe6 / 255];

export type FrameState = {
  time: number;
  develop: number;
  beat: number;
  rms: number;
  seed: number;
  mix: number;
  /** смещение параллакса (uv), от курсора или гироскопа */
  parallax?: [number, number];
  /** фаза частиц воздуха — растёт быстрее, когда громче */
  airTime?: number;
  /** номер кадра в композиции */
  frameSeed?: number;
};

/** Кадр для шейдера: фото или видео ИИ-оживления. */
export type PhotoSource = HTMLImageElement | HTMLVideoElement;
const isVideo = (s: PhotoSource): s is HTMLVideoElement => s instanceof HTMLVideoElement;
const aspectOf = (s: PhotoSource) => (isVideo(s) ? s.videoWidth / s.videoHeight : s.naturalWidth / s.naturalHeight) || 1;

export async function loadImage(blob: Blob): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(blob);
  const img = new Image();
  img.src = url;
  try {
    await img.decode();
  } finally {
    URL.revokeObjectURL(url);
  }
  return img;
}

export class PrintRenderer {
  readonly canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.Camera();
  private material: THREE.ShaderMaterial;
  private textures = new Map<PhotoSource, THREE.Texture>();
  private current: (PhotoSource | null)[] = [null, null, null];
  private currentDepth: HTMLImageElement | null = null;
  private flatDepth: THREE.Texture;
  private size = { w: 0, h: 0 };

  constructor(width: number, height: number) {
    this.canvas = document.createElement('canvas');
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: false,
      alpha: false,
      preserveDrawingBuffer: true, // компоновщик копирует кадр на 2D-canvas
    });
    this.renderer.setPixelRatio(1);
    // без преобразований цвета: фото и бумага уже в sRGB
    this.renderer.outputColorSpace = THREE.LinearSRGBColorSpace;

    const blank = new THREE.DataTexture(new Uint8Array([243, 239, 230, 255]), 1, 1);
    blank.needsUpdate = true;
    this.flatDepth = new THREE.DataTexture(new Uint8Array([128, 128, 128, 255]), 1, 1);
    this.flatDepth.needsUpdate = true;
    const uniforms: Record<string, THREE.IUniform> = {
      uPhotoA: { value: blank }, uPhotoB: { value: blank }, uPhotoC: { value: blank },
      uAspectA: { value: 1 }, uAspectB: { value: 1 }, uAspectC: { value: 1 },
      uMix: { value: 0 }, uFrameAspect: { value: FRAME_ASPECT },
      uResolution: { value: new THREE.Vector2(width, height) },
      uTime: { value: 0 }, uDevelop: { value: 0 }, uBeat: { value: 0 }, uRms: { value: 0.5 }, uSeed: { value: 0 },
      uFrameSeed: { value: 0 },
      uDepth: { value: this.flatDepth }, uHasDepth: { value: 0 },
      uParallax: { value: new THREE.Vector2(0, 0) }, uAirTime: { value: 0 },
      uPaper: { value: new THREE.Vector3(...PAPER) },
    };
    // униформы процесса и света — по ключам вектора параметров (тест сверяет их с шейдером)
    for (const [key, value] of Object.entries(processParams([{ id: 'autochrome', weight: 1 }]))) {
      uniforms[uniformName(key)] = { value: Array.isArray(value) ? new THREE.Vector3(...value) : value };
    }
    this.material = new THREE.ShaderMaterial({
      vertexShader: vert,
      fragmentShader: frag,
      depthTest: false,
      depthWrite: false,
      uniforms,
    });
    this.scene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material));
    this.resize(width, height);
  }

  resize(width: number, height: number) {
    const s = Math.min(1, MAX_TEX / Math.max(width, height));
    const w = Math.max(1, Math.round(width * s));
    const h = Math.max(1, Math.round(height * s));
    if (w === this.size.w && h === this.size.h) return;
    this.size = { w, h };
    this.renderer.setSize(w, h, false);
    (this.material.uniforms.uResolution.value as THREE.Vector2).set(w, h);
  }

  /** Пропорции окна кадра (4:5 для одиночного снимка, другие — для ячеек композиции). */
  setFrameAspect(aspect: number) {
    this.material.uniforms.uFrameAspect.value = aspect;
  }

  /** Карта глубины текущего кадра; null — параллакса и тумана нет. */
  setDepth(img: HTMLImageElement | null) {
    if (img === this.currentDepth) return;
    this.currentDepth = img;
    const U = this.material.uniforms;
    U.uDepth.value = img ? this.texture(img) : this.flatDepth;
    U.uHasDepth.value = img ? 1 : 0;
  }

  private texture(src: PhotoSource): THREE.Texture {
    let t = this.textures.get(src);
    if (!t) {
      // у видео размер берётся из самих кадров — нужен VideoTexture (texImage2D вместо texStorage)
      t = isVideo(src) ? new THREE.VideoTexture(src) : new THREE.Texture(src);
      t.minFilter = THREE.LinearFilter;
      t.magFilter = THREE.LinearFilter;
      t.generateMipmaps = false;
      t.needsUpdate = true;
      this.textures.set(src, t);
    }
    return t;
  }

  /** Освободить текстуру источника, который больше не нужен (видео оживления убрали). */
  forget(src: PhotoSource) {
    this.textures.get(src)?.dispose();
    this.textures.delete(src);
    if (this.current.includes(src)) this.current = [null, null, null];
  }

  /** a — текущий кадр, b — следующий (наплыв), c — второй кадр двойной экспозиции. */
  setPhotos(a: PhotoSource, b: PhotoSource = a, c: PhotoSource = b) {
    const next = [a, b, c];
    if (next.every((src, i) => src === this.current[i])) return;
    this.current = next;
    const U = this.material.uniforms;
    (['A', 'B', 'C'] as const).forEach((slot, i) => {
      U[`uPhoto${slot}`].value = this.texture(next[i]);
      U[`uAspect${slot}`].value = aspectOf(next[i]);
    });
  }

  setParams(p: ShaderParams) {
    const U = this.material.uniforms;
    for (const [key, value] of Object.entries(p)) {
      const u = U[uniformName(key)];
      if (!u) continue;
      if (Array.isArray(value)) (u.value as THREE.Vector3).set(value[0], value[1], value[2]);
      else u.value = value;
    }
  }

  render(f: FrameState) {
    const U = this.material.uniforms;
    U.uTime.value = f.time;
    U.uDevelop.value = f.develop;
    U.uBeat.value = f.beat;
    U.uRms.value = f.rms;
    U.uSeed.value = f.seed;
    U.uMix.value = f.mix;
    U.uFrameSeed.value = f.frameSeed ?? 0;
    U.uAirTime.value = f.airTime ?? 0;
    (U.uParallax.value as THREE.Vector2).set(f.parallax?.[0] ?? 0, f.parallax?.[1] ?? 0);
    // свежий кадр видео — в текстуру (requestVideoFrameCallback у видео вне страницы срабатывает не везде)
    for (const src of this.current) {
      if (src && isVideo(src) && src.readyState >= 2) this.texture(src).needsUpdate = true;
    }
    this.renderer.render(this.scene, this.camera);
  }

  dispose() {
    this.flatDepth.dispose();
    this.textures.forEach((t) => t.dispose());
    this.material.dispose();
    this.renderer.dispose();
  }
}
