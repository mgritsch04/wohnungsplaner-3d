import { projectActions } from '../store/projectStore';
import { applyMergeToCatalog, rehomeFurniture, type DuplicateGroup } from './duplicates';
import { useCatalogStore } from './catalogStore';

/**
 * Merge one duplicate group into `keepId`: placements in the plan move to the kept entry (one undo step),
 * then the other entries leave the catalog and the kept one takes over what it lacked.
 * Returns the number of placements that were re-pointed.
 */
export async function mergeDuplicateGroup(group: DuplicateGroup, keepId: string): Promise<number> {
  const removeIds = new Set(group.members.map((m) => m.item.id).filter((id) => id !== keepId));
  if (!removeIds.size || !group.members.some((m) => m.item.id === keepId)) return 0;
  let moved = 0;
  projectActions().apply((d) => {
    moved = rehomeFurniture(d.furniture, removeIds, keepId);
  });
  const store = useCatalogStore.getState();
  await store.replaceItems(applyMergeToCatalog(store.items, keepId, removeIds));
  return moved;
}
