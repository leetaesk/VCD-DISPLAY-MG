/**
 * 라우트 경로 상수.
 * - 원본 vcd-display는 hash 라우터(`#/calibration` 등)였지만
 *   vcd-display-mg는 BrowserRouter라 leading `/`만 사용.
 * - security는 미구현 stub이라 mg에서는 제외.
 */
export const ROUTES = {
  home: '/',
  calibration: '/calibration',
  refraction: '/refraction',
  vision: '/vision',
  csf: '/csf',
  color: '/color',
  amsler: '/amsler',
  profile: '/profile',
  preview: '/preview',
  camera: '/camera',
  webglTest: '/webgl-test',
} as const;

export type RouteKey = keyof typeof ROUTES;
export type RoutePath = (typeof ROUTES)[RouteKey];
