import { useProjectStore } from '../store/projectStore';
import { useUiStore } from '../store/uiStore';
import { downloadBlob, safeFileName } from '../ui/fileUtils';
import { budgetToCsv, computeBudget } from './budget';

export function exportShoppingCsv() {
  const p = useProjectStore.getState().project;
  const b = computeBudget(p.furniture);
  if (b.lines.length === 0) {
    useUiStore.getState().toast('Noch keine Möbel oder Geräte im Projekt.', 'info');
    return;
  }
  downloadBlob(budgetToCsv(b), `${safeFileName(p.name)}-einkaufsliste.csv`, 'text/csv;charset=utf-8');
  useUiStore.getState().toast('Einkaufsliste als CSV exportiert', 'success');
}
