import { useProjectStore } from '../store/projectStore';
import { useUiStore } from '../store/uiStore';
import { downloadBlob, safeFileName } from '../ui/fileUtils';
import { budgetToCsv, computeBudget } from './budget';
import { buildingFurniture } from './rooms';

/** Shopping list as CSV; `byRoom` groups it by room with a subtotal per room (#75). */
export function exportShoppingCsv(byRoom = false) {
  const p = useProjectStore.getState().project;
  // the whole building (#54), not only the storey shown
  const all = buildingFurniture(p);
  const b = computeBudget(all.furniture, all.roomOf);
  if (b.lines.length === 0) {
    useUiStore.getState().toast('Noch keine Möbel oder Geräte im Projekt.', 'info');
    return;
  }
  downloadBlob(budgetToCsv(b, { byRoom }), `${safeFileName(p.name)}-einkaufsliste${byRoom ? '-nach-raum' : ''}.csv`, 'text/csv;charset=utf-8');
  useUiStore.getState().toast('Einkaufsliste als CSV exportiert', 'success');
}
