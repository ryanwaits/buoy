'use client';

import { useEffect } from 'react';
import { type MountOptions, mount } from './overlay';

export type BuoyProps = Omit<MountOptions, 'data'> & {
  /** Where `buoy build` wrote the manifest, as the browser sees it. */
  src?: string;
};

/**
 * Dev-only review overlay. Renders nothing; the overlay lives outside React's tree.
 *
 * @example
 * ```tsx
 * {process.env.NODE_ENV === 'development' && <Buoy />}
 * ```
 */
export function Buoy({ src = '/buoy.json', root }: BuoyProps): null {
  useEffect(() => {
    let unmount: (() => void) | undefined;
    let live = true;
    fetch(src)
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`${res.status} ${src}`))))
      .then((data) => {
        if (live) unmount = mount({ data, root });
      })
      .catch((err) =>
        console.warn(`[buoy] No manifest. Run \`buoy build\` first. (${err.message})`),
      );
    return () => {
      live = false;
      unmount?.();
    };
  }, [src, root]);
  return null;
}
