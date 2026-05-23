/**
 * Phase 6에서 실제 페이지로 교체될 임시 placeholder.
 * 라우터 구조와 사이드바 동작을 미리 확인하기 위해 존재.
 */
interface Props {
  title: string;
  description?: string;
}

function PlaceholderPage({ title, description }: Props) {
  return (
    <div className="p-6">
      <h2 className="mb-1 text-2xl font-semibold text-text">{title}</h2>
      {description && <p className="mb-4 text-text-dim">{description}</p>}
      <div className="rounded-md border border-dashed border-line bg-bg-elev p-4 text-sm text-text-dim">
        🚧 이 페이지는 Phase 6에서 vcd-display로부터 이식 예정.
      </div>
    </div>
  );
}

export default PlaceholderPage;
