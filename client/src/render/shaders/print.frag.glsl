// Один шейдер для всех девяти процессов (SPEC §6).
// Пресеты — это векторы параметров; рецепт смешивает два пресета по весам на CPU,
// сюда приходят готовые числа: общие параметры и доли эффектов.

varying vec2 vUv;

uniform sampler2D uPhotoA;
uniform sampler2D uPhotoB;
uniform sampler2D uPhotoC;   // второй кадр для двойной экспозиции
uniform float uAspectA;      // ширина / высота кадра A
uniform float uAspectB;
uniform float uAspectC;
uniform float uMix;          // 0 → A, 1 → B (наплыв между кадрами)
uniform float uFrameAspect;  // ширина / высота окна снимка (4:5)
uniform vec2 uResolution;    // px

uniform float uTime;
uniform float uDevelop;      // 0..1
uniform float uBeat;         // импульс на долю 0..1
uniform float uRms;          // 0..1
uniform float uSeed;         // номер доли — меняет зерно
uniform float uFrameSeed;    // номер кадра в композиции — своя «химия» и зерно

// ---- живой снимок ----
uniform sampler2D uDepth;    // карта глубины кадра A: светлее — ближе
uniform float uHasDepth;     // 0, пока карты нет
uniform vec2 uParallax;      // смещение от курсора / гироскопа
uniform float uAirTime;      // фаза частиц: скорость следует за RMS

// ---- вектор процесса ----
uniform float uContrast;
uniform float uSCurve;
uniform float uSaturation;
uniform float uWarmBoost;
uniform float uShadowDensity;
uniform float uLift;
uniform float uFade;
uniform float uGrainSize;
uniform float uGrainAmount;
uniform float uGrainChroma;
uniform float uHalation;
uniform float uVignette;
uniform float uFlash;
uniform vec3 uToneShadows;
uniform vec3 uToneHighlights;
uniform float uToneAmount;
// доли эффектов
uniform float uMonochrome;
uniform float uCyanotype;
uniform float uAutochrome;
uniform float uTrichrome;
uniform float uSolarize;
uniform float uDoubleExposure;
uniform float uGrid;

// ---- рецепт: свет и противоречие ----
uniform float uWarmth;       // -1..1
uniform vec3 uSplitShadows;
uniform vec3 uSplitHighlights;
uniform float uSplitAmount;
uniform float uLowKey;       // ночь
uniform float uLiftShadows;  // утро
uniform float uFog;          // туман растёт с глубиной
uniform float uAirSteam;     // плотности частиц воздуха из рецепта
uniform float uAirLeaves;
uniform float uAirSnow;
uniform float uAirRain;
uniform float uAirDust;
uniform vec3 uPaper;

const vec3 PRUSSIAN = vec3(0.0, 0.192, 0.325); // берлинская лазурь #003153

float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1.0, 0.0)), u.x),
             mix(hash12(i + vec2(0.0, 1.0)), hash12(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 4; i++) {
    v += a * vnoise(p);
    p *= 2.03;
    a *= 0.5;
  }
  return v;
}
float luma(vec3 c) { return dot(c, vec3(0.299, 0.587, 0.114)); }

// object-fit: cover внутри окна 4:5
vec2 coverUv(vec2 uv, float imgAspect) {
  vec2 s = vec2(1.0);
  if (imgAspect > uFrameAspect) s.x = uFrameAspect / imgAspect;
  else s.y = imgAspect / uFrameAspect;
  return (uv - 0.5) * s + 0.5;
}
vec3 photo(vec2 uv) {
  vec3 a = texture2D(uPhotoA, coverUv(uv, uAspectA)).rgb;
  if (uMix < 0.001) return a;
  vec3 b = texture2D(uPhotoB, coverUv(uv, uAspectB)).rgb;
  return mix(a, b, uMix);
}

// Трихром: R, G и B — три отдельные экспозиции; сдвиг между ними растёт на каждой доле.
vec3 photoTrichrome(vec2 uv, vec2 tx) {
  vec2 d = vec2(0.7, 0.45) * tx * uTrichrome * (0.6 + 5.0 * uBeat);
  return vec3(photo(uv + d).r, photo(uv).g, photo(uv - d).b);
}

