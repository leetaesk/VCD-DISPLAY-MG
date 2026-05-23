import { useEffect, useRef } from 'react';

/**
 * requestAnimationFrame 루프 훅.
 *
 * 콜백 ref 패턴:
 *   매 렌더마다 콜백 식별성이 바뀌어도 effect를 재실행하지 않음.
 *   ref에 최신 콜백을 저장 → 루프는 항상 최신 함수를 호출.
 *   이게 없으면 stale closure로 옛 props/state를 잡음.
 *
 * active=false면 루프가 멈추고 다시 true가 될 때 재개.
 *
 * @param callback - 각 프레임에서 호출. delta = 이전 프레임과의 시간(ms).
 * @param active   - 루프 on/off (기본 true)
 */
export function useAnimationFrame(
  callback: (delta: number, now: number) => void,
  active: boolean = true,
): void {
  const callbackRef = useRef(callback);
  callbackRef.current = callback;

  useEffect(() => {
    if (!active) return;
    let id = 0;
    let prev = performance.now();

    const tick = (now: number) => {
      const delta = now - prev;
      prev = now;
      callbackRef.current(delta, now);
      id = requestAnimationFrame(tick);
    };

    id = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(id);
  }, [active]);
}
