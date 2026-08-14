import { useCallback, useEffect, useState } from 'react';
import { fetchUNSNodes } from './api';
import type { UNSNode, UNSWorkspace } from '@faclon-labs/design-sdk/UNSTreePicker';

/**
 * Dev-harness fallback for @faclon-labs/design-sdk UNSTreePicker.
 *
 * In the IOSense host, `unsWorkspaces` / `loadUnsChildren` / `searchUnsNodes`
 * are injected as props by QuickConfigShell.buildProps and this hook is
 * called with `undefined` (it no-ops). In standalone/local dev this hook
 * adapts the token-backed /account/uns/nodes endpoint into the picker's
 * lazy contract.
 *
 * Module-level singleton caches: a single workspace fetch + one operational
 * fetch per workspace is shared across every configurator that mounts. The
 * flat operational node list is reshaped into the picker's lazy tree:
 *   - a Tag with `:suffix` virtual properties → a Folder whose kids are the leaves
 *   - a Tag without any virtual properties → a selectable Tag leaf
 */

export interface UseUNSTreePickerResult {
  workspaces: UNSWorkspace[];
  isLoadingWorkspaces: boolean;
  loadChildren: (wsId: string, parentId?: string) => Promise<UNSNode[]>;
  searchNodes: (wsId: string, query: string, limit?: number) => Promise<UNSNode[]>;
}

interface WsCache {
  top: UNSNode[];
  childrenByParent: Map<string, UNSNode[]>;
  leaves: UNSNode[];
}

const _cache: {
  workspaces: UNSWorkspace[] | null;
  byWs: Map<string, Promise<WsCache>>;
} = { workspaces: null, byWs: new Map() };
let _workspacesPromise: Promise<UNSWorkspace[]> | null = null;

async function fetchWsCache(auth: string, wsId: string): Promise<WsCache> {
  const nodes = await fetchUNSNodes(auth, `uns:${wsId}`, 'Operational', 100, true);
  const tags: Array<{ id: string; name: string; path: string }> = [];
  const vprops: Array<{ id: string; name: string; path: string }> = [];
  for (const n of nodes) {
    if (!n.name) continue;
    const path = n.path ?? n.name;
    (n.type === 'virtualProperty' ? vprops : tags).push({ id: n.id, name: n.name, path });
  }
  const top: UNSNode[] = [];
  const childrenByParent = new Map<string, UNSNode[]>();
  const leaves: UNSNode[] = [];
  for (const tag of tags) {
    const matching = vprops.filter((vp) => vp.path.startsWith(`${tag.path}:`));
    if (matching.length > 0) {
      top.push({
        id: tag.id,
        unsId: wsId,
        type: 'Folder',
        name: tag.name,
        path: tag.path,
        hasChildren: true,
        childCount: matching.length,
      });
      const kids: UNSNode[] = matching.map((vp) => {
        const suffix = vp.path.substring(vp.path.lastIndexOf(':'));
        return {
          id: vp.id,
          unsId: wsId,
          type: 'Tag',
          name: `${tag.name}${suffix}`,
          path: vp.path,
          hasChildren: false,
        };
      });
      childrenByParent.set(tag.id, kids);
      leaves.push(...kids);
    } else {
      const leaf: UNSNode = {
        id: tag.id,
        unsId: wsId,
        type: 'Tag',
        name: tag.name,
        path: tag.path,
        hasChildren: false,
      };
      top.push(leaf);
      leaves.push(leaf);
    }
  }
  return { top, childrenByParent, leaves };
}

function wsCache(auth: string, wsId: string): Promise<WsCache> {
  let p = _cache.byWs.get(wsId);
  if (!p) {
    p = fetchWsCache(auth, wsId).catch((e) => {
      _cache.byWs.delete(wsId);
      throw e;
    });
    _cache.byWs.set(wsId, p);
  }
  return p;
}

export function useUNSTreePicker(authentication?: string): UseUNSTreePickerResult {
  const [workspaces, setWorkspaces] = useState<UNSWorkspace[]>(() => _cache.workspaces ?? []);
  const [isLoadingWorkspaces, setIsLoadingWorkspaces] = useState(false);

  useEffect(() => {
    if (!authentication || _cache.workspaces) return;
    let alive = true;
    setIsLoadingWorkspaces(true);
    if (!_workspacesPromise) {
      _workspacesPromise = fetchUNSNodes(authentication, 'uns:_workspaces')
        .then((nodes) => {
          const ws: UNSWorkspace[] = [];
          for (const n of nodes) if (n.type === 'Workspace' && n.name) ws.push({ id: n.id, name: n.name });
          _cache.workspaces = ws;
          return ws;
        })
        .catch((e) => {
          _workspacesPromise = null;
          console.error('[UNS] workspace fetch failed:', e);
          return [];
        });
    }
    _workspacesPromise.then((ws) => {
      if (alive) {
        setWorkspaces(ws);
        setIsLoadingWorkspaces(false);
      }
    });
    return () => {
      alive = false;
    };
  }, [authentication]);

  const loadChildren = useCallback(
    async (wsId: string, parentId?: string): Promise<UNSNode[]> => {
      if (!authentication) return [];
      const cache = await wsCache(authentication, wsId);
      return parentId ? cache.childrenByParent.get(parentId) ?? [] : cache.top;
    },
    [authentication],
  );

  const searchNodes = useCallback(
    async (wsId: string, query: string, limit = 50): Promise<UNSNode[]> => {
      if (!authentication) return [];
      const cache = await wsCache(authentication, wsId);
      const q = query.trim().toLowerCase();
      return q ? cache.leaves.filter((n) => n.name.toLowerCase().includes(q)).slice(0, limit) : [];
    },
    [authentication],
  );

  return { workspaces, isLoadingWorkspaces, loadChildren, searchNodes };
}
