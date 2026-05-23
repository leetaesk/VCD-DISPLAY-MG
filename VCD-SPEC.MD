# VCD — 시야 보정 디스플레이 (Vision-Corrected Display)

> **이 문서는 새 React 프로젝트에서 VCD를 처음부터 구현하기 위한 자급식 명세서다.**
> 기존 바닐라 JS 구현은 폐기 예정이며, 이 문서만 보고 동일 동작을 재현할 수 있어야 한다.

작성일: 2026-05-22 · 대상 스택: React 18 + Vite + TypeScript + Tailwind + React Router v6 + Zustand

---

## 0. 한 줄 요약

브라우저 카메라/디스플레이만으로 사용자의 굴절 이상·대비 감도·색각·시야 결함을 측정한 뒤, WebGL2 Wiener 디컨볼루션으로 화면 콘텐츠를 **사전 역보정**해서 보이게 한다. 안경/렌즈 없이 더 선명하게 보이는 디스플레이를 만드는 게 목표.

---

## 1. 도메인 개념 (필수 이해)

### 1.1 PSF (Point Spread Function)
사람의 눈에 들어온 점광원이 망막에 맺힐 때 얼마나 퍼지는지를 나타내는 함수. 정상 눈은 거의 점에 가깝지만, 굴절 이상이 있으면 흐릿하게 번진다.

### 1.2 Wiener 디컨볼루션
콘텐츠가 흐릿하게 보이는 게 PSF에 의한 컨볼루션이라고 보면, **그 역연산을 미리 화면에 적용**해두면 눈을 통과한 결과가 원본에 가까워진다. 노이즈 증폭 문제 때문에 정칙화 항 K가 필요:

```
G(u,v) = F(u,v) · conj(H(u,v)) / (|H(u,v)|² + K)
```

- `F` = 원본 콘텐츠의 FFT
- `H` = PSF의 FFT (OTF)
- `G` = 화면에 표시할 사전보정 신호의 FFT
- `K` = 노이즈/디테일 트레이드오프 상수 (~1e-5 ~ 1e-1, 슬라이더로 조정)

### 1.3 Zernike 다항식
파면 수차를 표준 기저로 분해한 계수. 굴절 처방(SPH/CYL/AXIS)을 Zernike c3/c4/c5로 변환해서 PSF 생성에 사용 (Thibos 2002).

### 1.4 보정 파이프라인 단계
```
M1: 굴절 → PSF 생성        (CPU, vcd-pipeline)
M2: Amsler 시야 결함 리맵    (GPU shader)
M3: 색각 보정 (Daltonization) (GPU shader)
M4: Wiener 디컨볼루션         (GPU, FFT 기반)
```

현재 M1+M4 완성, M2/M3는 셰이더만 있음(통합 진행 중).

---

## 2. 기술 스택 (확정)

| 계층 | 선택 |
|------|------|
| 빌드/Dev | Vite 5 |
| 언어 | TypeScript (strict) |
| UI | React 18 |
| 라우팅 | React Router v6 (BrowserRouter, 해시 라우팅 X) |
| 상태 | Zustand + persist 미들웨어 (localStorage 동기화) |
| 스타일 | Tailwind CSS 3 |
| 차트 | Chart.js 4 (CSF 곡선) |
| 얼굴 인식 | `@mediapipe/tasks-vision` 0.10.14 (FaceLandmarker) |
| 배포 | Vercel (정적) |

**제거된 것**: hash 라우터, IIFE, 전역 window 객체, jsdelivr CDN script 태그.

---

## 3. 권장 디렉토리 구조

