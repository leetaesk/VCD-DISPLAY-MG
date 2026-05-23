/**
 * getUserMedia 에러를 사용자 친화적 한국어 메시지로 매핑.
 * calibration / camera 페이지가 공통으로 사용.
 */
export function friendlyCamMessage(e: Error): string {
  switch (e.name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'NotAllowedError' === e.name
        ? '카메라 권한이 거부되었습니다. 브라우저 주소창 옆 아이콘에서 권한을 허용해 주세요.'
        : 'HTTPS 또는 localhost에서만 카메라를 사용할 수 있습니다.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return '사용 가능한 카메라를 찾지 못했습니다. 다른 앱이 카메라를 사용 중인지 확인해 주세요.';
    case 'NotReadableError':
      return '카메라를 시작할 수 없습니다. 다른 앱이 카메라를 사용 중일 수 있습니다.';
    case 'AbortError':
      return '카메라 시작이 중단되었습니다. 다시 시도해 주세요.';
    default:
      return e.message || String(e);
  }
}
