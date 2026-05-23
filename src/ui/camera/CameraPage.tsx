import PlaceholderPage from '@/components/PlaceholderPage';

function CameraPage() {
  return (
    <PlaceholderPage
      title="카메라 보정"
      description="getUserMedia → grayPack → FFT → Wiener → IFFT → 화면 출력."
    />
  );
}

export default CameraPage;