```
src/
  main.tsx
  App.tsx                          # 라우터 + 레이아웃
  routes.tsx                       # 라우트 정의
  
  layouts/
    AppLayout.tsx                  # 사이드바 + 모바일 하단바
    SidebarNav.tsx
    
  pages/
    HomePage.tsx
    CalibrationPage.tsx
    RefractionPage.tsx
    VisionPage.tsx
    CsfPage.tsx
    ColorPage.tsx
    AmslerPage.tsx
    ProfilePage.tsx
    PreviewPage.tsx
    CameraPage.tsx
    WebglTestPage.tsx              # debug
    
  features/
    calibration/
      CardCalibration.tsx          # Step 1
      DistanceCalibration.tsx      # Step 2
      CalibrationSummary.tsx       # Step 3
      
    refraction/
      DefocusStaircase.tsx
      AstigmatismFanChart.tsx
      
    vision/
      LogMarStaircase.tsx
      
    csf/
      TwoAFCStaircase.tsx
      CsfChart.tsx
      
    color/
      IshiharaPlates.tsx
      FmHundredSort.tsx
      
    amsler/
      AmslerGrid.tsx
      
    camera-correction/
      VcdCanvas.tsx
      PerformanceHud.tsx
      
  hooks/
    useVcdProfile.ts               # Zustand selector hooks
    useCamera.ts                   # getUserMedia wrapper
    useFaceLandmarker.ts           # MediaPipe lifecycle
    useEyeTracker.ts               # 랜드마크 → 거리/시선
    useWebGL.ts                    # WebGL2 context + extensions
    usePsfCache.ts                 # 굴절값 키로 PSF 캐싱
    useAnimationLoop.ts            # RAF
    
  lib/
    profile-store.ts               # Zustand store
    psf-pipeline.ts                # M1: 굴절 → Zernike → 파면 → PSF
    fft-cpu.ts                     # Cooley-Tukey FFT (검증용 ground truth)
    fft-gpu.ts                     # Stockham GPU FFT 러너
    wiener-gpu.ts                  # M4 Wiener 파이프라인
    color-matrices.ts              # Machado 2009 dichromacy 행렬
    csf-normative.ts               # Pelli & Bex 2013 정상 범위
    psychophysics.ts               # 계단식 검사 유틸 (3-down/1-up 등)
    distance-from-ipd.ts           # 핀홀 카메라 모델
    constants.ts                   # 카드 mm, FOV, IPD 평균 등
    
  shaders/                         # 기존 GLSL 그대로 복사
    wiener.vert
    fft.frag
    gray-pack.frag
    vcd-blend.frag
    output.frag
    color-correct.frag
    binocular-blend.frag
    complex-mul.frag
    
  types/
    profile.ts                     # VCDProfile 타입 정의
    refraction.ts
    eye-tracker.ts
```

---

## 4. 라우트 구성

| 경로 | 컴포넌트 | 책임 |
|------|---------|------|
| `/` | HomePage | 진행 상황 카드 + 다음 단계 추천 |
| `/calibration` | CalibrationPage | 3단계: PPI → 거리 → 확인 |
| `/refraction` | RefractionPage | SPH/CYL/AXIS 측정 (양안) |
| `/vision` | VisionPage | LogMAR 시력 |
| `/csf` | CsfPage | 대비 감도 7주파수 |
| `/color` | ColorPage | Ishihara + FM100 |
| `/amsler` | AmslerPage | 시야 결함 작도 |
| `/profile` | ProfilePage | 결과 요약 + 가져오기/내보내기 |
| `/preview` | PreviewPage | 4패널 정적 시뮬레이션 |
| `/camera` | CameraPage | 실시간 카메라 보정 |
| `/debug/webgl` | WebglTestPage | 단위 테스트 + Wiener 데모 |

**라우트 가드**: `/refraction`은 calibration 필요, `/vision /csf /color /amsler /preview /camera`는 refraction 필요. 미충족 시 안내 화면 + 리다이렉트 버튼.

---

## 5. 상태 관리 (Zustand)

### 5.1 스토어 형상

```typescript
type RxEye = { sph: number; cyl: number; axis: number; confidence: number };

interface VCDProfile {
  user_id: string;                        // crypto.randomUUID()
  calibration?: {
    screen_ppi: number;                   // CSS 픽셀 기준
    screen_width_mm: number;
    viewing_distance_cm: number;
    distance_source: 'mediapipe_ipd' | 'manual';
    calibration_timestamp: string;        // ISO8601
  };
  refraction?: { od: RxEye; os: RxEye; confidence: number };
  logmar?: { od: number; os: number; confidence: number };
  csf_curve?: {
    od: { freqs: number[]; thresholds: number[]; classification: string };
    os: { freqs: number[]; thresholds: number[]; classification: string };
  };
  color_vision?: {
    type: 'normal' | 'protanomaly' | 'deuteranomaly' | 'tritanomaly' | 'achromatopsia';
    severity: number;                     // [0, 1]
    correction_matrix: number[];          // 9 elements row-major
  };
  amsler_map_od?: string;                 // base64 PNG 256×256
  amsler_map_os?: string;
  zernike?: { od: ZernikeCoef; os: ZernikeCoef }; // c3, c4, c5
  onboarding_seconds?: number;            // 양안 VCD 누적 시간
  updated_at: string;
}
```

