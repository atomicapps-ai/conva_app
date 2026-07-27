import { useEffect } from "react";

import { StudioShell } from "@/components/studio/StudioShell";
import { useIpcBridge } from "@/lib/useIpcBridge";
import { useAppStore } from "@/state/app";

export default function App() {
  useIpcBridge();
  const init = useAppStore((s) => s.init);

  useEffect(() => {
    void init();
  }, [init]);

  return <StudioShell />;
}
