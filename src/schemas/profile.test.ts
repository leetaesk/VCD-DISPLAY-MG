import { describe, expect, it } from 'vitest';

import { makeEmptyProfile, parseStoredProfile, VCDProfileSchema } from './profile';

describe('VCDProfileSchema', () => {
  it('빈 프로파일은 스키마 통과', () => {
    const empty = makeEmptyProfile();
    expect(VCDProfileSchema.safeParse(empty).success).toBe(true);
  });

  it('schema_version 없는 v1 구버전도 parseStoredProfile로 흡수', () => {
    const legacy = {
      user_id: 'legacy-uuid',
      calibration: null,
      refraction: null,
      logmar: null,
      csf_curve: null,
      color_vision: null,
      amsler_map_od: null,
      amsler_map_os: null,
      zernike: null,
      updated_at: null,
    };
    const parsed = parseStoredProfile(legacy);
    expect(parsed.user_id).toBe('legacy-uuid');
    expect(parsed.schema_version).toBe(1);
  });

  it('손상된 데이터는 빈 프로파일로 폴백', () => {
    const broken = { garbage: true };
    const parsed = parseStoredProfile(broken);
    expect(parsed.calibration).toBeNull();
    expect(typeof parsed.user_id).toBe('string');
  });

  it('refraction.axis 범위 검증 (0~180)', () => {
    const profile = makeEmptyProfile();
    profile.refraction = {
      od: { sph: -2, cyl: -0.5, axis: 200 }, // 범위 초과
      os: { sph: -2, cyl: -0.5, axis: 90 },
      confidence: 0.8,
    };
    expect(VCDProfileSchema.safeParse(profile).success).toBe(false);
  });

  it('valid한 calibration 통과', () => {
    const profile = makeEmptyProfile();
    profile.calibration = {
      screen_ppi: 120.5,
      screen_width_mm: 305.2,
      viewing_distance_cm: 60,
      distance_source: 'mediapipe_ipd',
      calibration_timestamp: '2026-05-23T10:00:00.000Z',
    };
    expect(VCDProfileSchema.safeParse(profile).success).toBe(true);
  });

  // Phase 7 verification: full v1 profile from the original vcd-display app
  // (모든 슬라이스가 채워진 상태)가 vcd-display-mg에서 그대로 로드되는지.
  it('vcd-display v1 full profile loads end-to-end', () => {
    const legacyV1 = {
      user_id: 'u-abc12345',
      calibration: {
        screen_ppi: 110.3,
        screen_width_mm: 295.7,
        viewing_distance_cm: 55,
        distance_source: 'mediapipe_ipd' as const,
        calibration_timestamp: '2025-11-01T08:15:00.000Z',
      },
      refraction: {
        od: { sph: -2.5, cyl: -0.75, axis: 90 },
        os: { sph: -2.0, cyl: -0.5, axis: 85 },
        confidence: 0.82,
      },
      logmar: {
        od: { logmar: 0.0, confidence: 0.9, screen_limited: false },
        os: { logmar: 0.1, confidence: 0.85, screen_limited: false },
      },
      csf_curve: {
        od: {
          freqs: [0.5, 1, 2, 4, 8, 12, 16],
          thresholds: [0.02, 0.01, 0.005, 0.005, 0.01, 0.03, null],
          sensitivities: [50, 100, 200, 200, 100, 33.3, null],
          confidence: 0.78,
          classification: 'normal' as const,
        },
        tested_at: '2025-11-01T08:30:00.000Z',
      },
      color_vision: {
        type: 'normal' as const,
        severity: 0,
      },
      amsler_map_od: null,
      amsler_map_os: null,
      zernike: null,
      updated_at: '2025-11-01T08:30:00.000Z',
    };
    const parsed = parseStoredProfile(legacyV1);
    expect(parsed.user_id).toBe('u-abc12345');
    expect(parsed.calibration?.screen_ppi).toBe(110.3);
    expect(parsed.refraction?.od.sph).toBe(-2.5);
    expect(parsed.logmar?.od?.logmar).toBe(0.0);
    expect(parsed.csf_curve?.od?.sensitivities[0]).toBe(50);
    expect(parsed.color_vision?.type).toBe('normal');
  });
});
