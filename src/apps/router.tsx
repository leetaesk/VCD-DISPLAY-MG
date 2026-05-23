import { createBrowserRouter } from 'react-router-dom';

import Layout from '@/apps/layout/Layout';
import { ROUTES } from '@/constants/routes';
import AmslerPage from '@/ui/amsler/AmslerPage';
import CalibrationPage from '@/ui/calibration/CalibrationPage';
import CameraPage from '@/ui/camera/CameraPage';
import ColorPage from '@/ui/color/ColorPage';
import CsfPage from '@/ui/csf/CsfPage';
import HomePage from '@/ui/home/HomePage';
import PreviewPage from '@/ui/preview/PreviewPage';
import ProfilePage from '@/ui/profile/ProfilePage';
import RefractionPage from '@/ui/refraction/RefractionPage';
import VisionPage from '@/ui/vision/VisionPage';
import WebGLTestPage from '@/ui/webgl-test/WebGLTestPage';

/* ─────────────────────────────────────────────────────────
   BrowserRouter — 일반 경로(`/calibration` 등) 사용.
   security stub은 원본에서도 미구현이라 제외.
   404 처리는 Phase 6/7에서 보강.
   ───────────────────────────────────────────────────────── */
const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { index: true, element: <HomePage /> },
      { path: ROUTES.calibration, element: <CalibrationPage /> },
      { path: ROUTES.refraction, element: <RefractionPage /> },
      { path: ROUTES.vision, element: <VisionPage /> },
      { path: ROUTES.csf, element: <CsfPage /> },
      { path: ROUTES.color, element: <ColorPage /> },
      { path: ROUTES.amsler, element: <AmslerPage /> },
      { path: ROUTES.profile, element: <ProfilePage /> },
      { path: ROUTES.preview, element: <PreviewPage /> },
      { path: ROUTES.camera, element: <CameraPage /> },
      { path: ROUTES.webglTest, element: <WebGLTestPage /> },
    ],
  },
]);

export default router;
