# starter

React + TypeScript + Vite 기반 프로젝트 스타터.

## 스택

- **React 19** + **TypeScript 5.8**
- **Vite 6** (SWC 플러그인)
- **React Router v7** (`createBrowserRouter`)
- **pnpm**
- **ESLint 9** (flat config) + **Prettier** (import 자동 정렬)

## 시작하기

```bash
pnpm install
pnpm dev
```

## 스크립트

| 명령           | 설명                        |
| -------------- | --------------------------- |
| `pnpm dev`     | 개발 서버 실행              |
| `pnpm build`   | 타입 체크 + 프로덕션 빌드   |
| `pnpm preview` | 빌드 결과 로컬에서 미리보기 |
| `pnpm lint`    | ESLint 실행                 |

## 폴더 구조

```
src/
├── apps/              # 앱 셸 (라우팅, 레이아웃)
│   ├── router.tsx     # createBrowserRouter 정의
│   └── layout/
│       └── Layout.tsx # 공통 레이아웃 (Outlet)
│
├── ui/                # 페이지 단위
│   └── home/          # 페이지별 폴더
│       └── HomePage.tsx
│
├── components/        # 공용(재사용) 컴포넌트
├── features/          # 도메인별 기능 모듈
├── hooks/             # 공용 커스텀 훅
├── store/             # 전역 상태
├── schemas/           # 검증 스키마 (zod 등)
├── types/             # 공용 타입
├── utils/             # 유틸 함수
├── constants/         # 상수
├── assets/            # 정적 자산
│
├── App.tsx            # RouterProvider 진입점
├── main.tsx           # ReactDOM 부트스트랩
└── index.css          # 전역 스타일
```

### 페이지 추가하는 법

1. `src/ui/<page-name>/` 폴더 생성
2. 페이지 컴포넌트 + 해당 페이지에서만 쓰는 하위 컴포넌트를 같이 둠
3. [src/apps/router.tsx](src/apps/router.tsx)의 `children`에 라우트 등록

페이지 전용 컴포넌트는 `ui/<page>/` 안에, 여러 페이지에서 공유하는 컴포넌트는 `components/`에 둔다.

## 경로 별칭

`@/*` → `src/*` (tsconfig + vite 양쪽에 설정됨)

```ts
import HomePage from '@/ui/home/HomePage';
```

## 코드 스타일

Prettier 설정 ([prettier.config.cjs](prettier.config.cjs)):

- 세미콜론, 작은따옴표, trailing comma all
- print width 100, tab width 2
- import 자동 정렬 순서: `react` → 외부 패키지 → `@/*` → 상대 경로
