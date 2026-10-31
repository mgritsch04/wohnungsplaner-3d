import type { ReactNode } from 'react';
import type { LeftTab } from '../store/uiStore';

/** Line icons of the left side bar (#461); decorative, the button keeps its text label. */
function Svg({ children }: { children: ReactNode }) {
  return (
    <svg className="rail-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

const ICONS: Record<LeftTab, ReactNode> = {
  // pencil on a ruler
  tools: (
    <>
      <path d="M4 20l4-1 11-11-3-3L5 16z" />
      <path d="M14 7l3 3" />
    </>
  ),
  // sofa
  catalog: (
    <>
      <path d="M5 11V8a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v3" />
      <path d="M3 13a2 2 0 0 1 4 0v2h10v-2a2 2 0 0 1 4 0v5H3z" />
      <path d="M5 18v2M19 18v2" />
    </>
  ),
  // cooking pot
  kitchen: (
    <>
      <path d="M4 10h16v6a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4z" />
      <path d="M2 10h20M9 6V4M15 6V4M12 7V4" />
    </>
  ),
  // sparkles
  furnish: (
    <>
      <path d="M12 3l1.8 4.7L18.5 9.5l-4.7 1.8L12 16l-1.8-4.7L5.5 9.5l4.7-1.8z" />
      <path d="M18.5 15.5l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8z" />
    </>
  ),
  // house with signal
  smarthome: (
    <>
      <path d="M3 11l9-7 9 7v9H3z" />
      <path d="M9 15a4 4 0 0 1 6 0M10.8 17.2a1.6 1.6 0 0 1 2.4 0" />
    </>
  ),
  // check in a circle
  check: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M8.5 12.3l2.4 2.4 4.6-5" />
    </>
  ),
  // arrow into a tray
  import: (
    <>
      <path d="M12 4v10M8 10l4 4 4-4" />
      <path d="M4 15v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3" />
    </>
  ),
};

export const TabIcon = ({ tab }: { tab: LeftTab }) => <Svg>{ICONS[tab]}</Svg>;