// Автохром: мозаика окрашенных крахмальных зёрен (красно-оранжевые, зелёные, сине-фиолетовые)
// неправильной формы, 2–3 px. Каждое зерно пропускает свою часть спектра, яркость сохраняется.
vec3 autochrome(vec2 uv, vec3 col) {
  vec2 px = uv * uResolution / max(uGrainSize, 1.0);
  vec2 cell = floor(px);
  float best = 10.0;
  vec2 id = cell;
  for (int j = -1; j <= 1; j++) {
    for (int i = -1; i <= 1; i++) {
      vec2 c = cell + vec2(float(i), float(j));
      float d = length(px - (c + hash22(c)));
      if (d < best) { best = d; id = c; }
    }
  }
  float r = hash12(id * 1.37 + 7.0);
  vec3 filt = r < 0.34 ? vec3(1.0, 0.45, 0.2) : (r < 0.68 ? vec3(0.4, 0.8, 0.3) : vec3(0.42, 0.32, 0.95));
  vec3 passed = filt * dot(col, filt) / dot(filt, filt);
  vec3 m = mix(col, passed, 0.5);
  m *= luma(col) / max(luma(m), 1e-3);
  return mix(m, m * vec3(1.03, 1.0, 0.94) + 0.03, 0.5);
}

// Кривая Сабатье: тон растёт до порога и дальше разворачивается. Пороги у каналов чуть разные —
// отсюда характерные сдвиги цвета в светах.
vec3 sabattier(vec3 c) {
  vec3 t = vec3(0.52, 0.56, 0.6);
  vec3 reversed = t - (c - t);
  return mix(c, reversed, smoothstep(t - 0.08, t + 0.08, c));
}

// Диагональная сетка кадрирования: линии под 45°, шаг — треть ширины кадра.
float cropGrid(vec2 uv) {
  vec2 p = uv * uResolution;
  float stepPx = uResolution.x / 3.0;
  float a = abs(fract((p.x + p.y) / stepPx + 0.5) - 0.5) * stepPx * 0.7071;
  float b = abs(fract((p.x - p.y) / stepPx + 0.5) - 0.5) * stepPx * 0.7071;
  float w = 0.6 + uResolution.x / 900.0;
  return max(1.0 - smoothstep(0.0, w, a), 1.0 - smoothstep(0.0, w, b));
}

// ---- частицы воздуха: процедурные слои в ячейках; плотность — доля занятых ячеек ----
float flakes(vec2 uv, float scale, float fall, float sway, float size, float density, float seed) {
  vec2 p = vec2(uv.x * uFrameAspect, uv.y) * scale;
  p.y += uAirTime * fall;
  p.x += sin(p.y * 0.9 + seed) * sway;
  vec2 cell = floor(p);
  vec2 f = fract(p) - 0.5;
  float on = smoothstep(1.0 - density, 1.0 - density + 0.08, hash12(cell + seed));
  vec2 o = (hash22(cell + seed * 1.7) - 0.5) * 0.6;
  float r = size * (0.6 + 0.8 * hash12(cell + seed * 3.1));
  return on * (1.0 - smoothstep(r * 0.4, r, length(f - o)));
}

float rainStreaks(vec2 uv, float density) {
  vec2 p = vec2(uv.x * uFrameAspect * 26.0 + uv.y * 3.0, uv.y * 6.0 + uAirTime * 7.0);
  vec2 cell = floor(p);
  vec2 f = fract(p);
  float on = step(1.0 - density * 0.7, hash12(cell + 41.0));
  float x = abs(f.x - hash12(cell + 2.0));
  return on * (1.0 - smoothstep(0.0, 0.06, x)) * smoothstep(0.0, 0.3, f.y) * (1.0 - smoothstep(0.6, 1.0, f.y));
}

vec4 fallingLeaves(vec2 uv, float density) {
  vec2 p = vec2(uv.x * uFrameAspect, uv.y) * 5.0;
  p.y += uAirTime * 0.35;
  p.x += sin(p.y * 1.3 + uAirTime * 0.8) * 0.35;
  vec2 cell = floor(p);
  vec2 f = fract(p) - 0.5;
  float h = hash12(cell + 21.0);
  float on = smoothstep(1.0 - density * 0.6, 1.0 - density * 0.6 + 0.05, h);
  float a = uAirTime * (0.8 + h) + h * 6.28;
  vec2 q = f - (hash22(cell + 4.0) - 0.5) * 0.5;
  q = mat2(cos(a), -sin(a), sin(a), cos(a)) * q;
  float mask = on * (1.0 - smoothstep(0.8, 1.0, length(q / vec2(0.16, 0.07))));
  vec3 c = mix(vec3(0.78, 0.36, 0.12), vec3(0.85, 0.62, 0.18), hash12(cell + 9.0));
  return vec4(c, mask * 0.9);
}

