# vcd-display → vcd-display-mg 마이그레이션 로드맵

## 진행 상황

| Phase | 상태 | 커밋 | 비고 |
| --- | --- | --- | --- |
| 0 — 기반 | ✅ 완료 | `a6f6f8e` | Tailwind v4, vitest, 셰이더 9개, Vercel rewrites |
| 1 — 상태/모델 | ✅ 완료 | `9a6ea92` | zod 스키마 + zustand + cross-tab + constants |
| 2 — 순수 도메인 로직 | ✅ 완료 | `232f146` | psf, fft, binocular, machado (테스트 31개 통과) |
| 3 — WebGL 래퍼 | ✅ 완료 | `addc41f` | glContext, wienerPipeline, useWebGLPipeline (StrictMode 안전) |
| 4 — MediaPipe | ✅ 완료 | `d636e30` | npm `tasks-vision`, FaceLandmarkerTracker, useFaceLandmarker (상태 반환) |
| 5 — 셸/라우팅 | ✅ 완료 | `8540f9a` | Layout(사이드바+뱃지), 10개 라우트, ErrorBoundary, 페이지 stub |
| 6 — 페이지 이식 | 🚧 시작 전 | — | 10개 페이지가 PlaceholderPage stub 상태 |
| 7 — 검증·배포 | ⏳ | — | |

**현재 빌드 상태**: 141 modules, 358KB / 112KB gzip. 테스트 31/31 통과.

---

## 현황 분석

**소스 (`vcd-display/vcd-app`)**

- Vanilla JS 8,118줄, hash 기반 자체 라우터, 빌드 없음
- localStorage 단일 키(`vcd.profile.v1`)로 상태 관리
- 10개 라우트 + security stub 1개, WebGL2 + Canvas 2D
- MediaPipe v0.4(레거시) + Chart.js 4.4.0 (CDN)
- 셰이더 9개 (`shaders/*.frag`, `*.vert`)

**타깃 (`vcd-display-mg`)**

- React 19 + TypeScript 5.8 + Vite 6 + React Router v7 (browser router)
- pnpm, ESLint 9 flat config, Prettier (import 자동 정렬)
- 경로 별칭 `@/* → src/*`
- 폴더 스캐폴드만 준비됨: `ui / components / features / hooks / store / schemas / types / utils / constants`
- 현재 `HomePage` 하나만 라우팅 중

---

## Phase 0 — 기반 다지기

핵심 의존성·인프라부터 정리해야 이후 페이지 이식이 단순해짐.

| 작업              | 비고                                                                                                                                                                 |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 의존성 추가       | `@mediapipe/tasks-vision`(레거시 교체), `zod`(스키마), `zustand`(상태), `vitest` + `@testing-library/react`(테스트). CSF 그래프는 직접 SVG로 그릴 예정이라 차트 라이브러리 미설치 |
| **Tailwind 설치** | `tailwindcss`, `@tailwindcss/vite` (Tailwind v4). `vite.config.ts`에 플러그인 추가, `index.css`에 `@import "tailwindcss";` 한 줄                                                  |
| 경로/별칭 확인    | `@/*` 이미 설정됨 — vite/tsconfig 매칭 점검                                                                                                                                       |
| 전역 스타일 이식  | `vcd-app/css/style.css` → Tailwind 클래스로 변환. 색/간격/폰트 등 디자인 토큰은 `@theme {}`로 정의. 셰이더·캔버스에 직접 들어가는 픽셀 단위 스타일만 일반 CSS로 남김              |
| 셰이더 인라인 임포트 | 셰이더 9개는 `src/features/vcd/shaders/`에 두고 `import frag from './x.frag?raw'`로 정적 임포트. `vite-env.d.ts`에 `declare module '*.frag?raw'` 추가. fetch 안 씀                |
| 라우터 구조       | `createBrowserRouter`로 이미 시작됨 — 일반 경로(`/calibration` 등) 사용, Vercel SPA rewrites 필요                                                                                 |

