/* ─────────────────────────────────────────────────────────
   Profile 타입 — schemas/profile.ts의 zod 스키마에서 자동 도출.
   별도 interface 선언 금지 (단일 진실 원천 = zod 스키마).
   ───────────────────────────────────────────────────────── */
export type {
  Eye,
  VCDProfile,
} from '@/schemas/profile';

import type { z } from 'zod';

import type {
  CalibrationSchema,
  CSFClassificationSchema,
  CSFCurveSchema,
  CSFEyeSchema,
  ColorVisionSchema,
  ColorVisionTypeSchema,
  DistanceSourceSchema,
  EyeRefractionSchema,
  LogMAREyeSchema,
  LogMARSchema,
  RefractionSchema,
  ZernikeEyeSchema,
  ZernikeSchema,
} from '@/schemas/profile';

export type Calibration = z.infer<typeof CalibrationSchema>;
export type DistanceSource = z.infer<typeof DistanceSourceSchema>;
export type EyeRefraction = z.infer<typeof EyeRefractionSchema>;
export type Refraction = z.infer<typeof RefractionSchema>;
export type LogMAREye = z.infer<typeof LogMAREyeSchema>;
export type LogMAR = z.infer<typeof LogMARSchema>;
export type CSFClassification = z.infer<typeof CSFClassificationSchema>;
export type CSFEye = z.infer<typeof CSFEyeSchema>;
export type CSFCurve = z.infer<typeof CSFCurveSchema>;
export type ColorVisionType = z.infer<typeof ColorVisionTypeSchema>;
export type ColorVision = z.infer<typeof ColorVisionSchema>;
export type ZernikeEye = z.infer<typeof ZernikeEyeSchema>;
export type Zernike = z.infer<typeof ZernikeSchema>;