### 5.2 영속화

```typescript
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const useProfileStore = create<ProfileState>()(
  persist(
    (set, get) => ({ /* ... */ }),
    {
      name: 'vcd.profile.v2',             // v1은 기존 바닐라용, 충돌 방지
      version: 2,
      migrate: (oldState, version) => { /* v1 import 옵션 */ }
    }
  )
);
```

**탭 간 동기화**: zustand persist는 storage 이벤트로 자동 동기화하지 않음. 별도 구독 필요:
```typescript
useEffect(() => {
  const onStorage = (e: StorageEvent) => {
    if (e.key === 'vcd.profile.v2') useProfileStore.persist.rehydrate();
  };
  window.addEventListener('storage', onStorage);
  return () => window.removeEventListener('storage', onStorage);
}, []);
```

### 5.3 액션

- `setCalibration(data)`, `setRefraction(data)`, ... — 단위 페이지별 setter
- `update(fn: (draft) => void)` — Immer 스타일 부분 업데이트 (Zustand의 set 콜백)
- `reset()` — 확인 다이얼로그 후 전체 초기화
- `exportJson(): string`, `importJson(json: string): boolean` — 파일 입출력
- `getNextStep(): RouteName | null` — 추천 다음 검사

---

## 6. 페이지 명세

### 6.1 캘리브레이션 (`/calibration`)

3단계 스테퍼. 게이트 없음 (앱의 가장 첫 단계).

**Step 1 — 화면 PPI**

신용카드 절반(오른쪽)을 화면에 대고 슬라이더로 크기 일치시킴.
- 카드 실측: 85.6mm × 53.98mm (ISO/IEC 7810 ID-1)
- **반쪽 카드 사용 이유**: 모바일 가로 폭 제약 회피. 가로 42.8mm만 매칭.
- 슬라이더 초기값: `round(42.8 × 96 × devicePixelRatio / 25.4)` — DPR 기반 추정
- PPI 계산: `(slider_px / 42.8) × 25.4`
- 모니터 폭(mm) = `(screen.width / ppi) × 25.4` — 디버그/UX용

UI 요구사항:
- 카드 비주얼: 오른쪽 절반만 표시 (왼쪽이 dashed border = 절단면 표시)
- 슬라이더는 카드 **위에** 위치 (카드 높이 변화가 슬라이더 위치를 안 흔들도록)
- "기기 기본값" 별도 버튼 없음 — 초기값이 그 역할

**Step 2 — 시청 거리**

페이지 진입 즉시 `getUserMedia` 호출 → 자동으로 카메라 권한 요청.
- MediaPipe FaceLandmarker로 외안각(landmarks 33, 263) 검출
- 핀홀 카메라 모델: `distance_cm = (IPD_mm × focal_px) / IPD_detected_px / 10`
- `IPD_mm = 63` (성인 평균)
- `focal_px = (video_width / 2) / tan(70° / 2)` — 모바일 전면 카메라 평균 FOV
- 5초 샘플링, 중앙값 기준 ±5cm 이내만 채택, 산술평균
- 비디오는 좌우반전 해제 (`transform: scaleX(-1)` on `<video>`)
- 카메라 실패/거부 시: 인라인 에러 카드 + 수동 입력 폴백 (20~120cm)

**Step 3 — 확인**
- 측정값 표시, "굴절 검사 시작" 또는 "다시 측정"

**저장**: `VCDProfile.calibration`

---

### 6.2 굴절 검사 (`/refraction`)

게이트: calibration 필요.

**개요**: 양안 각각, 두 스테이지.