---

## Phase 1 — 상태·도메인 모델 (가장 먼저)

모든 페이지가 `VCDProfile`에 의존하므로 **여기서 막히면 전부 막힘.**

1. **zod 스키마(SoT)** — `src/schemas/profile.ts`
   `VCDProfileSchema`, `CalibrationSchema`, `RefractionSchema`, `LogMARSchema`, `CSFCurveSchema`, `ColorVisionSchema`, `ZernikeSchema`.
   localStorage v1 포맷 검증 + 버전 마이그레이션 함수(`migrateV1ToV2` 등)도 같이.
2. **타입 도출** — `src/types/profile.ts`
   `export type VCDProfile = z.infer<typeof VCDProfileSchema>;` 형태로 스키마에서 자동 추론.
   별도 `interface` 선언 금지 — 단일 진실 원천(SoT)은 zod 스키마.
3. **store** — `src/store/profileStore.ts` (zustand + persist)
   `profile.js` IIFE의 pub/sub를 zustand로 대체.
   **cross-tab sync는 zustand persist가 자동으로 해주지 않음** — `window.addEventListener('storage', ...)` 를 store 초기화 시 직접 붙여 다른 탭 변경을 `setState`로 흡수.
4. **상수** — `src/constants/`
   라우트 키, LogMAR 단계, CSF 주파수, Sloan 문자, Machado 행렬

> ⚠️ `profile.js` 하단의 페이지 UI 로직(7개 측정 카드, JSON 입출력)은 **Phase 6**에서 분리 이식.

---

## Phase 2 — 순수 도메인 로직 이식 (UI 무관)

DOM/Canvas와 무관한 계산 함수만 먼저 옮기면 단위 테스트 가능. 반드시 `.ts`로 타입 부여.

| 출처                      | 이식 위치                       | 내용                                                                       |
| ------------------------- | ------------------------------- | -------------------------------------------------------------------------- |
| `vcd-pipeline.js`         | `src/features/vcd/psf.ts`       | `refractionToZernike`, `computeWavefront`, `wavefrontToPSF`, `generatePSF` |
| `vcd-shader.js` (CPU FFT) | `src/features/vcd/fft.ts`       | Cooley-Tukey radix-2                                                       |
| `binocular-blend.js`      | `src/features/vcd/binocular.ts` | 시선→가중치 sigmoid, 온보딩 강도 곡선                                      |
| `color-test.js` (Machado) | `src/features/color/machado.ts` | 혼동선/시뮬레이션 행렬                                                     |

---

## Phase 3 — WebGL 파이프라인 래퍼

`vcd-shader.js`의 GPU 부분을 React-친화 클래스/훅으로.

1. `src/features/vcd/glContext.ts` — WebGL2 컨텍스트, `EXT_color_buffer_float`, 셰이더는 `?raw` 정적 임포트(`import frag from './shaders/wiener.frag?raw'`)로 받음
2. `src/features/vcd/wienerPipeline.ts` — Stockham FFT ping-pong, Wiener pass. 순수 클래스(컨텍스트 + 텍스처/프로그램 관리, `init()` / `dispose()`)
3. `src/hooks/useWebGLPipeline.ts` — 캔버스 ref와 파이프라인 클래스를 연결
   - **StrictMode 주의**: `main.tsx`에 `StrictMode`가 켜져 있어 dev에서 useEffect가 두 번 실행됨. cleanup에서 GL 리소스(프로그램·텍스처·FBO) 전부 `delete`하고, 컨텍스트 자체는 `WEBGL_lose_context`로 명시 해제. 두 번 init 되어도 누수 없게 ref-가드(`if (initialized.current) return;`)도 함께
4. `src/hooks/useAnimationFrame.ts` — rAF 루프 (camera-correction에서 사용). 콜백 ref 패턴으로 stale closure 방지

