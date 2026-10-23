import { create } from 'zustand';
import { checkDelivery, type DeliveryResult } from '../model/deliveryCheck';
import { derivePlan } from '../model/derived';
import { useProjectStore } from '../store/projectStore';

/** Delivery route check (#358): display only, never stored in the project. */
interface DeliveryStore {
  furnitureId: string | null;
  result: DeliveryResult | null;
  clear: () => void;
}

export const useDeliveryStore = create<DeliveryStore>((set) => ({
  furnitureId: null,
  result: null,
  clear: () => set({ furnitureId: null, result: null }),
}));

export function runDeliveryCheck(furnitureId: string) {
  const project = useProjectStore.getState().project;
  useDeliveryStore.setState({ furnitureId, result: checkDelivery(project, derivePlan(project), furnitureId) });
}

// selecting something else or changing the plan makes the old route stale
useProjectStore.subscribe((st, prev) => {
  if (st.project !== prev.project && useDeliveryStore.getState().result) useDeliveryStore.getState().clear();
});