**Stage A — Defocus Staircase (SPH)**
1. 부호 사전 질문 (근시/원시/모름) → 1회만, 미응답 시 절댓값만 측정 (confidence 페널티)
2. 3라운드 점층적 정밀화: ±3D(step 1D) → ±1D(0.5D) → ±0.5D(0.25D)
3. 매 라운드: LogMAR 0.5 글자(20/63)를 시뮬레이션 blur로 여러 강도 렌더링
4. 사용자가 가장 선명한 것 선택
5. Blur 시그마: `σ_px = |defocus_D| × (PPI × distance_cm / 2540 / 60)` — Canvas 2D `ctx.filter='blur(Npx)'`
6. 글자 크기 하한 `MIN_RELIABLE_LETTER_PX = 5` 미만이면 경고

**Stage B — 난시 팬 차트 (CYL, AXIS)**
1. 12방향 선 (15° 간격, 0°~165°)
2. 가장 선명한 방향 클릭 → AXIS
3. 수직 대비 점수 1~5 슬라이더 → CYL: `{1:0, 2:-0.5, 3:-1.0, 4:-1.5, 5:-2.0}`

**Confidence 계산**:
- 기본 = 반전점 일관성 점수
- Edge sample 선택 시 × 0.8
- 부호 미응답 시 max 0.6

**저장**: `VCDProfile.refraction`, `VCDProfile.zernike` (자동 파생)

---

### 6.3 LogMAR 시력 (`/vision`)

게이트: refraction 권장 (없으면 진행 가능, cross-check만 생략).

- Sloan 10글자: `C D H K N O R S V Z`
- 5글자 행, 적응형 계단식
- 시작 LogMAR +0.3 (20/40), 범위 [-0.3, +1.0]
- 정답 ≥3/5 → 한 단계 작게(step 0.1), 미만 → 크게
- 같은 LogMAR 2회 재방문 시 수렴
- 글자 픽셀 크기: `letter_px = 5 × tan(arcmin × π/(180×60)) × distance_cm × ppi / 2.54`
  - 여기서 arcmin = `5 × 10^LogMAR` (LogMAR 0.0 = 5 arcmin per stroke)
- 입력: 클릭/탭 또는 키보드 (C,D,H,K,N,O,R,S,V,Z)
- Cross-check: |LogMAR - |SPH| × 0.1| > 0.3 → 사용자 확인 권유

**저장**: `VCDProfile.logmar`

---

### 6.4 CSF 대비 감도 (`/csf`)

- 7개 공간 주파수: 0.5 / 1 / 2 / 4 / 8 / 12 / 16 cpd
- 2AFC: 좌/우 박스 중 어느 쪽에 sine grating이 있는지
- 3-down/1-up 계단식 (대비를 contrast factor로 ×/÷)
- 초기 contrast 0.8, step factor 2.0 → √2 (반전 2회 이후)
- 6회 반전점 수렴, 마지막 4회 기하평균 = 역치
- 화면 분해능 한계: `<2.5px/cycle`이면 자동 스킵
- 입력: A/L 키 또는 좌/우 화살표 (모바일은 큰 탭 영역)
- 결과: Chart.js로 log-log 곡선 + Pelli&Bex 2013 정상 범위 밴드 오버레이
- 분류: normal / high_freq / mid_freq / global / mixed (Z-score 패턴 분석)

**저장**: `VCDProfile.csf_curve`

---

### 6.5 색각 검사 (`/color`)

**Stage A — Ishihara 유사판**
- 10장 dot mosaic, Machado 혼동선 기반 색 배치
- 사용자가 보이는 숫자 입력 또는 "안 보임" 선택
- 결과: protan/deutan/tritan 후보 점수

**Stage B — FM100 간소화**
- 16개 색조 캡 (22.5° 간격) 드래그 정렬
- 양 끝 anchor 고정, 가운데 14개 정렬
- 결과: 인접쌍 반전 횟수 → severity (0~1)

**Daltonization**:
- Machado 2009 시뮬레이션 행렬 `M_sim` 분류 결과로 선택
- 보정 행렬 `M_correct = 2I − M_sim`
- 심도 혼합: `M_final = (1−s)·I + s·M_correct`
- 9-element 행 우선 배열로 저장 (셰이더 mat3 uniform용)

**저장**: `VCDProfile.color_vision`

---

### 6.6 Amsler 시야 (`/amsler`)

