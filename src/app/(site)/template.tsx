import type { ReactNode } from "react";

/**
 * Re-mounts on every navigation - that is the entire point. The layout above
 * holds the header still while the page content arrives with the shared rise,
 * so switching tabs reads as the site swapping the sheet of paper, not
 * repainting the world. No client JS: a template remount replays the CSS
 * animation by itself.
 */
export default function SiteTemplate({ children }: { children: ReactNode }) {
  return <div className="rise">{children}</div>;
}
