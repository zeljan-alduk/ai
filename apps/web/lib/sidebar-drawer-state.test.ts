import { describe, expect, it } from 'vitest';
import {
  closeDrawer,
  initialSidebarState,
  openDrawer,
  routeChanged,
  viewportResized,
} from './sidebar-drawer-state';

describe('sidebar drawer state machine', () => {
  it('starts closed at the current path', () => {
    const s = initialSidebarState('/runs');
    expect(s).toEqual({ open: false, lastPath: '/runs' });
  });

  it('open() is idempotent', () => {
    const s = initialSidebarState('/runs');
    const a = openDrawer(s);
    const b = openDrawer(a);
    expect(a.open).toBe(true);
    expect(b).toBe(a);
  });

  it('close() is idempotent', () => {
    const s = initialSidebarState('/runs');
    const closed = closeDrawer(s);
    expect(closed).toBe(s);
    const opened = openDrawer(s);
    const reclosed = closeDrawer(opened);
    expect(reclosed.open).toBe(false);
  });

  it('routeChanged closes the drawer and updates lastPath', () => {
    const s = openDrawer(initialSidebarState('/runs'));
    const next = routeChanged(s, '/agents');
    expect(next).toEqual({ open: false, lastPath: '/agents' });
  });

  it('routeChanged is a no-op when the path is unchanged', () => {
    const s = openDrawer(initialSidebarState('/runs'));
    const next = routeChanged(s, '/runs');
    expect(next).toBe(s);
  });

  it('viewportResized force-closes when crossing into desktop', () => {
    const s = openDrawer(initialSidebarState('/runs'));
    expect(viewportResized(s, 1280).open).toBe(false);
  });

  it('viewportResized leaves the drawer alone when staying mobile', () => {
    const s = openDrawer(initialSidebarState('/runs'));
    const next = viewportResized(s, 360);
    expect(next).toBe(s);
  });

  it('viewportResized leaves a closed drawer alone in any case', () => {
    const s = initialSidebarState('/runs');
    expect(viewportResized(s, 1440)).toBe(s);
    expect(viewportResized(s, 360)).toBe(s);
  });
});