- 20×20 격자, 양안 각각
- 도구 3개: 왜곡(반투명 빨강) / 결손(불투명 어둠) / 지우개
- Pointer Events (터치/마우스/펜), Bresenham 선 보간
- 256×256 마스크 → base64 PNG
- 분석: 무게중심 → central/paracentral/peripheral, superior/inferior 분류
- 패턴 분류: macular_suspect / glaucoma_suspect / neural_suspect / minor / mixed / normal

**저장**: `VCDProfile.amsler_map_od`, `amsler_map_os`

---

### 6.7 프로파일 (`/profile`)

- 7개 측정 카드: 각 검사 결과 + 타임스탬프
- PSF 미리보기 (OD/OS, 64×64 canvas, sqrt 스트레치)
- 버튼: JSON 내보내기, JSON 가져오기 (스키마 검증), 초기화 (확인 다이얼로그)
- 다음 단계 추천 알고리즘: calibration → refraction → logmar → csf → color → amsler

---

### 6.8 미리보기 (`/preview`)

게이트: refraction 필요.

- 4패널 256×256 grid:
  1. 원본 이미지
  2. VCD 없이 본 모습 (`IFFT(F × H)`)
  3. 화면 출력 신호 (Wiener 사전보정 결과)
  4. VCD 적용 후 본 모습 (`IFFT(F_display × H)`)
- 콘텐츠 선택: 텍스트 / 샘플 사진 / 업로드
- 눈 선택 (OD/OS)
- K 슬라이더 5단계 (`1e-5, 1e-4, 1e-3, 1e-2, 1e-1`)
- RMS 개선도 표시
- 캐싱: PSF/H는 눈/굴절 변경 시만 재계산, K만 바꾸면 ~30ms Wiener pass만 재실행

---

### 6.9 카메라 보정 (`/camera`)

게이트: refraction 필요.

- `getUserMedia` → `<video>` → WebGL2 texture 업로드 → 전체 파이프라인 → `<canvas>`
- 모드:
  - **Grayscale (VCD)**: M1+M4 전체 파이프라인
  - **Color**: M2(field-remap) + M3(daltonization) 단일 패스 (Wiener 없음)
- 토글: 눈(OD/OS), 양안 모드, VCD 켜기/끄기, 디버그 오버레이
- 슬라이더: K, 색보정 강도, field-remap 강도
- 자동 해상도 조정:
  - 30ms 초과 30프레임 연속 → 256→128→64 다운스케일
  - 15ms 미만 60프레임 → 한 단계 업스케일
- 양안 모드: MediaPipe FaceLandmarker로 시선 추적, OD/OS 가중치 sigmoid
- 온보딩 곡선: VCD+양안 활성 시간 누적, 강도 0.2 → 1.0 (sigmoid, 15분 절반)

---

### 6.10 WebGL 디버그 (`/debug/webgl`)

- 환경 체크 (WebGL2 + EXT_color_buffer_float)
- 12개 단위 테스트: CPU FFT round-trip, 임펄스, GPU FFT round-trip, CPU↔GPU 일치, M1 zero/sphere 검증, ifftshift, PSF 에너지 보존, defocus spread, N=256 일치 등
- Wiener 데모: K 슬라이더 + 5캔버스 (원본/PSF/blurred/restored/diff)
- M1 PSF: 굴절 슬라이더 + Zernike/wavefront/PSF 시각화
- End-to-end VCD 시뮬

---

## 7. 핵심 알고리즘

### 7.1 굴절 → Zernike (Thibos 2002)

입력: `sph_D`, `cyl_D`, `axis_deg`, `pupil_radius_mm`
출력: `c3`, `c4`, `c5` (μm 단위, OSA 표준)

```typescript
function refractionToZernike(rx: RxEye, pupilR_mm: number): ZernikeCoef {
  const S = rx.sph;
  const C = rx.cyl;
  const A = (rx.axis * Math.PI) / 180;
  const R = pupilR_mm;
  const R2 = R * R;
  
  // OSA convention (Thibos 2002)
  const c3 = -C * R2 * Math.sin(2 * A) / (4 * Math.sqrt(6));
  const c4 = -(S + C / 2) * R2 / (4 * Math.sqrt(3));
  const c5 = -C * R2 * Math.cos(2 * A) / (4 * Math.sqrt(6));
  
  return { c3, c4, c5 };
}
```

