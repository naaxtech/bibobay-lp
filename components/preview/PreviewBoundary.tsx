"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

/**
 * Ruling R169: the Studio's overlay is an extra; if it ever fails, the editor still gets the page.
 * Without this boundary an overlay error (a blocked style sheet once did it) replaced the whole
 * preview with the error page.
 */
export class PreviewBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("[bibo] the Studio overlay failed; the page is shown without it", error, info.componentStack);
  }

  render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}