float steamWisps(vec2 uv) {
  float n = fbm(vec2(uv.x * 5.0, uv.y * 2.2 - uAirTime * 0.35) + uFrameSeed * 3.7);
  float rise = smoothstep(0.05, 0.45, uv.y) * (1.0 - smoothstep(0.55, 1.0, uv.y));
  return smoothstep(0.55, 0.8, n) * rise;
}

void main() {
  vec2 tx = 1.0 / uResolution;
  // Живой снимок: параллакс uv + (depth − 0.5) · uParallax; лёгкий зум прячет края при сдвиге
  float depth = uHasDepth > 0.5 ? texture2D(uDepth, coverUv(vUv, uAspectA)).r : 0.5;
  vec2 uv = (vUv - 0.5) * (1.0 - 0.03 * uHasDepth) + 0.5 + (depth - 0.5) * uParallax;

  // 1. Съёмка: трихром, мягкость автохрома, ореолы
  vec3 sharp = uTrichrome > 0.001 ? photoTrichrome(uv, tx) : photo(uv);
  vec3 nR = photo(uv + vec2(1.5 * tx.x, 0.0));
  vec3 nL = photo(uv - vec2(1.5 * tx.x, 0.0));
  vec3 nU = photo(uv + vec2(0.0, 1.5 * tx.y));
  vec3 nD = photo(uv - vec2(0.0, 1.5 * tx.y));
  vec3 col = mix(sharp, sharp * 0.4 + 0.15 * (nR + nL + nU + nD), 0.8 * uAutochrome);
  vec3 wide = 0.25 * (photo(uv + vec2(7.0, 7.0) * tx) + photo(uv + vec2(-7.0, 7.0) * tx)
                    + photo(uv + vec2(7.0, -7.0) * tx) + photo(uv + vec2(-7.0, -7.0) * tx));
  float glow = smoothstep(0.62, 1.0, luma(wide));

  // 2. Двойная экспозиция: экранное смешивание со вторым кадром (отражённым, если кадр один)
  if (uDoubleExposure > 0.001) {
    vec2 duv = (uv - 0.5) * vec2(-0.92, 0.92) + 0.5 + vec2(0.0, 0.02 * sin(uTime * 0.2));
    vec3 second = texture2D(uPhotoC, coverUv(duv, uAspectC)).rgb * 0.85;
    col = mix(col, 1.0 - (1.0 - col) * (1.0 - second), uDoubleExposure);
  }

  // 3. Автохром: мозаика зёрен
  col = mix(col, autochrome(vUv, col), uAutochrome);

  // 4. Тональная кривая: насыщенность (Kodachrome — красные и жёлтые сильнее), контраст, S-кривая, тени
  float l = luma(col);
  float warm = clamp((col.r - col.b) * 2.5, 0.0, 1.0) * clamp((col.r + col.g - 2.0 * col.b) * 2.0, 0.0, 1.0);
  col = l + (col - l) * (uSaturation + uWarmBoost * warm);
  col = clamp((col - 0.5) * uContrast + 0.5, 0.0, 1.0);
  col = mix(col, col * col * (3.0 - 2.0 * col), uSCurve);
  col = mix(col, col * col * (3.0 - 2.0 * col), uSCurve * 0.6);
  col *= mix(1.0, smoothstep(0.0, 0.6, luma(col)), uShadowDensity);

  // 5. Монохром и тонирование процесса
  l = luma(col);
  col = mix(col, vec3(l), uMonochrome);
  // цианотипия: яркость → градиент от берлинской лазури к цвету бумаги
  vec3 cyan = mix(PRUSSIAN, uPaper * vec3(0.97, 0.99, 1.0), smoothstep(0.02, 0.95, pow(l, 0.85)));
  col = mix(col, cyan, uCyanotype);
  // соляризация: кривая Сабатье + линии Маки на резких переходах
  if (uSolarize > 0.001) {
    vec3 sab = sabattier(col);
    float edge = length(vec2(luma(nR) - luma(nL), luma(nU) - luma(nD)));
    sab *= 1.0 - 0.55 * smoothstep(0.06, 0.22, edge);
    col = mix(col, sab, uSolarize);
  }
  // тон процесса: платина — тёплый нейтральный, моментальное фото — циан в тенях и тёплые света
  l = luma(clamp(col, 0.0, 1.0));
  vec3 tone = mix(uToneShadows, uToneHighlights, smoothstep(0.1, 0.9, l));
  col = mix(col, col * tone / max(luma(tone), 0.05), uToneAmount);

  // 6. Свет рецепта: температура, сплит-тонирование противоречия, ночь, утро
  col *= vec3(1.0 + 0.12 * uWarmth, 1.0 + 0.02 * uWarmth, 1.0 - 0.14 * uWarmth);
  l = luma(clamp(col, 0.0, 1.0));
  vec3 split = mix(uSplitShadows, uSplitHighlights, smoothstep(0.15, 0.85, l));
  col = mix(col, col * split / max(luma(split), 0.05), uSplitAmount);
  col = pow(max(col, 0.0), vec3(1.0 + 0.35 * uLowKey));
  col += uLiftShadows * 0.1 * (1.0 - col);

  // туман растёт с глубиной: дальнее (тёмное на карте) уходит в дымку; без карты тумана нет
  float far = (1.0 - depth) * uHasDepth;
  col = mix(col, mix(vec3(0.82, 0.84, 0.86), uPaper, 0.4), clamp(uFog * pow(far, 1.3), 0.0, 0.85));

  // 7. Ореолы (у цветной плёнки красноватые, у монохрома нейтральные), вспышка, выцветание, виньетка
  col += glow * uHalation * mix(vec3(1.0, 0.45, 0.25), vec3(1.0, 0.93, 0.85), uMonochrome) * 0.6;
  vec2 d = vUv - 0.5;
  d.x *= uFrameAspect;
  float r = length(d);
  col += uFlash * 0.28 * (1.0 - smoothstep(0.0, 0.55, r)) * (1.0 - col);
  col = uLift + col * (1.0 - uLift - 0.15 * uFade);
  col = mix(col, vec3(luma(col)) * vec3(1.0, 0.97, 0.9), 0.25 * uFade);
  col *= mix(1.0, smoothstep(0.85, 0.25, r), uVignette);

  // Частицы воздуха — ближе всего к зрителю (сдвигаются сильнее), появляются к концу проявки;
  // плотность следует за RMS
  float air = smoothstep(0.85, 1.0, uDevelop) * (0.6 + 0.8 * uRms);
  vec2 auv = vUv + uParallax * 0.6;
  if (uAirSnow > 0.001) {
    float s = flakes(auv, 9.0, 0.6, 0.25, 0.12, uAirSnow * air, 1.0) + flakes(auv, 16.0, 0.9, 0.2, 0.09, uAirSnow * air * 0.8, 7.0);
    col = mix(col, vec3(0.97), clamp(s, 0.0, 1.0) * 0.9);
  }
  if (uAirRain > 0.001) col = mix(col, vec3(0.85, 0.88, 0.92), rainStreaks(auv, uAirRain * air) * 0.35);
  if (uAirDust > 0.001) {
    float s = flakes(auv, 22.0, -0.05, 0.4, 0.06, uAirDust * air * 0.7, 13.0);
    col += vec3(1.0, 0.95, 0.85) * s * (0.15 + 0.5 * luma(col));
  }
  if (uAirLeaves > 0.001) {
    vec4 lf = fallingLeaves(auv, uAirLeaves * air);
    col = mix(col, lf.rgb * (0.7 + 0.3 * luma(col)), lf.a);
  }
  if (uAirSteam > 0.001) col = mix(col, vec3(0.97), steamWisps(auv) * 0.22 * clamp(uAirSteam * air, 0.0, 1.0));

  // 8. Зерно: зависит от яркости (сильнее в средних тонах), новый seed на каждой доле
  l = luma(clamp(col, 0.0, 1.0));
  vec2 gcell = floor(vUv * uResolution / max(uGrainSize * 0.6, 1.0)) + uSeed * 17.13 + uFrameSeed * 31.7;
  vec3 chroma = vec3(hash12(gcell + 3.1), hash12(gcell + 7.7), hash12(gcell + 11.3)) - 0.5;
  vec3 grain = mix(vec3(hash12(gcell) - 0.5), chroma, uGrainChroma);
  col += grain * uGrainAmount * (0.35 + 4.0 * l * (1.0 - l)) * 0.5;

  // 9. Диагональная сетка кадрирования (пуш-монтаж)
  if (uGrid > 0.001) col = mix(col, vec3(0.93), cropGrid(vUv) * 0.32 * uGrid);

  // «дыхание» снимка
  col *= 1.0 + 0.04 * (uRms - 0.5);
  col = clamp(col, 0.0, 1.0);

  // 10. Проявка: бумага сначала белая; тени проступают раньше светов;
  // неравномерность — низкочастотный шум «химии», который медленно плывёт.
  float chem = fbm(vUv * 3.0 + vec2(uFrameSeed * 7.13, uTime * 0.03));
  float threshold = luma(col) * 0.55 + chem * 0.35;
  float reveal = smoothstep(threshold, threshold + 0.25, uDevelop * 1.15);
  gl_FragColor = vec4(mix(uPaper, col, reveal), 1.0);
}
