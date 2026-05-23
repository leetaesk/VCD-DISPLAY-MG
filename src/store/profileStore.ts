import { create } from 'zustand';

import {
  STORAGE_KEY,
  makeEmptyProfile,
  parseStoredProfile,
} from '@/schemas/profile';
import type { VCDProfile } from '@/schemas/profile';

/* ─────────────────────────────────────────────────────────
   profileStore — vcd-display의 VCDProfile(profile.js IIFE)을 React/zustand로 대체.

   왜 zustand/persist 미들웨어를 안 쓰는가:
   - zod로 strict 검증 + 빈 프로파일 폴백 + schema_version 보정을
     한 곳에서 (parseStoredProfile) 처리하고 싶음.
   - persist 미들웨어를 끼우면 검증/마이그레이션 분기가 두 군데로 나뉘어
     디버깅이 어려워짐.
   직접 구현해도 ~30줄이라 비용이 낮음.

   cross-tab sync:
   - 같은 키로 다른 탭이 쓰면 storage 이벤트가 발생 (같은 탭에서는 발생 X).
   - 이벤트에서 raw를 다시 parseStoredProfile로 통과시켜 store에 set.
   ───────────────────────────────────────────────────────── */

type ProfileState = {
  profile: VCDProfile;

  /** 전체 교체 — 평소 쓸 일 없음 (import/reset용) */
  setProfile: (next: VCDProfile) => void;

  /** 부분 업데이트 — 한 필드만 갈아끼울 때 */
  patch: <K extends keyof VCDProfile>(field: K, value: VCDProfile[K]) => void;

  /** 임의 변경 — 여러 필드를 한 번에 (immer는 아직 안 씀) */
  update: (updater: (draft: VCDProfile) => VCDProfile) => void;

  reset: () => void;
};

function loadInitial(): VCDProfile {
  if (typeof localStorage === 'undefined') return makeEmptyProfile();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return makeEmptyProfile();
    return parseStoredProfile(JSON.parse(raw));
  } catch (e) {
    console.warn('[profile] failed to read localStorage, resetting', e);
    return makeEmptyProfile();
  }
}

function persist(profile: VCDProfile): VCDProfile {
  const stamped = { ...profile, updated_at: new Date().toISOString() };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(stamped));
  } catch (e) {
    console.warn('[profile] failed to persist', e);
  }
  return stamped;
}

export const useProfileStore = create<ProfileState>((set) => ({
  profile: loadInitial(),

  setProfile: (next) => set({ profile: persist(next) }),

  patch: (field, value) =>
    set((state) => ({ profile: persist({ ...state.profile, [field]: value }) })),

  update: (updater) =>
    set((state) => ({ profile: persist(updater({ ...state.profile })) })),

  reset: () => set({ profile: persist(makeEmptyProfile()) }),
}));

/* ─── cross-tab sync ──────────────────────────────────────
   브라우저 환경에서만 등록. SSR/테스트 환경에서는 no-op.
   storage 이벤트는 같은 탭에서는 발화하지 않으므로 무한 루프 없음.
   ───────────────────────────────────────────────────────── */
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== STORAGE_KEY) return;
    try {
      const next = e.newValue
        ? parseStoredProfile(JSON.parse(e.newValue))
        : makeEmptyProfile();
      useProfileStore.setState({ profile: next });
    } catch (err) {
      console.warn('[profile] cross-tab sync failed', err);
    }
  });
}

/* ─── 편의 셀렉터 (컴포넌트에서 useProfile() 한 줄로 쓰기) ── */
export const useProfile = () => useProfileStore((s) => s.profile);