> 셰이더 텍스트는 변경 불필요. `src/features/vcd/shaders/`에 두고 `?raw`로 번들에 인라인 — fetch 안 씀.

---

## Phase 4 — MediaPipe 교체 (Phase 1과 병렬 가능)

`STACK.md`의 권고대로 **`@mediapipe/tasks-vision`** 으로 교체. 레거시 `camera_utils` 타이밍 버그를 함께 제거.

- `src/features/eye-tracking/faceLandmarker.ts` — `FaceLandmarker` + `FilesetResolver` 래퍼
- `src/hooks/useFaceLandmarker.ts` — 비디오 ref를 받아 **상태를 반환**:
  ```ts
  const { ipdPx, distanceCm, status, error } = useFaceLandmarker(videoRef);
  ```
  콜백 prop 패턴은 vanilla 시절 EventEmitter 잔재. 결과는 항상 React 상태로 노출.
- WASM은 `public/mediapipe/`에 로컬 호스팅 (CDN 장애 대비)

---

## Phase 5 — 셸/라우팅

- `apps/router.tsx`에 10개 라우트 추가 (security stub은 미구현이라 제외)
  `/calibration`, `/refraction`, `/vision`, `/csf`, `/color`, `/amsler`, `/profile`, `/preview`, `/camera`, `/webgl-test`
- `Layout.tsx`: 사이드바 + 뱃지(캘리브레이션/굴절 완료 여부) — `useProfile` 훅으로 구독
- **`components/ErrorBoundary.tsx`** — WebGL 컨텍스트 손실, MediaPipe WASM 로딩 실패, 카메라 권한 거부 등을 흰 화면 대신 fallback UI로 노출. `Layout` 안에서 `<Outlet />`을 감쌈
- 권장 흐름 가이드(캘리브레이션 → 굴절 → 선택검사 → 프로파일/프리뷰)는 사이드바 순서로 반영

---

## Phase 6 — 페이지 이식

리스크 낮은 순서로 진행:

1. **`/profile`** (`profile.js` 하단부) — store 읽기만, WebGL 없음. **여기서 store 설계 검증.**
2. **`/calibration`** — Phase 4 face landmarker 사용. 신용카드 드래그(PPI), MediaPipe IPD 거리 계산.
3. **`/refraction`** — Canvas 2D `ctx.filter` blur, 계단식 staircase, 팬 차트. WebGL 무관.
4. **`/vision`** — Sloan ETDRS, 적응형 계단식.
5. **`/csf`** — 2AFC + 3-down/1-up, **log-log CSF 곡선은 직접 SVG로 구현** (line 1개라 lib 도입 비용이 더 큼; ~50줄 컴포넌트).
6. **`/color`** — Ishihara + FM100 + Machado 보정행렬 도출.
7. **`/amsler`** — 격자 + 도구, 256×256 비트맵 → base64 PNG.
8. **`/webgl-test`** — Phase 3 파이프라인 디버그 페이지(개발용 도구).
9. **`/preview`** — 4패널 256×256, K 슬라이더, PSF/H 캐싱(`useMemo`).
10. **`/camera`** — 가장 무거움. getUserMedia + WebGL 파이프라인 + 자동 해상도 조절.

각 페이지: `src/ui/<page>/<Page>.tsx` + 페이지 전용 하위 컴포넌트 동일 폴더.
공유되는 것만 `components/`로 승격.

---

## Phase 7 — 검증·배포

- **데이터 마이그레이션**: 기존 사용자의 `localStorage[vcd.profile.v1]` 그대로 로드되는지 zod로 확인
- **Vercel 설정**: BrowserRouter → SPA fallback rewrite
  ```json
  { "rewrites": [{ "source": "/(.*)", "destination": "/" }] }
  ```
- **카메라 권한**: `localhost` / `https://`에서만 동작 — 배포 후 실기기 확인 필수

---

