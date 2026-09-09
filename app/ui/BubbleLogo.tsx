export default function BubbleLogo({ compact = false }: { compact?: boolean }) {
  return (
    <span className={`bubble-logo${compact ? " bubble-logo--compact" : ""}`} aria-hidden="true">
      <span className="bubble bubble--one" />
      <span className="bubble bubble--two" />
      <span className="bubble bubble--three" />
      <span className="bubble bubble--four" />
      <span className="bubble bubble--five" />
    </span>
  );
}