검증: `−1D sphere → c4 ≈ +1.30 μm` (pupil R=3mm)

### 7.2 Zernike → 파면 → PSF

```typescript
function computeWavefront(z: ZernikeCoef, N: number, pupilR_px: number) {
  // ρ, θ를 N×N grid에 채우고, 정규화 ρ ∈ [0, 1]
  // 마스크: 1 if ρ ≤ 1 else 0
  // W(ρ,θ) = mask × ( c3·√6·ρ²·sin(2θ) + c4·√3·(2ρ²−1) + c5·√6·ρ²·cos(2θ) )
}

function wavefrontToPSF(W: Float64Array, mask: Float64Array, N: number): Float64Array {
  // P(x,y) = mask · exp(i · 2π · W / λ)        (λ ≈ 555nm)
  // PSF = |FFT2(P)|² , normalize so sum(PSF) = 1
  // fftshift to center
}
```

### 7.3 CPU FFT (검증용)

Cooley-Tukey radix-2 반복형, Float64Array, bit-reversal 사전 계산. GPU 결과 검증 ground truth로만 사용.

### 7.4 GPU FFT (Stockham)

- Stockham auto-sort (bit-reversal 불필요)
- Row passes → Column passes
- 각 stage: `fft.frag` 한 번 draw call, ping-pong (fftA ↔ fftB)
- 텍스처 RGBA32F: R=real, G=imag

### 7.5 IPD → 거리 (calibration step 2)

```typescript
const IPD_MM = 63;
const FOV_DEG = 70;

function distanceFromOuterCanthi(
  landmarks: NormalizedLandmark[], videoW: number, videoH: number
): number | null {
  const lo = landmarks[33];
  const ro = landmarks[263];
  const dx = (ro.x - lo.x) * videoW;
  const ipdPx = Math.abs(dx);                              // 외안각 가로 거리 ≈ IPD px
  if (ipdPx < 20 || ipdPx > 600) return null;
  const focalPx = videoW / (2 * Math.tan(FOV_DEG * Math.PI / 360));
  return (IPD_MM * focalPx) / ipdPx / 10;                  // cm
}
```

### 7.6 CSF 정상 범위 (Pelli & Bex 2013)

상수 테이블 (대수 평균 + σ, young normal observer):
```
freq(cpd):   0.5    1      2      4      8      12     16
mean log:    1.7    1.95   2.15   2.20   2.05   1.75   1.30
sigma log:   0.18   0.18   0.18   0.18   0.20   0.22   0.25
```

분류: 채널별 Z-score `(log_threshold − mean) / sigma`. >2.5 이상이면 비정상.

### 7.7 Daltonization (Machado 2009)

각 dichromacy 유형별 시뮬레이션 행렬 `M_sim`은 severity 0~1로 보간된 행렬 테이블 (Machado 2009 Table 3). 9개의 3×3 행렬을 0.1 step으로 보간.

```typescript
function buildCorrectionMatrix(type: ColorDeficiency, severity: number): mat3 {
  const Msim = lookupSeverityMatrix(type, severity);
  const Mcorrect = subtract(scale(I, 2), Msim);            // 2I − M_sim
  return blend(I, Mcorrect, severity);                     // (1−s)·I + s·M_correct
}
```

---

## 8. GLSL 셰이더 (그대로 복사)

기존 `vcd-app/shaders/` 9개 파일을 `src/shaders/`로 그대로 복사. Vite의 `?raw` 임포트로 문자열 로드:

```typescript
import fftFrag from './shaders/fft.frag?raw';
import wienerVert from './shaders/wiener.vert?raw';
// ...
```

각 셰이더의 역할은 §1.4 파이프라인 단계 + §6.9의 모드 참조.

---

## 9. MediaPipe 통합

```typescript
import { FaceLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

const vision = await FilesetResolver.forVisionTasks(
  'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
);

const landmarker = await FaceLandmarker.createFromOptions(vision, {
  baseOptions: {
    modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task',
    delegate: 'GPU'
  },
  runningMode: 'VIDEO',
  numFaces: 1,
  minFaceDetectionConfidence: 0.5,
  minFacePresenceConfidence: 0.5,
  minTrackingConfidence: 0.5
});
```