## 권장 진행 순서 (의존성 그래프)

```
                  ┌─→ Phase 2 ─┐
Phase 0 ─→ Phase 1 ┼─→ Phase 3 ─┼─→ Phase 6 ─→ Phase 7
        │         └─→ Phase 5 ─┤
        └────→ Phase 4 ────────┘
```

- **Phase 0**(인프라) → **Phase 1**(타입·store)이 모든 것의 선행.
- Phase 1 끝나면 **Phase 2**(순수 로직) · **Phase 3**(WebGL 래퍼) · **Phase 5**(셸)이 서로 독립이라 병렬 가능.
- **Phase 4**(MediaPipe)는 Phase 0만 끝나면 완전 독립적으로 진행 가능.
- **Phase 6**(페이지 이식)은 1~5 전부 필요. **Phase 7**(배포)이 마지막.

---

## 체크리스트 요약

### Phase 0 — 기반 ✅

- [x] `@mediapipe/tasks-vision`, `zod`, `zustand` 설치
- [x] `vitest` + `@testing-library/react` + `jsdom` 설치 (테스트 환경)
- [x] `tailwindcss` + `@tailwindcss/vite` 설치 및 vite 플러그인 등록
- [x] `index.css`에 `@import "tailwindcss";` + `@theme {}` 토큰 정의
- [x] 셰이더 9개를 `src/features/vcd/shaders/`로 이동 (public 아님)
- [x] `vite-env.d.ts`에 `declare module '*.frag?raw'` / `'*.vert?raw'` 추가
- [ ] 기존 `style.css` → Tailwind 클래스로 변환 _(Phase 6에서 페이지별로)_
- [x] Vercel rewrites 설정

### Phase 1 — 상태/모델 ✅

- [x] `schemas/profile.ts` (zod 스키마 — SoT)
- [x] `types/profile.ts` (`z.infer`로 스키마에서 타입 도출)
- [x] `store/profileStore.ts` (zustand + persist + **수동 `storage` 이벤트 cross-tab sync**)
- [x] `constants/` (라우트, LogMAR, CSF, Sloan, Machado)

### Phase 2 — 순수 로직 ✅

- [x] `features/vcd/psf.ts`
- [x] `features/vcd/fft.ts`
- [x] `features/vcd/binocular.ts`
- [x] `features/color/machado.ts`

### Phase 3 — WebGL ✅

- [x] `features/vcd/glContext.ts` (셰이더 `?raw` 임포트)
- [x] `features/vcd/wienerPipeline.ts` (`init` / `dispose`)
- [x] `hooks/useWebGLPipeline.ts` (**StrictMode double-mount 안전**, `WEBGL_lose_context`로 해제)
- [x] `hooks/useAnimationFrame.ts` (콜백 ref 패턴)

### Phase 4 — MediaPipe ✅

- [x] `features/eye-tracking/faceLandmarker.ts`
- [x] `hooks/useFaceLandmarker.ts` (**상태 반환** — 콜백 prop 금지)
- [ ] `public/mediapipe/` WASM 호스팅 _(현재 CDN 기본값, 페이지 이식 시 결정)_

### Phase 5 — 셸 ✅

- [x] `apps/router.tsx` 10개 라우트 (security 제외)
- [x] `Layout.tsx` 사이드바 + 뱃지
- [x] `components/ErrorBoundary.tsx` (Layout 안 `<Outlet />` 래핑)

### Phase 6 — 페이지 (순서대로)

- [ ] `/profile`
- [ ] `/calibration`
- [ ] `/refraction`
- [ ] `/vision`
- [ ] `/csf`
- [ ] `/color`
- [ ] `/amsler`
- [ ] `/webgl-test`
- [ ] `/preview`
- [ ] `/camera`

### Phase 7 — 배포

- [ ] 기존 localStorage 호환 검증
- [ ] Vercel SPA fallback
- [ ] 실기기 카메라 권한 확인
