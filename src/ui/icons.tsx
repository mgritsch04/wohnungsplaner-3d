import type { ReactNode } from 'react';

/**
 * Small inline line icons for the toolbar (#103). They use `currentColor`, so they follow
 * the button text colour in light and dark mode; they are decorative (`aria-hidden`) – the
 * button carries the name as `aria-label` and the tooltip as `title`.
 */
function Svg({ children }: { children: ReactNode }) {
  return (
    <svg
      className="icon"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export const IconUndo = () => (
  <Svg>
    <path d="M9 14 4 9l5-5" />
    <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
  </Svg>
);

export const IconRedo = () => (
  <Svg>
    <path d="m15 14 5-5-5-5" />
    <path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />
  </Svg>
);

/** Two panes side by side: plan and 3D view. */
export const IconSplitView = () => (
  <Svg>
    <rect x="3" y="4.5" width="18" height="15" rx="2" />
    <path d="M12 4.5v15" />
  </Svg>
);

/** A box with an orbit around it: look at the apartment from outside. */
export const IconOrbit = () => (
  <Svg>
    <path d="m12 2.5 5 2.9v5.8L12 14l-5-2.8V5.4z" />
    <path d="m7 5.4 5 2.9 5-2.9M12 8.3V14" />
    <path d="M4.5 12.5C3 13.3 2 14.3 2 15.5c0 2.8 4.5 5 10 5s10-2.2 10-5c0-1.2-1-2.2-2.5-3" />
    <path d="m17.2 11.6 2.3.9-.9 2.3" />
  </Svg>
);

/** Walking person: first-person walkthrough. */
export const IconWalk = () => (
  <Svg>
    <circle cx="13.5" cy="4" r="1.8" />
    <path d="m12.5 7.5-1.5 6 3 3 1 4.5" />
    <path d="m11 13.5-2 3-2.5 4" />
    <path d="M8.5 11 12.5 7.5l2.5 3 2.5 1" />
  </Svg>
);

/** Walking person with a path: automatic tour (Rundgang). */
export const IconTour = () => (
  <Svg>
    <circle cx="8" cy="4.5" r="1.8" />
    <path d="m7 8-1 5 2.5 2.5.8 4M6 13l-1.5 3M5.5 10.5 8 8l2 2.5" />
    <path d="M13 20c3 0 3-4 5.5-4s2.5 3 2.5 3" strokeDasharray="2 2" />
  </Svg>
);

/** Person next to a measuring rod: real size (#256). */
export const IconTrueScale = () => (
  <Svg>
    <circle cx="9" cy="4.5" r="1.8" />
    <path d="M9 8v6l-2 6.5M9 14l2 6.5M6 11l3-2.5 3 2.5" />
    <path d="M17 3v18M17 6h2M17 10h2M17 14h2M17 18h2" />
  </Svg>
);

/** Standing person. */
export const IconStand = () => (
  <Svg>
    <circle cx="12" cy="4" r="1.8" />
    <path d="M12 7.5V14l-2.5 7M12 14l2.5 7" />
    <path d="m8 11.5 4-3 4 3" />
  </Svg>
);

/** Person sitting on a chair. */
export const IconSit = () => (
  <Svg>
    <circle cx="10" cy="4" r="1.8" />
    <path d="M10 7.5V13h5.5v7" />
    <path d="m10 9.5 3.5 2" />
    <path d="M6 8v12M6 16h4" />
  </Svg>
);

/** House cut horizontally: walls above the cut are dashed. */
export const IconCutaway = () => (
  <Svg>
    <path d="M5 12v8h14v-8" />
    <path d="M5 12V9l7-5 7 5v3" strokeDasharray="2 2.4" />
    <path d="M2.5 12h19" strokeWidth={2.2} />
  </Svg>
);

/** Building seen from outside: facade with windows and a door. */
export const IconExterior = () => (
  <Svg>
    <path d="M5 20V5h14v15" />
    <path d="M3 20h18" />
    <path d="M8 9h2M14 9h2M8 13h2" />
    <path d="M14 20v-5h3v5" />
  </Svg>
);

/** Camera inside a circular arrow: back to the start view. */
export const IconResetCamera = () => (
  <Svg>
    <path d="M3.5 12a8.5 8.5 0 1 0 2.5-6" />
    <path d="M3.5 3.5V8H8" />
    <rect x="8" y="10" width="6" height="5" rx="1" />
    <path d="m14 11.5 2.5-1.3v4.6L14 13.5" />
  </Svg>
);

export const IconHelp = () => (
  <Svg>
    <circle cx="12" cy="12" r="9" />
    <path d="M9.5 9.5a2.5 2.5 0 1 1 3.4 2.3c-.6.3-.9.8-.9 1.5v.4" />
    <path d="M12 17h.01" strokeWidth={2.4} />
  </Svg>
);

/** Three dots: overflow menu ("Mehr"). */
export const IconMore = () => (
  <Svg>
    <circle cx="5" cy="12" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none" />
    <circle cx="19" cy="12" r="1.4" fill="currentColor" stroke="none" />
  </Svg>
);

/** Turn left / right (#164, phone selection bar). */
export const IconRotateLeft = () => (
  <Svg>
    <path d="M3.5 4.5v5h5" />
    <path d="M4 9.5a8 8 0 1 1 1.9 8.4" />
  </Svg>
);

export const IconRotateRight = () => (
  <Svg>
    <path d="M20.5 4.5v5h-5" />
    <path d="M20 9.5a8 8 0 1 0-1.9 8.4" />
  </Svg>
);

/** Two overlapping sheets: duplicate. */
export const IconDuplicate = () => (
  <Svg>
    <rect x="8.5" y="8.5" width="12" height="12" rx="2" />
    <path d="M15.5 8.5V5.5a2 2 0 0 0-2-2h-8a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h3" />
  </Svg>
);

/** Waste bin: delete. */
export const IconTrash = () => (
  <Svg>
    <path d="M4 6.5h16M9.5 6.5V4h5v2.5" />
    <path d="M6 6.5 7 20h10l1-13.5" />
    <path d="M10 10.5v6M14 10.5v6" />
  </Svg>
);
