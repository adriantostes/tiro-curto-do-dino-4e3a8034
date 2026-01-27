import * as React from "react";

export const BuildStamp = React.forwardRef<HTMLDivElement>(function BuildStamp(_props, ref) {
  if (!import.meta.env.DEV) return null;

  return (
    <div ref={ref} className="fixed bottom-3 left-3 z-50">
      <div className="glass rounded-xl px-3 py-2 text-[11px] leading-tight text-muted-foreground">
        <span className="font-medium">Build</span>: {__BUILD_TIME__}
      </div>
    </div>
  );
});
