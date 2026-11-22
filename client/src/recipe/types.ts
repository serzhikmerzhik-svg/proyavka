// Модель данных по SPEC.md §3. Recipe — контракт между анализом и рендером.

export type ProcessId =
  | 'cyanotype' | 'autochrome' | 'kodachrome' | 'instant' | 'trichrome'
  | 'push_montage' | 'double_exposure' | 'platinum' | 'solarization';

export type TimeOfDay = 'morning' | 'day' | 'golden_hour' | 'evening' | 'night' | 'unknown';
export type Season = 'winter' | 'spring' | 'summer' | 'autumn' | 'unknown';
export type Air = 'steam' | 'leaves' | 'snow' | 'rain' | 'dust' | 'fog';

export type Atmosphere = { energy: number; tone: number; together: number; special: number };

export type PhotoAsset = {
  blob: Blob;
  width: number;
  height: number;
  takenAt?: string;
  gps?: { lat: number; lon: number };
  palette: string[];
  depth?: Blob;
};

export type SongRef = {
  source: 'deezer' | 'itunes' | 'file' | 'manual';
  id?: string;
  title: string;
  artist: string;
  year?: number;
  genre?: string;
  coverUrl?: string;
  link?: string;
};

export type MusicFeatures = {
  bpm: number;
  beatOffset: number;
  barSeconds: number;
  rmsEnvelope: number[];
  rmsMean: number;
  brightness: number;
  key: string;
  mode: 'major' | 'minor';
  modeConfidence: number;
  era?: 'midcentury' | 'seventies' | 'nineties' | 'digicam' | 'modern';
  /** откуда взяты признаки: пока только ручной ввод */
  source?: 'audio' | 'manual';
};

export type TextAnalysis = {
  atmosphere: Atmosphere;
  label: ProcessId;
  timeOfDay: TimeOfDay;
  season: Season;
  contrast: { has: boolean; cold?: string; warm?: string };
  air: Air[];
  captionQuote: string;
  folderNames: string[];
  voiceStyle: string;
  bestPhotoIndex: number;
  photoNotes: { index: number; scene: string; people: boolean }[];
};

export type Recipe = {
  folderName: string;
  atmosphere: Atmosphere;
  process: { id: ProcessId; weight: number }[];
  palette: string[];
  splitTone?: { shadows: string; highlights: string; amount: number };
  light: { time: TimeOfDay; warmth: number };
  music: MusicFeatures;
  rhythm: { developBars: number; frameHoldBars: number; transition: 'dissolve' | 'cut' };
  composition: 'single' | 'diptych' | 'sequence' | 'strip' | 'contact_sheet';
  bestPhotoIndex: number;
  air: { particles: Air[]; density: number };
  caption: string;
  voice: { style: string; speed: number };
  why: string[];
};

export type Day = {
  id: string;
  date: string;
  folderName: string;
  text: string;
  photos: PhotoAsset[];
  song: SongRef;
  analysis: TextAnalysis & { music: MusicFeatures };
  recipe: Recipe;
  printThumb?: Blob;
  voice?: Blob;
  /** Только свой аудиофайл пользователя (source = 'file'), хранится локально. Чужие превью не храним. */
  audioFile?: Blob;
  /** Запись проявки (MediaRecorder) — memory.webm в папке дня */
  memory?: Blob;
  /**
   * ИИ-оживление (отдельная опция, видео-API): короткий синемаграф кадра дня — двигаются только детали.
   * После проявки подменяет кадр в шейдере; везде помечается «ИИ-оживление».
   */
  motion?: { blob: Blob; photoIndex: number; provider: string; model: string; createdAt: number };
  /** демо-день из public/demo */
  demo?: boolean;
  createdAt: number;
};
