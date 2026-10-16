import { FileFormatError } from '../formats/zodErrors';
import { useUiStore } from '../store/uiStore';
import { reportError } from '../ui/actions';
import { pickFile } from '../ui/fileUtils';
import { parseCatalogCsv, parseCatalogJson } from './catalogFormat';
import { useCatalogStore } from './catalogStore';

export async function importCatalogFile() {
  const file = await pickFile('.json,.csv,application/json,text/csv');
  if (!file) return;
  try {
    if (file.size > 10 * 1024 * 1024) throw new FileFormatError('Die Produktliste ist zu groß (max. 10 MB).');
    const text = await file.text();
    let count: number;
    let errors: string[] = [];
    if (file.name.toLowerCase().endsWith('.csv')) {
      const res = parseCatalogCsv(text, file.name);
      errors = res.errors;
      count = await useCatalogStore.getState().addItems(res.items);
    } else {
      count = await useCatalogStore.getState().addItems(parseCatalogJson(text, file.name));
    }
    useUiStore.getState().toast(`${count} Produkt(e) importiert${errors.length ? `, ${errors.length} Zeile(n) übersprungen: ${errors.slice(0, 2).join('; ')}` : ''}.`, errors.length ? 'info' : 'success');
  } catch (e) {
    reportError(e, 'Produktliste konnte nicht importiert werden');
  }
}
