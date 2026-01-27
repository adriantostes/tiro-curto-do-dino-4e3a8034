export function BuildStamp() {
  if (!import.meta.env.DEV) return null;

  return (
    <div className="fixed bottom-3 left-3 z-50">
      <div className="glass rounded-xl px-3 py-2 text-[11px] leading-tight text-muted-foreground">
        <span className="font-medium">Build</span>: {__BUILD_TIME__}
      </div>
    </div>
  );
}