**중요**: legacy `@mediapipe/face_mesh` + `@mediapipe/camera_utils`는 절대 사용 금지. Camera utility 타이밍 버그 때문에 이번에 옮긴 것임. `detectForVideo`는 **동기** 호출이므로 `await` 불필요.

**랜드마크 인덱스**:
- 468 OD 홍채 중심, 469~472 OD 홍채 경계
- 473 OS 홍채 중심, 474~477 OS 홍채 경계
- 33 좌안 외안각, 263 우안 외안각 (거리 측정용)

`useFaceLandmarker` 훅이 init/dispose 라이프사이클 관리. `useEyeTracker(videoRef)` 훅이 RAF 루프 + 결과 노출.

---

## 10. 모바일 UX 원칙

이 앱의 1차 사용 환경은 **모바일 브라우저**. 데스크톱은 부차적.

1. **하단바 고정**: 모든 검사 페이지의 "다음/저장" 액션 버튼은 `position: fixed; bottom: 0`. iOS safe-area-inset-bottom 대응.
2. **사이드바**: < 800px에서는 햄버거 메뉴로 전환, 기본 숨김.
3. **카메라**: 전면 카메라는 `transform: scaleX(-1)` 적용해서 좌우반전 해제 (캔버스 오버레이는 그대로 두면 비디오와 정렬됨).
4. **콘텐츠 max-width**: 검사 페이지는 max-width 640px, 가운데 정렬.
5. **터치 타깃**: 44×44 px 이상 (Apple HIG 기준).
6. **모달/다이얼로그**: 화면 가운데 카드형 (안 좋은 native alert/confirm 사용 금지).
7. **권한 요청**: 페이지 진입 직후 자동 호출 (예: `/calibration` step 2에 들어가는 순간 `getUserMedia`).

Tailwind 사용 시 모바일 우선 (`max-md:` 대신 기본값이 모바일).

---

## 11. 알려진 gotcha (실제로 겪은 것)

1. **MediaPipe Camera utility 버그**: legacy `@mediapipe/camera_utils`의 `Camera` 클래스가 자체 `getUserMedia`를 호출해서 중복 스트림 생성 → NotReadableError. → tasks-vision으로 옮기고 직접 getUserMedia 사용.

2. **IPD 오버플로**: 구버전에서 `refineLandmarks: true`일 때 [0,1] 범위 밖 외삽 → `IPD_px = 1.48e+38` 같은 값. → 좌표 sanity 체크 (`-0.2 ~ 1.2`), pixel 범위 체크 (`20 ~ 600 px`) 필수.

3. **카메라 권한**: HTTPS 또는 localhost에서만 동작. Vercel preview URL은 https라 문제 없음.

4. **WebGL 컨텍스트 손실**: 모바일에서 백그라운드 갔다 오면 컨텍스트 잃을 수 있음. `webglcontextlost` 이벤트 처리.

5. **devicePixelRatio**: `window.devicePixelRatio × 96`은 실제 물리 DPI가 아니라 CSS 기준값. 카드 캘리브레이션이 필요한 이유.

6. **localStorage 5MB 제한**: Amsler 비트맵 2장만 해도 ~200KB. 큰 이미지 업로드는 IndexedDB로 (preview 페이지에서 사진 업로드 기능 추가 시).

7. **iOS Safari + WebGL**: `webgl2` 컨텍스트는 iOS 15+ 부터만 지원. 그 이전 버전은 단순 안내 표시.

8. **FFT 정밀도**: GPU fp32가 N=256에서 16 stages 누적 오차 발생. 검증 테스트는 `< 5e-3` 정도까지만 통과 기대.

9. **버튼 텍스트 가운데 정렬**: Tailwind `flex justify-center` 잊지 말 것. `inline-flex`의 default justification은 `flex-start`.

---

## 12. 마이그레이션 순서 (제안)

각 단계 끝나면 Vercel 배포해서 동작 확인하면서 진행.

1. **부트스트랩** (반나절)
   - Vite + React + TS + Tailwind + React Router 부트스트랩
   - 레이아웃 + 라우트 골격
   - Zustand store (스키마만, 빈 액션)
   - Tailwind 색상 토큰 (다크 테마, 기존 `var(--bg)`, `var(--accent)` 등 매핑)

2. **캘리브레이션 페이지** (1일)
   - Step 1 카드 슬라이더 (가장 단순한 페이지)
   - Step 2 카메라 + MediaPipe — `useCamera`, `useFaceLandmarker`, `useEyeTracker` 훅 만들기
   - Step 3 저장
   - 하단바 패턴 확정

3. **프로파일 페이지** (반나절)
   - 카드 표시, 다음 단계 추천, JSON 입출력
   - 빈 슬롯 많지만 UI 셸 먼저

4. **굴절 검사** (1~2일)
   - DefocusStaircase, AstigmatismFanChart 컴포넌트
   - psychophysics 유틸 (3-down/1-up 등)

5. **WebGL 인프라** (2~3일)
   - `useWebGL` 훅, FBO/텍스처 매니저
   - CPU FFT, GPU FFT, 단위 테스트 페이지부터
   - PSF 파이프라인

6. **미리보기 페이지** (1일)
   - PSF 캐시 + Wiener 통합 검증

7. **카메라 보정 페이지** (1~2일)
   - 가장 어려운 페이지. 5번까지 끝나야 의미 있음.
   - 양안 모드, 자동 해상도 조정, 온보딩 곡선

8. **나머지 검사** (각 1일)
   - LogMAR → CSF → Color → Amsler

9. **마무리** (반나절)
   - 에러 바운더리, 로딩 상태, 접근성 (alt, aria-label)
   - 모바일 폴리시 (safe-area, 햅틱)
   - PWA manifest + favicon

**총 예상**: 2~3주 (페이지별 평균 1일 + 인프라 1주).

---

## 13. 배포

```json
// vercel.json
{
  "buildCommand": "npm run build",
  "outputDirectory": "dist",
  "framework": "vite",
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

`rewrites`는 BrowserRouter 사용 시 새로고침 대응 필수 (hash router로 갈 거면 불필요).

환경 변수: 현재로선 없음. MediaPipe 모델 URL은 상수로 박아도 됨 (Google Storage CDN, 무료).

CSP 헤더 (선택):
```
default-src 'self' https://cdn.jsdelivr.net https://storage.googleapis.com;
img-src 'self' data: blob:;
media-src 'self' blob:;
worker-src 'self' blob:;
```

---

## 14. 체크리스트 (마이그레이션 완료 기준)

- [ ] 모든 페이지가 모바일 폭(375px)에서 깨지지 않음
- [ ] `/calibration` step 2가 진입 즉시 카메라 권한 요청
- [ ] 카메라 좌우반전 없이 표시 + eye-line overlay 정렬
- [ ] localStorage profile이 기존 v1 스키마와 데이터 호환 (마이그레이션 함수)
- [ ] 양안 굴절 측정 후 PSF 미리보기가 합리적 결과
- [ ] WebGL 단위 테스트 12개 통과
- [ ] Wiener 슬라이더 드래그가 30ms 이내 응답
- [ ] iPhone Safari 16+ 에서 카메라 페이지가 60fps에 가깝게 (또는 다운스케일 동작)
- [ ] 새로고침/탭 닫기 후에도 프로파일 복원
- [ ] JSON 내보내기/가져오기 round-trip 무손실
- [ ] Vercel preview 배포에서 HTTPS 카메라 정상 동작

---

## 15. 참고 문헌

- Thibos, L.N. et al. (2002). *Standards for reporting the optical aberrations of eyes*. JRS.
- Machado, G.M. et al. (2009). *A Physiologically-based Model for Simulation of Color Vision Deficiency*. IEEE TVCG.
- Pelli, D.G. & Bex, P. (2013). *Measuring contrast sensitivity*. Vision Research.
- Stockham, T.G. (1966). *High-speed convolution and correlation*. AFIPS.

---

## 16. 미해결 / Phase 2

- M2 Amsler field-remap 셰이더 통합 (현재 셰이더만 있고 카메라 페이지에 연결 안 됨)
- M3 색보정 카메라 모드 통합
- Head pose (yaw/pitch/roll) 활용 — 셰이더에서 view-dependent PSF 회전
- 굴절 검사 결과의 임상 검증 (실측 굴절값과의 상관관계)
- PWA 오프라인 모드 (MediaPipe WASM 캐싱)
- 다국어 (현재 한국어 only)
